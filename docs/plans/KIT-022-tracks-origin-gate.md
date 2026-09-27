# KIT-022 — Kit-side origin gate on `handleTracks`

**Role chain:** Planner (fable, this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3.2, §4. **Decisions:** 0005 (incl. the §3 amendment), 0001 §5.
**Status:** ready for an implementer. Nothing in §10 blocks; two orchestrator calls (not product decisions) are listed there.

Goal in one sentence: an `onTracks` that reaches `KitPlayer` through a handler created for a source that is no
longer live is dropped whole — not forwarded to the app, not latched into `appliedPrefs`, not shown in
`renderControls` — mirroring `handleTextTrackData`, so that no adapter can put the previous source's tracks,
preferences or captions on the current one, whatever the adapter's own cancellation does.

Ticket text (`TASKS.md`): "Kit-side origin gate on `handleTracks` (`KitPlayer.tsx:60-77`): re-create per
`sourceUri`, refuse when `sourceUri !== liveUri.current`, mirroring `handleTextTrackData`. KIT-019's adapter
cancel only closes the race when the source update is flushed synchronously; a DefaultLane update … leaves one
task between the layout-effect reset and the adapter's passive cleanup, and A's VTT then passes the origin
gate. Harness cannot reach it (`setSource` is `flushSync`) — needs a vitest fake-adapter test."

---

## 0. Verdict at a glance

1. **The web race in the ticket is refuted on HEAD — by a coupling nobody wrote down.** The DefaultLane gap the
   KIT-019 reviewer described exists in React 19.3 (§1.1, control experiment), but `KitPlayer`'s reset closes it:
   the reset's `setTracks`/`setPosition` run inside a layout effect, so they are SyncLane updates, and React
   flushes *pending passive effects before performing sync work at the end of the same commit*. The web
   adapter's `cancelled = true` therefore runs in the same task as the reset for every update lane, not only for
   `flushSync` (§1.2, §1.3). The KIT-019 changeset paragraph needs no softening.
2. **The gate ships anyway, for the platform that matters.** Fire OS (primary, decision 0001 §5) has no cancel
   at all: `onLoad` awaits the manifest and then publishes through the `props` it closed over
   (`fireos.tsx:69-88`). A switch during that await puts A's tracks, A's `preferredAudio` pick, and A's captions
   on B, and B's `preferredText` is never applied — reproduced on HEAD with the real `KitPlayer` and a
   Fire-OS-shaped adapter double (§2). No React scheduling is involved. The gate is the only kit-side defence
   for this "publish half" until KIT-023, and defence in depth after it.
3. **The change is four lines in `KitPlayer.tsx`** (§4): one `if`, one dep, one doc comment, one sentence on
   the reset naming the coupling in (1). No public type change; the adapter contract goes into the existing
   `AdapterProps` interface comment.
4. **`onState('ready')` is not gated here** (§5). It goes to KIT-015 with a precise hand-off; KIT-023's cancel
   removes the Fire OS instance of it regardless.
5. **Guard of record is a vitest test that renders the real `KitPlayer`** under jsdom with a platform double
   that obeys the Fire OS handler contract (§7.1). It is red on HEAD and green on the fix — verified in a
   scratch copy (§7.1, evidence). It is not a mirror: the component under test is `src/player/KitPlayer.tsx`
   itself. The harness cannot be red on HEAD with the real `WebAdapter` (that is the finding in (1)); a harness
   DefaultLane spec is specified as a *pin* of the coupling (§7.2), secondary.

---

## 1. The race, re-examined

Line numbers below are in `node_modules/react-dom/cjs/react-dom-client.development.js` (react-dom 19.3.0) and
`node_modules/.pnpm/scheduler@0.27.0/node_modules/scheduler/cjs/scheduler.development.js`.

### 1.1 What the KIT-019 review got right

- **Lane.** `resolveUpdatePriority` (1495-1502): no current update priority and no `window.event` →
  `DefaultEventPriority`. A `setState` from `setTimeout`, a promise callback, or `page.evaluate` is DefaultLane.
  A native `ended` listener (the web adapter's, `web.tsx:52`) has `window.event.type === 'ended'`, which is in
  neither the discrete nor the continuous list of `getEventPriority` → Default as well. On React Native a
  react-native-video `onEnd` is an unspecified-category direct event → Default. So "auto-advance from `ended`"
  and "next episode from a timer" are DefaultLane, as claimed.
- **Passive effects are a later task.** `commitRoot` schedules `flushPassiveEffects` as a Scheduler
  `NormalPriority` task before the mutation phase (19554-19560); `flushSpawnedWork` calls `requestPaint()`
  (19907), and Scheduler 0.27's `shouldYieldToHost` returns true whenever `needsPaint` is set (166-172), so the
  work loop *always* yields after a commit and the passive task lands in a later macrotask. Only a SyncLane
  commit flushes them inline (`0 !== (pendingEffectsLanes & 3) && flushPendingEffects()`, 20016).
- **The gap is real in isolation.** Control experiment (a parent with a layout effect keyed on `uri`, a child
  with a passive effect + `cancelled` flag, a microtask queued during the commit that plays the part of A's
  manifest `.then`), switch from `setTimeout`:
  `["effect A", "layout-reset B", "STALE-PUBLISH A", "cleanup A", "effect B"]`.
  The microtask runs before the child's cleanup. Exactly the reviewer's picture.

### 1.2 What closes it on HEAD

The same control with one `setState` added to the parent's layout effect — what `KitPlayer`'s reset does with
`setTracks`/`setPosition` (`KitPlayer.tsx:129-131`):
`["effect A", "layout-reset B", "cleanup A", "effect B", "cancelled-publish A"]`.

Why, in the source:

1. Layout effects run with `ReactDOMSharedInternals.p = DiscreteEventPriority` (19832), so
   `requestUpdateLane` (17824-17841) gives the reset's `setTracks`/`setPosition` **SyncLane**. `setTracks`
   passes a fresh object literal, so it never bails out; the sync work is scheduled on every genuine source
   change.
2. The end of `flushSpawnedWork` calls `flushSyncWorkAcrossRoots_impl(0, false)` (20027). For a root with
   pending sync lanes it calls `performSyncWorkOnRoot` (20485-20531), whose **first line is
   `flushPendingEffects()`** (20676-20677) → `flushPassiveEffects()` (20047-20062).
3. That is still inside the commit's task, before the task ends, before any microtask checkpoint. The web
   adapter's cleanup (`web.tsx:58-61`: `cancelled = true`, listeners removed) and B's load effect both run
   there. A's `Promise.all(...).then` (`web.tsx:32-45`), a microtask at the earliest, sees `cancelled === true`.

So: for `flushSync` the passive flush is inline by the SyncLane rule; for every other lane it is inline because
the reset itself schedules sync work. The hole exists only for a `KitPlayer` whose reset schedules no state
update — not HEAD.

### 1.3 Evidence with the real `KitPlayer` + real `WebAdapter`

Scratch Vite root outside the repo importing `src/player` via `/@fs/`, the repo's `routeStream`, Chromium
(headless shell 1243). Page mechanics, reusable for §7.2: a `window.fetch` shim that fetches the first request
for `/stream/master` eagerly but hands it to the caller only when released (a duck-typed
`{ ok, status, url, text: () => Promise.resolve(body) }`, which `fetchHlsMaster` accepts through its structural
`HlsFetch` type — every hop after release is a microtask, no task); a DefaultLane switch
(`setTimeout(() => setUri(B), 0)`); an App `useLayoutEffect` keyed on `uri` that releases the manifest *inside
B's commit* (parent layout effects run after the child's, i.e. after `KitPlayer`'s reset) and optionally spins
the CPU to simulate a slow commit. Witness: `video.getAttribute('src')` at the moment the manifest is handed
over — A means "before the adapter's passive effect", B means "after".

| Variant | `tracks` events | witness `src` at hand-over | `subs/de/*` fetched | text at 2 s |
|---|---|---|---|---|
| DefaultLane switch, release in commit, spin 0 ms | 1, B's urls | `/stream/master-b` | none | `Zweite Quelle` |
| same, spin 12 ms (slow commit) | 1, B's urls | `/stream/master-b` | none | `Zweite Quelle` |

The release happened while `src` was still `/stream/master` (recorded), and one microtask hop later it was
`/stream/master-b`: the passive flush ran between them, inside the commit. **No stale publish reaches HEAD's
`KitPlayer` through the real web adapter on any lane.** Corollary for the record: the sentence in the KIT-022
`TASKS.md` row and the "only when flushed synchronously" premise are wrong; the KIT-019 changeset paragraph is
accurate as written and must not be softened.

### 1.4 What this means for the plan

- The web adapter's correctness after KIT-019 rests on `KitPlayer`'s reset issuing at least one state update.
  Nobody wrote that down. §4(d) adds one sentence to the reset; §7.2 pins it in the harness.
- The gate is not the fix for a web race. It is the kit refusing to trust an adapter's cancellation — which
  Fire OS does not have (§2) and which a future refactor of the reset could silently remove on web.

---

## 2. Why the gate still ships: Fire OS has no cancel

Sequence, read from `fireos.tsx` (primary platform; RN 0.81 pins React 19.1, whose work loop matches §1.2):

1. `<Video source=A>` → native `onLoadStart` → `onLoadStart` (`:54-63`, `useCallback([props])`, so the latest
   render's) starts `hlsText.current = loadHlsTextTracks(A)`.
2. ExoPlayer prepares → native `onLoad` → the latest `onLoad` (`:69-88`) runs with **`props_A`** and
   `await hlsText.current` (`:71`). The closure keeps `props_A` across the await.
3. The app switches to B during the await (next button, deep link, playlist skip, fallback uri — anything but
   `ended`, which cannot precede `onLoad`). `KitPlayer`'s layout effect resets: `liveUri = B`,
   `selectedText = ∅`, `appliedPrefs = false`. `<Video source=B>` reloads; `onLoadStart_B` replaces
   `hlsText.current`.
4. A's manifest resolves. `onLoad_A` continues: `textUrls.current = A's urls` (`:78`), `tracks.current = A`
   (`:83`), **`props_A.onTracks(A)`** (`:84`), `props_A.onState('ready')` (`:85`).
5. HEAD's `handleTracks` is not source-scoped. It sets `tracks` state to A's list, forwards A's list to the app,
   latches `appliedPrefs`, calls `selectAudio(pickAudio(A.audio))` — an ExoPlayer index from A applied to B —
   and `selectText(A's de id)`. The Fire OS handle (`:36-49`, re-created each render, reads the latest
   `props`) fetches `textUrls.current.get(id)` — A's playlist — and delivers it through
   **B's** `onTextTrackData`, whose `sourceUri` is B and `liveUri` is B: the origin gate passes.
6. B's own `onLoad` completes later: `props_B.onTracks(B)` → `appliedPrefs` is already true → B's
   `preferredText`/`preferredAudio` are never applied. `tracks` state shows B's list while the scheduler holds
   A's cues under a colliding id. Two `ready`s.

Reproduced on HEAD with the real `KitPlayer` and a double that does exactly steps 2, 4 and 5 (§7.1 evidence):
after A's post-switch publish, app `onTracks` = `[A]`, adapter `selectText` = `[['0']]`, `renderControls`
tracks = A; after B's publish, `selectText` still `[['0']]`, cue text at 2 s = `A/0`, `onState` =
`['ready','ready']`. With the §4 change: `[]`, `[]`, `[]`; then `[B]`, `[['1']]`, `B/1`.

With the gate, A's continuation still overwrites `textUrls.current`/`tracks.current` and still emits `ready` —
that is KIT-023's half (§6). The user-visible defect the gate removes on Fire OS: wrong captions on the next
title until the user re-picks a track, wrong audio pick, preferences silently dropped.

---

## 3. Which `onTracks` a stale publish invokes, per adapter (the claim, verified)

The gate works only if a superseded load publishes through the handler it held *before* the switch. Verified:

| Adapter | Where `onTracks` is called | Which `props` | Verdict |
|---|---|---|---|
| web | `web.tsx:44` inside `Promise.all(...).then` of the load effect (`:15-62`) | The effect closure's `props` — the render that ran the effect (A's) | Effect-time handler. Gated correctly (moot after §1, kept as defence). |
| fireos | `fireos.tsx:84` inside `onLoad` (`:69-88`, `useCallback(…, [props])`) after `await hlsText.current` (`:71`) | The `props` of the render whose `onLoad` was the current prop **when the native event was dispatched**; the `await` does not refresh it | Dispatch-time handler. A load dispatched while A was live publishes through A's handler → gated. **Caveat:** a native `onLoad` for A that is dispatched *after* B's render arrives through B's `onLoad` (`props_B`) and passes any kit-side gate; only the adapter can tell (load token) → KIT-023, §6. |
| vega (scaffold, deferred) | `vega.tsx:54` via `publishTracks`, called from the effect's `attach().then` (`:39`) and the Shaka listeners (`:30-31`) | `publishTracks` is a per-render function declaration; the effect references its own render's binding → that render's `props` | Effect-time handler → gated. Separately reads `player.current` (`:51`) not `p`, so a stale `.then` publishes B's list through A's handler — now dropped rather than latched (KIT-024 improves by accident, still deferred with KIT-010). |

The imperative handles (`web.tsx:64-80`, `fireos.tsx:30-52`, `vega.tsx:57-86`) are re-created every render and
read the latest `props`, so `selectText` → `onTextTrackData` uses the handler live *at the time `selectText` is
called* — which is what 0005 §4 relies on, and why the gate must sit on `handleTracks` (the caller of
`selectText`), not downstream.

---

## 4. The change

**File:** `src/player/KitPlayer.tsx`. Nothing else in `src/`. No edit to `src/player/types.ts` members, no
`index.ts`, no `src/core/**`, no adapter.

**(a) Replace `handleTracks` (lines 60-77) with:**

```tsx
  /**
   * The origin gate on `onTracks`, mirroring `handleTextTrackData`: re-created per `source.uri`, and a report
   * that arrives through a handler created for a source that is no longer live is dropped whole — not forwarded
   * to the app, not latched into `appliedPrefs`, not shown in `renderControls`. Adapters publish through the
   * `onTracks` they held when the load began (web: the load effect's props; fireos: the `onLoad` closure across
   * its await), so a superseded load's report arrives here with `sourceUri` = that source. The kit does not rely
   * on an adapter cancelling its own load: fireos has no cancel (KIT-023), and on web the cancel is closed only
   * because the reset below schedules sync state (see the note there).
   */
  const handleTracks = useCallback(
    (t: Tracks) => {
      if (sourceUri !== liveUri.current) return // a report for a source that is no longer live
      tracksRef.current = t
      setTracks(t)
      props.onTracks?.(t)
      if (!appliedPrefs.current && adapterRef.current) {
        appliedPrefs.current = true
        const a = pickAudio(t.audio, props.preferredAudio)
        if (a) adapterRef.current.selectAudio(a.id)
        // No `preferredText` means text off, never "every track": TV convention is captions off until
        // asked for, and an omitted preference must not stack every language and description at once.
        // The decision itself lives in `autoSelectedTextIds` so it is tested in one place.
        const tx = autoSelectedTextIds(t.text, props.preferredText)
        if (tx.length) selectText(tx)
      }
    },
    [props.onTracks, props.preferredAudio, props.preferredText, selectText, sourceUri],
  )
```

Notes for the implementer:

- Compare with `!==`, **not** `sourceChanged(...)`: the wiring guard
  `test/selection.test.ts:371` pins `sourceChanged(` to exactly one call site, and `acceptsTextTrackData`
  compares the same two strings the same way. Do not add a pure helper for this — a two-string comparison
  wrapped in a function would only create a mirror to test (§7.3).
- The `if` is the first statement. `tracksRef`/`setTracks`/`props.onTracks` must not run for a stale report:
  the app's track sheet and `renderControls` would otherwise show A's list on B for as long as B's manifest
  takes (0005 §2.4 reasoning).
- `sourceUri` in the deps is what re-creates the handler per source. `react-hooks/exhaustive-deps` requires it
  anyway (it is read in the body); no eslint disable.
- `liveUri.current` is updated by the layout effect of the commit that changed `sourceUri`. A handler created
  in render R can be invoked only after R committed (props reach the adapter at commit; effects and the
  imperative handle run at commit), and the layout effect runs in that same commit before any adapter code can
  call back. So a live source's publish never sees `sourceUri !== liveUri.current`. First mount: `liveUri` is
  initialised from `props.source.uri` (`:23`). StrictMode: the reset is idempotent (`:122`), `liveUri` stays
  right.
- Known, accepted limit (same as 0005 §4's rejected generation counter): A→B→A within one load's latency lets
  A's *first* load publish through a handler whose `sourceUri` is again the live uri. Same uri, same bytes;
  `appliedPrefs` latches on an identical list; the second A load publishes once more. Two `onTracks` for one
  source in that corner, no wrong data. Not fixed here; noted in §9.

**(b) `src/player/types.ts` — interface-level JSDoc only, no member change.** Extend the comment above
`AdapterProps` (line 41) so the contract that already exists for `onTextTrackData` is stated for `onTracks`:

```ts
/**
 * What every adapter implements. Adapters are React components that accept these props and expose a ref.
 *
 * Origin contract for per-source reports: call the `onTracks` you held when the load began — the load effect's
 * props on web, the `onLoad` closure across its await on Fire OS — and the `onTextTrackData` you were handed at
 * `selectText` time. Never read either through a latest-props ref. The kit re-creates both per `source.uri`
 * and uses *which handler* delivered a report to drop reports for a source that is no longer live
 * (docs/decisions/0005 §4; KIT-022). An adapter should still cancel its own superseded loads (KIT-023): the
 * kit's gate drops the report, it cannot undo an adapter's internal state.
 */
export interface AdapterProps extends KitPlayerProps {
```

The existing `onTextTrackData` member comment (43-48) stays as is.

**(c) `docs/decisions/0005-source-change-reset.md`** — one short amendment under §3 (the orchestrator records
decisions; the implementer may draft): *"Amended (KIT-022): the kit enforces the §3 amendment itself —
`handleTracks` is re-created per `source.uri` like `handleTextTrackData` and drops a report from a handler
whose source is no longer live. Adapter-side cancellation remains required for adapter-internal state."*

**(d) One sentence on the reset (`KitPlayer.tsx`, inside the layout effect's doc comment, after "…under
StrictMode's double invocation."):**

> The `setTracks`/`setPosition` below are also what makes the adapters' passive cleanup run *inside* this
> commit on every update lane: they are SyncLane (issued during layout), and React flushes pending passive
> effects before performing sync work at the end of the commit. Keep at least one state update here, or the
> web adapter's `cancelled` flag is set one task too late for a DefaultLane source change (KIT-022 §1).

---

## 5. `onState('ready')` from a stale load — out of scope, with a hand-off

The same class of report goes through `handleState`, which is not source-scoped. Should it be?

- **Not in KIT-022.** (i) `state` is the adapter's, not reset by the kit (0005 §3); choosing which states are
  per-source (`loading`/`ready` clearly; `ended` arguably; `paused`/`playing`/`buffering` describe the element
  that is now B's) is the contract work KIT-015 exists for. (ii) The only stale `ready` a kit gate could
  deterministically catch is Fire OS's awaited one (`fireos.tsx:85`), which is in the very continuation KIT-023
  must cancel for its ref overwrites — the gate would be redundant the moment KIT-023 lands. (iii) On web,
  after §1, no stale `ready` can arrive at all (listeners are removed in the same task). (iv) It could not have a
  guard of record: the harness cannot place a `loadedmetadata` in a gap that does not exist, and a vitest pin
  of Fire OS's second `ready` would test the double, not the kit. This repo has been fooled by exactly that.
- **Hand-off to KIT-015 (tracks → ready contract), stated so it is not lost:** when KIT-015 makes web emit
  `ready` from the join (`Promise.all(...).then`, after `onTracks`) and Fire OS emit it after `onTracks` in the
  same continuation, a stale `ready` is the stale `onTracks` race by another name. KIT-015 should then either
  extend the §4 gate to `handleState` for `loading`/`ready` (three lines; `sourceUri` in deps) **or** rely on
  KIT-023's adapter-side cancel — its plan must pick one and say why. KIT-028 (Fire OS `ready` after
  `playing`) folds into the same decision.
- The §7.1 test *observes* the second `ready` (`onState` = `['ready','ready']` on the fixed code) and pins it
  as "PINNED, NOT ENDORSED" so KIT-015's change is visible in a diff.

---

## 6. What KIT-023 still needs afterwards (the boundary)

After KIT-022, a superseded Fire OS load can no longer publish tracks, latch preferences, or route its VTT into
the kit. It can still, from `onLoad`'s continuation (`fireos.tsx:71-85`):

1. **Overwrite `textUrls.current` (`:78`) and `tracks.current` (`:83`) with A's data.** Harmless if B's own
   `onLoad` completes later (it overwrites back). Permanent if A's manifest was slower than B's whole load
   (a stalling CDN for the title the user just left): every later `api.selectText` on B fetches A's playlists
   through B's live handler — A's captions on B, this time triggered by the user — and `api.getTracks()`
   returns A's list. **The kit cannot see this** (the request is made while B is live, through B's handler).
2. Emit a second `onState('ready')` (`:85`) and, from `onLoadStart`'s catch (`:58`), an `HLS_MASTER` error for
   a source the app has left.
3. **Dispatch-after-switch:** a native `onLoad` for A that reaches JS after B's render runs `onLoad_B` with
   A's ExoPlayer track list and whatever `hlsText.current` holds. Indistinguishable kit-side.

KIT-023's shape, so its plan starts from the right place: a per-load token (`loadId` ref, bumped in
`onLoadStart` — or keyed on `props.source.uri`), captured by `onLoad` *before* the await and compared after;
on mismatch return without touching refs or props. Reset `textUrls`/`tracks`/`audioIndex` on a uri change
(KIT-020 is the same edit). `onLoadStart` should also drop a stale `HLS_MASTER` rejection. The structural
guards in `test/hls-load.test.ts` pin the adapter's shape; KIT-023 updates them deliberately. Device evidence on
the AFTSS stick, since the harness cannot run Fire OS.

Nothing in KIT-022 touches `fireos.tsx`; KIT-023 does not touch `KitPlayer.tsx`. The two land independently.

---

## 7. Acceptance tests

### 7.1 Guard of record: `test/kit-player.test.tsx` — the real `KitPlayer`, a platform double

**Why this and not a mirror.** No pure function is added (§4), so `test/selection.test.ts` has nothing to
test and must not grow a `handleTracks` copy — it was fooled four times that way. The component itself renders
under vitest once `react-native` is mocked (it imports only `Platform`) and the adapter resolver is mocked; the
scheduler, `selectText`, the reset and `handleTracks` are the real ones. The adapter is a *double for the
platform*, written to the Fire OS contract in §3, not a re-implementation of kit logic.

**Infrastructure (implementer):**

- `pnpm add -D jsdom` (lockfile committed; CI runs `pnpm install --frozen-lockfile`). Per-file environment
  via `// @vitest-environment jsdom` on the first line, so the rest of `test/**` stays Node.
- `vitest.config.ts`: `include: ['test/**/*.test.{ts,tsx}']`. `tsconfig.json` already has `jsx: react-jsx`
  and includes `test`.
- Top of the file:
  ```ts
  // @vitest-environment jsdom
  import { act, forwardRef, useImperativeHandle } from 'react'
  import { createRoot } from 'react-dom/client'
  const fake = vi.hoisted(() => ({ current: null as unknown }))
  vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))
  vi.mock('../src/player/adapters', () => ({ resolveAdapter: () => fake.current }))
  import { KitPlayer } from '../src/player/KitPlayer'
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ```
  If the adapters mock is not hit, the real `WebAdapter` renders a `<video>` and the double's `beginLoad`
  throws on `latest.props === null` — the failure is loud, not silent.

**The double (Fire OS contract, `fireos.tsx:26, :36-49, :69-88`):**

- Records the latest render's `props` in a module-level `latest` (what `useCallback([props])` gives
  `onLoad`).
- Keeps a module-level `textUrls: Map<string,string>` (`:26`) that every *completed* load overwrites (`:78`)
  before publishing (`:84`).
- `beginLoad()` = "the native `onLoad` was dispatched now": captures `latest.props.onTracks` and
  `latest.props.onState` **at call time** and returns `{ complete(tracks) }`, which overwrites `textUrls`,
  then calls the captured `onTracks(tracks)` and `onState('ready')`.
- `useImperativeHandle` re-created every render (no deps, as the real adapters); `selectText(ids)` records
  the call and, for each id with a url in `textUrls`, calls **`props.onTextTrackData`** (this render's — the
  latest, as `fireos.tsx:44`/`web.tsx:75`) with a one-cue VTT whose text is the url (e.g. `A/0`), so the cue
  text tells which source's bytes landed. `selectAudio` records. Everything else no-op.

**Fixtures.** `TRACKS_A = { audio:[main], text:[{id:'0', de, url:'A/0'}] }`;
`TRACKS_B = { audio:[main], text:[{id:'0', en, url:'B/0'}, {id:'1', de, url:'B/1'}] }` — ids collide and `de`
moves, as 0004 ordinals do. **`const PREF = { languages: ['de'] }` at module scope and stable `vi.fn()`
callbacks.** This is load-bearing: an inline `preferredText={{…}}` re-creates `handleTracks` on every render
through *that* dep and masks a missing `sourceUri` dep (M2 below) — seen in the scratch run.

**Rendering.** `createRoot(document.createElement('div'))`; `render(uri)` = `act(() => root.render(<KitPlayer
ref={…} source={{ uri, type: 'hls' }} preferredText={PREF} onTracks={onTracks} onState={onState} onCue={onCue}
renderControls={(c) => { ctx.tracks = c.tracks; return null }} />))`. `act` flushes everything, which is
fine: the lane is irrelevant to this test (§2 — the stale publish is a continuation, not a scheduling artefact).

**`it(...)` names and assertions** (`describe('KitPlayer origin gate on onTracks (KIT-022)')`):

1. `it('drops a report that arrives through a handler created for a source that is no longer live')`
   — `render('A')`; `loadA = beginLoad()`; `render('B')`; `act(() => loadA.complete(TRACKS_A))`. Assert
   `onTracks` not called; `selectText` calls `[]`; `selectAudio` calls `[]`; `ctx.tracks` is
   `{ audio: [], text: [] }`; `ref.getTracks()` (adapter says empty) … `.text` is `[]`.
   *HEAD:* `onTracks` called with A, `selectText` `[['0']]`, `ctx.tracks` A.
2. `it("accepts the live source's own report afterwards and applies preferredText to its ids")`
   — continue 1: `loadB = beginLoad()` (dispatched while B live — call it *before* `loadA.complete` to model
   both loads in flight), `act(() => loadB.complete(TRACKS_B))`, `act(() => ref.seek(2))`. Assert `onTracks`
   called exactly once, with B; `selectText` `[['1']]`; `ctx.tracks.text` urls `['B/0','B/1']`; last `onCue`
   texts `['B/1']`. *HEAD:* `selectText` stays `[['0']]` (latched), cue text `['A/0']`.
   This is the positive case; it is what catches M2.
3. `it("a stale report that lands after the live source's does not overwrite it")`
   — `render('A')`, `loadA = beginLoad()`, `render('B')`, `loadB = beginLoad()`,
   `loadB.complete(TRACKS_B)`, then `loadA.complete(TRACKS_A)`. Assert `onTracks` calls `[B]` only;
   `ctx.tracks` B; `selectText` `[['1']]`; `seek(2)` → `['B/1']`. *HEAD:* `onTracks` `[B, A]`, `ctx.tracks`
   A, and — because HEAD's stale `selectText(['0'])` runs after `textUrls` was overwritten with A's — a second
   scheduler track `'0'` = `A/0` beside `B/1`.
4. `it('a report for the live source through the current handler is accepted on first mount')`
   — `render('A')`, `beginLoad().complete(TRACKS_A)`; `onTracks` `[A]`, `selectText` `[['0']]`, `seek(2)` →
   `['A/0']`. Guards against an over-eager gate (e.g. comparing before `liveUri` is initialised).
5. `it("pins: a superseded load's onState('ready') still reaches the app — KIT-015 decides")` — same steps
   as 1; assert `onState` calls `['ready']` after `loadA.complete`. Comment: PINNED, NOT ENDORSED; see plan §5.

**Evidence (scratch, not committed).** The same double against the *real* `KitPlayer.tsx` on HEAD printed:
after A's post-switch publish `{"onTracks":[["A/0"]],"selectText":[["0"]],"ctxTracks":["A/0"]}`; after B's
publish + `seek(2)` `{"onTracks":[["A/0"],["B/0","B/1"]],"selectText":[["0"]],"cueText":["A/0"],
"states":["ready","ready"]}`. Against a copy of `KitPlayer.tsx` with §4(a) applied:
`{"onTracks":[],"selectText":[],"ctxTracks":[]}` then
`{"onTracks":[["B/0","B/1"]],"selectText":[["1"]],"ctxTracks":["B/0","B/1"],"cueText":["B/1"]}`. With the fix
but `sourceUri` missing from the deps and a stable `PREF`: `onTracks` stays `[]` after B (B refused forever).
Mechanics that worked: jsdom 25, vitest 2.1.9, `act` from `react`, `esbuild.jsx: 'automatic'`.

### 7.2 Harness (secondary): pin the coupling with a DefaultLane switch — green on HEAD by design

The brief asked for a real-`WebAdapter` harness spec that is red on HEAD. §1.3 shows there is none to write:
the real web path is closed on every lane. What the harness *can* pin is the reason it is closed, so that a
refactor of the reset does not reopen it silently. Recommended; the orchestrator may ticket it instead if the
0.1.0 window is tight (§10).

`harness/player.tsx` gains (≈35 lines):

- `?hold=<encodeURIComponent(pathname)>`: the fetch shim from §1.3 (eager fetch, gated hand-over, duck
  response). **Encode the value** — a literal `/stream/` in the query makes `routeStream`'s `**/stream/**`
  glob swallow `player.html` (spec 24 has the same note).
- `__kit.heldReady(): boolean`, `__kit.releaseHeld(): void`.
- `__kit.setSourceDeferred(uri)`: `setTimeout(() => setSrcState(uri), 0)` — a DefaultLane update, and arms
  a target.
- In `App`, `useLayoutEffect(() => { if (armed && uri === target) { diag.releasedAt = videoSrc(); releaseHeld() } }, [uri])`
  — the release runs inside the switch's commit, after `KitPlayer`'s reset (child first).
- The shim records `diag.handover = { rendered: uri, videoSrc }` when it hands the manifest over.
- `__kit.diag`.

Spec 25, `harness/e2e/player.spec.ts`:
`test("a source switch from a timer (DefaultLane) tears down the previous load inside the same commit: A's manifest handed over one microtask after the reset still cannot publish")`
— `routeStream(page)`; goto `/player.html?hold=<enc('/stream/master')>&preferred={"languages":["de"]}`;
poll `ready`; poll `heldReady()`; `trackEvents` length 0; `setSourceDeferred('/stream/master-b')`; poll
`trackEvents` length ≥ 1; wait 300 ms; assert: exactly one `tracks` event and it is `MANIFEST_TRACKS_B`;
`diag.releasedAt.videoSrc === '/stream/master'` (the release was before the passive effect);
**`diag.handover.videoSrc === '/stream/master-b'`** (the passive effect ran before the hand-over — the pin);
`hits` has no `fetch subs/de/`; `cueText(page, 2)` → `['Zweite Quelle']`.

Status: **green on HEAD** (this is §1.3's result, restated as a spec). Red when the reset's `setTracks` and
`setPosition` are both removed (the witness flips to `/stream/master`; with the §4 gate also removed, the
outcome assertions go red too). It also gives KIT-015/KIT-023 a non-`flushSync` switch primitive, which the
harness lacks today.

### 7.3 Vitest mirror: none

No addition to `test/selection.test.ts`. The three existing `KitPlayer wiring` guards must still pass:
`adapterRef.current?.selectText(` ×1, `autoSelectedTextIds(` ×1, `useLayoutEffect(` ×1 and `sourceChanged(`
×1 (hence `!==` in §4a), no `useEffect(`.

### 7.4 Mutations for the orchestrator (run one at a time, revert, never commit)

| # | Mutation in `KitPlayer.tsx` | Must go red |
|---|---|---|
| M1 | delete `if (sourceUri !== liveUri.current) return` | 7.1 #1 (`onTracks` called with A; `selectText` `[['0']]`), #2 (cue `A/0`), #3 |
| M2 | drop `sourceUri` from `handleTracks` deps | 7.1 #2 (B's report refused: `onTracks` never called, `selectText` `[]`) — only with the stable `PREF`; an inline object masks it, which is why the test must not use one |
| M3 | move the `if` below `props.onTracks?.(t)` | 7.1 #1 (app `onTracks` called with A) |
| M4 | compare `sourceUri !== props.source.uri` (same closure, always equal) | as M1 |
| M5 | delete both `setTracks(...)` and `setPosition(start)` from the reset | 7.2 spec 25 witness (`handover.videoSrc` is `/stream/master`); with M1 applied as well, spec 25's outcome assertions and specs 22/23-style stale publish |

Also `pnpm typecheck` and `pnpm typecheck:harness` (if 7.2 lands) and the full `pnpm test` + `pnpm harness`.

---

## 8. Changeset

Append to `.changeset/release-0-1-0.md` (still `minor`, one file). Do **not** edit the KIT-019 paragraph
("Web: switching `source` no longer leaks the previous load") — it is accurate; §1.3.

```
**The kit ignores track reports from a source it has left.** `KitPlayer` now drops an `onTracks` that arrives
through a handler created for a previous `source.uri`, the way it already drops WebVTT fetched for a previous
source: the report is not forwarded to `onTracks`, does not latch `preferredAudio`/`preferredText`, and does
not reach `renderControls`. On Fire OS a source change made while the previous title's master playlist was
still loading could otherwise apply that title's preferences to the new one and keep its captions on screen
until a track was re-selected. Adapters are still expected to cancel their own superseded loads; the Fire OS
adapter's cancellation lands separately. Multi-track text selection is unchanged.
```

`TASKS.md` (orchestrator, §3.5): the KIT-022 done-section should record §0 (1) — the web race is refuted, the
KIT-019 cancel holds on every lane because the reset schedules sync state — so the row's premise does not
propagate into KIT-015/KIT-023 plans.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | An adapter reads `props.onTracks` through a latest-props ref (none does; KIT-010's Vega rewrite might) — stale reports would arrive through the live handler. | Contract in `AdapterProps` doc (§4b). KIT-010's plan must keep closure capture or cancel. Same exposure already accepted for `onTextTrackData` (KIT-011 R1). |
| R2 | Fire OS dispatch-after-switch (§3 caveat) still passes. | Not addressable kit-side; KIT-023's load token. Stated in §6 so it is not mistaken for a KIT-022 gap. |
| R3 | A→B→A within one load latency: the first A load's report is accepted by the second A (§4a note). | Same bytes; one extra `onTracks`. Same trade 0005 §4 made for VTT. |
| R4 | `jsdom` devDep + a `.tsx` test change the vitest surface (`include` glob, per-file env). | Per-file `@vitest-environment`; Node stays the default; `src/core` unaffected. Lockfile committed for `--frozen-lockfile`. |
| R5 | The double drifts from `fireos.tsx` (e.g. KIT-023 changes when `textUrls` is written). | The double's comments cite `fireos.tsx` lines; KIT-023's reviewer checks the double still matches. The gate's *own* behaviour does not depend on the double's fidelity beyond "publishes through a captured handler". |
| R6 | Harness mode (7.2) adds a `fetch` shim to `player.tsx` that could affect other specs. | Installed only when `?hold=` is present; single first-match gate; other requests pass through. |
| R7 | Someone "simplifies" the reset by moving `tracks`/`position` fully into refs, reopening the web gap. | §4(d) comment; 7.2 witness assertion; and the gate itself now catches the outcome. |

---

## 10. Open questions

None for the human — no product decision is involved. Two orchestrator calls:

1. **Accept `jsdom` as a devDependency** (test-only; needed to render the real component in vitest). The
   alternative — a harness page with a Fire-OS-shaped double injected through `KIT_FORCE_ADAPTER` accepting a
   component — needs a one-line kit change to `resolveAdapter` and a second harness page, and runs only in the
   slower `harness` CI job. Recommendation: `jsdom`.
2. **Fold 7.2 (harness DefaultLane pin) into KIT-022 or ticket it.** Recommendation: fold if the implementer
   finishes 7.1 in the first pass; otherwise ticket as "harness: non-`flushSync` source switch primitive + pin
   of the reset/cleanup coupling" and have KIT-015 pick it up, since KIT-015 needs the primitive anyway.

Not a question, a correction for the record: the KIT-022 `TASKS.md` row and the KIT-019 review's "only when
flushed synchronously" are superseded by §1. The KIT-019 changeset stands.
