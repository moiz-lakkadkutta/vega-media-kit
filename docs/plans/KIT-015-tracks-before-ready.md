# KIT-015 + KIT-028 — `onTracks` before `ready`, and `ready` never overwrites `playing`

**Role chain:** Planner (fable, this document) → Implementer (opus) → Reviewer (fable) → optional device check (human with the stick).
**Protocol:** `docs/ORCHESTRATOR.md` §3.2, §4. **Decisions:** 0001 §5 (Fire OS primary; KIT-028 is on its before-0.1.0 list), 0004 (one `onTracks` per source), 0005 §3 (state is the adapter's; the kit does not synthesise `onState`) with its KIT-011/KIT-022 amendments, 0008 (new, drafted in §9).
**Status:** ready for an implementer. No open question blocks (§12). One semantic call is recorded for the human's veto in 0008, the way 0005 was.

Goal in one sentence: for every load, every adapter reports `onTracks` before `onState('ready')`, from the same continuation; the kit drops a `ready` that would overwrite `playing` for the same load and drops any state report from a superseded load — so an app that reads `getTracks()` or calls `selectText` in `onState('ready')` always has the tracks, and a HUD never reads `ready` while the video plays (KIT-028).

Ticket texts (`TASKS.md`): KIT-015 "`onTracks` before `onState('ready')` as a kit-wide contract (web: emit `ready` from the join; Vega: publish before `ready`); then assert order in harness spec 11". KIT-028 "Fire OS reports `ready` after `playing`: `onLoad` awaits the manifest then calls `onState('ready')` (`fireos.tsx:85`), overwriting `playing` for the rest of playback. Folds naturally into KIT-015".

---

## 0. Verdict at a glance

1. **Ordering is the adapter's job; the overwrite rule and the stale-report rule are the kit's.** Adapters emit `ready` right after `onTracks`, in the same continuation (web: the `Promise.all` join; Vega: swap two lines; Fire OS: already so). The kit's `handleState` gains two `if`s: a `ready` is dropped once the live load has reported `playing`/`ended`, and any state through a handler created for a source that is no longer live is dropped (the KIT-022 gate, extended). Five production lines in `KitPlayer.tsx`, three in `web.tsx`, a swap in `vega.tsx`. **`fireos.tsx` needs one no-op-preserving line: nothing.** KIT-028 is fixed by the kit rule, replayed in a test from the device log verbatim (§7.2).
2. **Why the overwrite rule is kit-side, not per adapter (§2).** The kit owns `PlayerState` and its meaning; "`ready` is not a successor of `playing` within one load" is a property of that state model, so it is enforced once, where `renderControls`' `state` is set, for every adapter including the KIT-010 rewrite. Adapter-side it would be three flags fed by three different event mappings (Fire OS `onBuffer`/`onPlaybackStateChanged`, web `play`, Vega `play`/`buffering`), one of which cannot be device-verified. Dropping a report is not synthesising one: 0005 §3 is amended, not contradicted (0008).
3. **The rule is "`ready` is dropped after `playing` or `ended`", not "after any later state" (§2.2).** The device log shows Fire OS reports `buffering` and then `paused` (autoplay off) or `playing` (autoplay on) *before* `ready` on every load — `onBuffer(false)` fires at ExoPlayer READY, before the manifest read completes. `paused`/`buffering` before `ready` are legitimate and `ready` must still land after them, or an autoplay-off load would never report `ready`.
4. **Stale `ready` (KIT-022 §5 hand-off): ship the kit-side origin gate on `handleState`, for all states, as defence in depth (§3).** It is one line, the same line `handleTracks` has, and every adapter reports state through a per-load closure or a latest-props handler, so a report through a superseded handler is always a superseded load's (or a duplicate). Fire OS no longer produces one after KIT-023 and web after KIT-019, so the gate guards the Vega scaffold and any future adapter — and it is what turns PINNED test #5 in `test/kit-player.test.tsx` into a real assertion. Relying on adapter cancellation alone was rejected: no guard of record for Vega, and the kit's own `state` could be flipped to `ready` mid-playback of the new source by any adapter that forgets to cancel — KIT-028 by another route.
5. **Web also gains `loading`** (§4.2): it is the only adapter that never reported it, and the contract text says every load begins with `loading`. One line; spec 21 counts it.
6. **Consequence for apps: an autoplay load that starts before its tracks arrive never reports `ready`** (`loading → buffering → playing`, `onTracks` in between). Verified harmless for the consumers: `described` reads only `buffering` from `state` (`Player.tsx:54`), `lingo` only `paused`/`ended` (`Player.tsx:33`), the sample app's KitSpike HUD has a workaround for exactly this bug (`KitSpikeScreen.tsx:116-118`) that can be removed. Recorded in 0008 for the human's veto.
7. **Harness: five existing specs use `state:ready` as the witness for "the element has its metadata" while the manifest is held (10, 12, 22, 23, 25).** After this change `ready` waits for the manifest too, so they get a `metadataLoaded(page)` witness (`video.readyState >= 1`). Spec 11 asserts the order; spec 10 asserts no `ready` before the manifest; one new spec asserts the overwrite rule on the real `WebAdapter`. 25 → 26 specs.
8. **Guards of record, all on real components:** harness (real `WebAdapter` + real `KitPlayer`, Chromium); `test/fireos-adapter.test.tsx` (real `FireOsAdapter` + real `KitPlayer`, the device sequence replayed); `test/kit-player.test.tsx` (real `KitPlayer`, platform double). Vega: a source-order guard in `test/hls-load.test.ts` "adapter wiring" — the Vega scaffold cannot render under vitest (§7.4). Vitest 168 → 175; every test has a named production mutation (§8).

---

## 1. What each adapter does today (read from HEAD, `5c83f83`)

| Adapter | `loading` | `onTracks` | `ready` | Order observed | Stale `ready` possible? |
|---|---|---|---|---|---|
| fireos (`fireos.tsx:85-126`) | `onLoadStart` (`:96`) | `onLoad` continuation after `await l.manifest` (`:122`) | same continuation, next line (`:123`) | tracks → ready, always | No: `if (l !== load.current) return` (`:110`) precedes both (KIT-023); `key` per uri drops the old instance's events |
| web (`web.tsx:15-62`) | **never** | `Promise.all([manifest, metadata]).then` (`:44`) | a second `loadedmetadata` listener (`:48`) | race-dependent: `ready` first when the manifest is slower than the media; `tracks` first when the manifest settled earlier (the `.then` microtask runs between the two listeners) | No: listeners removed by reference and `cancelled` gates the `.then` (KIT-019); cleanup runs inside the switch's commit on every lane (KIT-022 §1) |
| vega (`vega.tsx:23-48`, scaffold, deferred) | inside `attach().then` before `load` (`:36`) | `publishTracks()` after `load` (`:39`) | **before** `publishTracks()` (`:38`) | ready → tracks | Yes: `attach().then` has no cancel (KIT-024, deferred with KIT-010); it publishes through the effect closure's props |

**The Fire OS defect (KIT-028), from `~/hackathon/spike-evidence/fireos-kit023-switch.log` (autoplay on):**

```
19:38:25.384 state loading      (onLoadStart)
19:38:25.729 state buffering    (onBuffer true)
19:38:32.223 state playing      (onBuffer false, not paused)
19:38:32.471 state playing      (onPlaybackStateChanged isPlaying)
19:38:32.808 tracks {...}       (onLoad continuation, after the manifest)
19:38:33.634 state ready  prev playing   ← overwrites playing; every later `pos` line reads state ready
```

The same shape after every switch (`19:39:14.841 playing … 19:39:15.642 ready prev playing`). The manifest read starts at `onLoadStart` and still loses to ExoPlayer's prepare + play by 0.6–1.2 s on the stick. No adapter reordering can fix this without either delaying `playing` until the manifest lands (a spinner over video that is audibly playing, for up to a second) or emitting `ready` before `onTracks` (the contract violation this ticket removes). So `ready` must be *dropped* when it arrives after `playing`.

**What apps do with `ready` today:** nothing. `described/packages/shared-ui/src/screens/Player.tsx:49,54` — `onState={setState}`, rendered only as `state === 'buffering' ? loading : …`. `lingo/packages/shared-ui/src/screens/Player.tsx:33` — `setPaused(s === 'paused'); if (s === 'ended') onEnd()`. Sample app `KitSpikeScreen.tsx:116-118` treats `ready` as `playing` to work around KIT-028. `spot` does not use the kit player.

---

## 2. Design

### 2.1 The contract (what 0008 says, in one paragraph)

For each load of a `source.uri`, an adapter reports `loading` when the load begins, exactly one `onTracks` once the track list is complete (0004), and `ready` immediately after that `onTracks`, from the same continuation. `playing`, `paused`, `buffering`, `ended` are reported as the platform reports them, before or after `ready`. The kit guarantees to the app: (a) `onTracks` for a load precedes its `ready`; (b) `ready` is never reported for a load that has already reported `playing` or `ended` — the `state` in `renderControls` never goes back from `playing` to `ready`; (c) no state report from a load the app has left reaches it. The kit never synthesises a state (0005 §3); it only refuses one.

### 2.2 The overwrite rule, precisely

`playbackBegan` (a `useRef(false)` in `KitPlayer`) is set when the live load reports `playing` or `ended`, and is reset by the source-change layout effect (per source, alongside `appliedPrefs`). `handleState('ready')` returns early when it is set.

- Why `playing`/`ended` and not "any state other than `loading`": Fire OS reports `buffering` at ExoPlayer BUFFERING and `paused` (`onBuffer(false)` while `paused`) at ExoPlayer READY, both before the manifest-gated `ready` (§1 log). With autoplay off the sequence is `loading → buffering → paused → tracks → ready`; `ready` is the state the app wants there ("loaded, waiting for play"). `paused` after `playing` is covered anyway: `playbackBegan` is sticky for the load.
- Why not re-emit `playing` after `ready` (`playing → ready → playing`): `state` would flicker for one render; a HUD would flash a play prompt.
- Why not hold `playing` until `ready` (queue): delays the HUD by the manifest latency (up to ~1.2 s on the stick) while video is audibly playing; needs a queue with `paused`/`buffering` semantics; and it would make the *adapter's* timing the app's problem.
- Why not reset `playbackBegan` on `loading` as well: no adapter reloads a uri without a `source.uri` change (`key` per uri on Fire OS; the effect key on web/Vega), so the only observable reset is the source change. One mechanism, one mutation (§8 M3).
- `ended` is included for completeness (a 1-second clip that ends before its manifest lands); it is unreachable without a prior `playing`.

### 2.3 Where each piece lives

| Piece | File | Mechanism |
|---|---|---|
| Order: web | `web.tsx` | `props.onState?.('ready')` moves from the second `loadedmetadata` listener into the `Promise.all(...).then`, after `props.onTracks?.(...)`; the listener is deleted. `cancelled` now gates `ready` too. |
| Order: Vega | `vega.tsx` | `publishTracks()` then `props.onState?.('ready')` (swap). |
| Order: Fire OS | `fireos.tsx` | unchanged — `:122-123` already tracks → ready in one continuation. Guarded by a new test (§7.2 #1). |
| `loading`: web | `web.tsx` | `props.onState?.('loading')` at the top of the load effect, after `if (!v) return`. |
| Overwrite rule | `KitPlayer.tsx` | `playbackBegan` ref; check in `handleState`; reset in the layout effect. |
| Stale state | `KitPlayer.tsx` | `if (sourceUri !== liveUri.current) return` first in `handleState`; `sourceUri` in its deps. |
| Contract text | `types.ts` | JSDoc only (§5). |

### 2.4 Which handler a state report arrives through (why gating *all* states is safe)

| Adapter | State call sites | `props` used | Verdict |
|---|---|---|---|
| web | listeners built in the load effect (`:46-53`) and the `.then` | the effect closure's — that load's | per-load handler → a stale one is a superseded load's (or, if a listener ever leaked again, a duplicate of the live listener's event for the same element) → drop |
| fireos | `onLoadStart`/`onLoad` (`useCallback([props])`), inline arrows on `<Video>` | latest render's | always live → the gate never fires; the old instance's events are dropped by RN (`key`, KIT-023 §2.4) |
| vega | inside `attach().then` and element listeners added in the effect | the effect closure's | per-load → a stale one is a superseded load's (KIT-024's uncancelled `.then`) or a duplicate (its never-removed element listeners) → drop |

So the one rule "drop a report through a handler whose source is not live" is correct for every state, and simpler than choosing which states are per-load. Masking effect noted in §10 R3.

---

## 3. Stale `ready` — the decision the KIT-022 plan asked for

Options from 0005 §4 and KIT-022 §5:

| Option | Cost | Covers | Guard of record |
|---|---|---|---|
| (i) Kit-side origin gate on `handleState` | 1 `if` + 1 dep | every adapter, now and future | `test/kit-player.test.tsx` #5 (real `KitPlayer`, double that does not cancel) — red on mutation |
| (ii) Rely on adapter-side cancel (KIT-023 Fire OS, KIT-019 web) | 0 | Fire OS, web | already: `fireos-adapter` T1, harness 22/23 |
| (iii) Numeric generation / per-load token in the kit | a state + a ref | same as (i) plus A→B→A within one load latency | — |

**Recommendation: (i), on top of (ii) which already exists.** Reasons: it is the same mechanism and the same one-line shape as `handleTracks` (KIT-022) and `handleTextTrackData` (0005 §4), so the kit's three per-source report handlers share one rule; it is the only defence for the Vega scaffold (KIT-024 deferred) and for the KIT-010 rewrite until that ships its own cancel; it costs nothing at runtime (`handleState` is already re-created on `props.onState` changes; adapters capture it per load or read it latest). (iii) is rejected for the same reason 0005 §4 and KIT-022 §4 rejected it: the only case it adds (A→B→A inside one load's latency) delivers the same state for the same uri. (ii) alone is rejected because it leaves the kit's `state` at the mercy of adapter hygiene, which is precisely the stance KIT-022 took against for `onTracks`.

Consequence for KIT-023's mutation matrix: its M1 (delete the post-await `if (l !== load.current) return`) previously turned T1 and T5 red; with the kit gate T1 stays green (the stale `onTracks`/`ready` are dropped kit-side) and **T5 still goes red** (A→B→A: the first A load's report passes the uri gate — KIT-022 R3). The adapter's cancel therefore remains guarded. Say so in the KIT-023 done-notes when recording this ticket.

---

## 4. The change — exact files

### 4.1 `src/player/KitPlayer.tsx`

(a) After `const appliedPrefs = useRef(false)` (line 21):

```tsx
  /**
   * Whether the live load has reported `playing` (or `ended`). A `ready` that arrives afterwards is dropped:
   * `ready` means "loaded, not yet playing" and must never overwrite a later state (docs/decisions/0008). Fire OS
   * reads the master playlist after ExoPlayer has already started (KIT-028); web waits for the manifest too.
   */
  const playbackBegan = useRef(false)
```

(b) Replace `handleState` (lines 100-106) with:

```tsx
  /**
   * The state gate (docs/decisions/0008). Re-created per `source.uri` like `handleTracks`: a report through a
   * handler created for a source that is no longer live is dropped — adapters report state through per-load
   * closures (web listeners, the Vega load) or latest-props handlers (Fire OS), so only a superseded load's report
   * can arrive stale. `ready` is dropped once the live load has reported `playing`/`ended`: the adapter could not
   * order it earlier without reporting `ready` before `onTracks`. The kit never synthesises a state (0005 §3); it
   * only refuses one.
   */
  const handleState = useCallback(
    (s: PlayerState) => {
      if (sourceUri !== liveUri.current) return // a report for a source that is no longer live
      if (s === 'ready' && playbackBegan.current) return // ready never overwrites playing (KIT-028)
      if (s === 'playing' || s === 'ended') playbackBegan.current = true
      setState(s)
      props.onState?.(s)
    },
    [props.onState, sourceUri],
  )
```

(c) In the layout-effect reset, after `appliedPrefs.current = false // …` (line 143):

```tsx
    playbackBegan.current = false // the new load's ready is reported unless it, too, is already playing
```

Notes for the implementer: compare with `!==`, not `sourceChanged(...)` — `test/selection.test.ts` pins `sourceChanged(` to one call site. The origin `if` is the first statement. Nothing else in the file changes; the `KitPlayer wiring` guards (`adapterRef.current?.selectText(` ×1, `autoSelectedTextIds(` ×1, `useLayoutEffect(` ×1, no `useEffect(`) still hold.

### 4.2 `src/player/adapters/web.tsx`

(a) After `let cancelled = false` (line 21):

```tsx
    props.onState?.('loading')
```

(b) Inside the `Promise.all(...).then` (lines 32-45), after `props.onTracks?.(tracks.current)`:

```tsx
      props.onState?.('ready') // from the join, after onTracks: the contract in AdapterProps (KIT-015)
```

(c) Delete the listener `['loadedmetadata', () => props.onState?.('ready')],` (line 48). The `['loadedmetadata', metadataSeen]` entry stays. Update the comment above the `.then` (lines 30-31) to: `// One onTracks, then ready, once both the element's metadata and the manifest are in — otherwise KitPlayer's appliedPrefs would latch on a track list that is still missing the manifest tracks, and an app reading getTracks() in onState('ready') would get an empty list.`

Behavioural consequences on web, all intended: `ready` now waits for the manifest (specs 10/12/22/23/25 change their witness, §7.1); `loading` is reported at the start of every load; a stale `ready` is impossible by construction (`if (cancelled) return` precedes it).

### 4.3 `src/player/adapters/vega.tsx`

Lines 37-40 become:

```tsx
      await p.load(props.source.uri, props.startAt)
      publishTracks()
      props.onState?.('ready') // after onTracks (KIT-015); Vega is experimental (decision 0001), not device-verified
      if (props.autoplay) void el.play()
```

Nothing else. The `TODO(spike)` markers, the listener leak (KIT-024) and the `buffering:false → 'playing'` mapping stay as they are — the last one means a Vega load whose Shaka buffering ends during `load()` will have its `ready` dropped by the kit rule; that is the mapping's fault and belongs to KIT-010 (§11).

### 4.4 `src/player/adapters/fireos.tsx`

No change. Its `props.onTracks?.(l.tracks)` / `props.onState?.('ready')` pair (`:122-123`) is the contract; §7.2 #1 guards the order on the real adapter.

### 4.5 `src/player/types.ts` — JSDoc only (§5)

### 4.6 Harness (`harness/player.tsx`, `harness/e2e/helpers.ts`, `harness/e2e/player.spec.ts`) — §7.1

### 4.7 Tests — §7

### 4.8 Not touched

`src/core/**`, `src/player/selection.ts`, `src/player/hls.ts`, `src/player/index.ts`, `src/index.ts`, `KitPlayerProps`/`KitPlayerRef`/`KitSource`/`AdapterProps` members, `PlayerState`, `test/selection.test.ts`, `test/exports.test.ts`, `.changeset/config.json`.

---

## 5. Public contract text — `src/player/types.ts` (JSDoc, no member changes)

**Yes, the contract text changes**, in two places. Both are documentation of behaviour the kit now guarantees; no type moves.

(a) `KitPlayerProps.onState` (line 30) gains a comment:

```ts
  /**
   * Playback state. Per load of `source.uri`: `loading` first; `onTracks` is always reported before `ready`, so
   * `getTracks()` and `selectText` work inside `onState('ready')`; `ready` is not reported for a load that has
   * already reported `playing` (an autoplay load whose tracks arrive after playback began goes
   * `loading → … → playing`, with `onTracks` in between), and it never overwrites `playing` in `renderControls`.
   * States of a source the app has switched away from are not reported (docs/decisions/0008).
   */
  onState?(state: PlayerState): void
```

(b) `AdapterProps` interface comment (lines 41-53) gains a paragraph after the origin-contract paragraph:

```ts
 *
 * State contract for one load: report `loading` when the load begins; report `onTracks` exactly once when the track
 * list is complete (docs/decisions/0004) and `ready` immediately after it, from the same continuation — never from
 * a separate event such as `loadedmetadata`. Report `playing` / `paused` / `buffering` / `ended` as the platform
 * does, before or after `ready`. The kit drops a `ready` that arrives after the load reported `playing` (Fire OS
 * reads the master playlist after ExoPlayer has started) and drops every state report that arrives through an
 * `onState` created for a source that is no longer live — so hold `onState` the same way as `onTracks`
 * (docs/decisions/0008; KIT-015, KIT-028).
```

The existing sentence "Never call `onTracks` / `onTextTrackData` for a new source synchronously during render or from your own layout effects / `useImperativeHandle`" is extended to "`onTracks` / `onTextTrackData` / `onState`".

---

## 6. Interfaces

None typed. `PlayerState` unchanged. `KitPlayerRef` unchanged. No new export.

---

## 7. Acceptance tests

Every test below exercises the real component under test: the real `WebAdapter` + real `KitPlayer` in Chromium (7.1), the real `FireOsAdapter` + real `KitPlayer` under jsdom (7.2), the real `KitPlayer` with the existing platform double (7.3). No pure helper is added, so nothing goes into `test/selection.test.ts`. The Vega guard (7.4) is a source-order pin, stated as such.

### 7.1 Harness — `harness/e2e/player.spec.ts` (real `WebAdapter`, Chromium)

**Infrastructure**

- `harness/e2e/helpers.ts` adds:
  ```ts
  /**
   * The element has its metadata (`readyState >= HAVE_METADATA`; for `src` when given). Since KIT-015 `ready`
   * waits for the manifest as well, so a spec that holds the manifest needs this witness, not `state:ready`.
   */
  export const metadataLoaded = (page: Page, src?: string) =>
    page.getByTestId('kit-video').evaluate((v: HTMLVideoElement, src) => v.readyState >= 1 && (src === undefined || v.getAttribute('src') === src), src)
  ```
  `readyState` is set before the `loadedmetadata` task fires, so a spec that polls it may run one task ahead of the adapter's `metadataSeen`; every use below is followed by a poll on an outcome that needs that promise, so this cannot race.
- `harness/player.tsx`: `Window.__kit` gains `/** The state KitPlayer last handed to renderControls (spec 26). */ state(): PlayerState`; implemented as `let kitState: PlayerState = 'idle'` set in `renderControls` (`kitState = ctx.state`) and `state: () => kitState` in `kit`.
- Header comment of `player.spec.ts` gains: "Specs 10–11 (KIT-015): `ready` is reported from the join, after `onTracks`; spec 26 (KIT-028): the kit drops a `ready` that would overwrite `playing`."

**Edits to existing specs** (the witness change; each keeps its assertions otherwise):

| Spec | Today | Change |
|---|---|---|
| 10 `onTracks waits for the manifest: nothing is published on loadedmetadata alone` | polls `hasState('ready')` while the manifest is held | rename to `onTracks and ready wait for the manifest: nothing is published on loadedmetadata alone`; replace the poll with `await expect.poll(() => metadataLoaded(page)).toBe(true)`; add `expect(await stateEvents(page, 'ready')).toBe(0)` before `m.resolve()`; after `waitForTracks`, `await expect.poll(() => hasState(page, 'ready')).toBe(true)` and `const e = await events(page); expect(e.findIndex((x) => x.type === 'tracks')).toBeLessThan(e.findIndex((x) => x.type === 'state' && x.state === 'ready'))` |
| 11 `onTracks waits for loadedmetadata: a resolved manifest alone publishes nothing` | asserts both land, order not asserted (comment says why) | rename to `onTracks waits for loadedmetadata, and ready follows onTracks: a resolved manifest alone publishes nothing`; delete the "order is not asserted" comment; after `waitForTracks` and the `ready` poll, assert the same `findIndex` order as spec 10 and `expect(await stateEvents(page, 'ready')).toBe(1)` |
| 12 `preferredText auto-selects a manifest track even when the manifest lands after ready` | polls `ready` | rename `… lands after loadedmetadata`; poll `metadataLoaded(page)` |
| 21 `after two source switches each load reports ready once and each timeupdate one position tick` | counts `ready`, `playing` | add `expect(await stateEvents(page, 'loading')).toBe(1)` next to the first `ready` count and `expect(await stateEvents(page, 'loading')).toBe(3)` next to the `ready` = 3 count; rename `… reports loading and ready once …` |
| 22 `a superseded load's onTracks never publishes: A's manifest released after B completes` | polls `ready` for A | poll `metadataLoaded(page)`; at the end add `expect(await stateEvents(page, 'ready')).toBe(1)` (B's only — A's `ready` is now inside the cancelled `.then`) |
| 23 `a superseded load's onTracks cannot latch preferredText: A's manifest released before B's` | polls `ready` for A; `stateEvents('ready') >= 2` as B's metadata witness | `metadataLoaded(page)` for A; `await expect.poll(() => metadataLoaded(page, '/stream/master-b')).toBe(true)` for B; at the end `expect(await stateEvents(page, 'ready')).toBe(1)` |
| 25 `a source switch from a timer (DefaultLane) …` | polls `ready` | poll `metadataLoaded(page)` |

`stateEvents` is already defined at line 225; hoist it above spec 10 (it is a `const`).

**New spec 26:**

`test("ready does not overwrite playing: a load whose manifest lands after play() stays 'playing' and reports no ready (KIT-028)")`
— `m = deferred()`; `routeStream(page, { manifest: m.promise })`; goto `/player.html`; poll `metadataLoaded(page)`; `expect(await stateEvents(page, 'ready')).toBe(0)`; `page.evaluate(() => window.__kit.play())`; poll `hasState(page, 'playing')`; `m.resolve()`; `waitForTracks(page)`; `page.waitForTimeout(300)`; assert `stateEvents(page, 'ready')` is `0`, `page.evaluate(() => window.__kit.state())` is `'playing'`, and the last `state` event is `playing`.

**Mutations (production code) that must turn these red:**

| Spec | Mutation |
|---|---|
| 10 | `web.tsx`: restore `['loadedmetadata', () => props.onState?.('ready')]` and remove the `ready` from the `.then` → `ready` count is 1 while the manifest is held |
| 11 | `web.tsx`: swap `props.onTracks?.(…)` and `props.onState?.('ready')` in the `.then` → `ready` index < `tracks` index. (The spec-10 mutant may leave 11 green — with the manifest already settled the `.then` runs between the two listeners, as the old comment said; spec 10 is the guard for that mutant.) |
| 21 | `web.tsx`: delete `props.onState?.('loading')` → `loading` count 0 |
| 22, 23 | `web.tsx`: delete `if (cancelled) return` in the `.then` → a second `ready` (count 2) and A's tracks, as today |
| 26 | `KitPlayer.tsx`: delete `if (s === 'ready' && playbackBegan.current) return` → `ready` count 1, `__kit.state()` = `'ready'` |

Run: `pnpm harness` (Chromium headless shell 1243 is installed here) and `pnpm typecheck:harness`.

### 7.2 `test/fireos-adapter.test.tsx` — real `FireOsAdapter` + real `KitPlayer`

**Infrastructure (in the existing rig):**

- `render(uri, headers?, opts?: { autoplay?: boolean })` passes `autoplay={opts?.autoplay}` and `renderControls={(c) => { ctx.state = c.state; return null }}`; `const ctx: { state: PlayerState | null } = { state: null }`, reset in `beforeEach`.
- Helpers: `const buffer = (isBuffering: boolean) => act(() => rig.props!.onBuffer({ isBuffering }))` and `const playbackState = (isPlaying: boolean) => act(() => rig.props!.onPlaybackStateChanged({ isPlaying }))` — the react-native-video events the adapter maps (`fireos.tsx:144-145`).

**New `describe('FireOsAdapter — tracks before ready; ready never overwrites playing (KIT-015 / KIT-028)')`:**

1. `it('reports onTracks before ready for the live load, from the same continuation')`
   — `render(A)`; `loadStart()`; `load()`; `release(0, MASTER_A)`. Assert `onTracks` called once; `states()` = `['loading', 'ready']`; `onTracks.mock.invocationCallOrder[0] < onState.mock.invocationCallOrder[1]` (the `ready` call).
   **Mutation (`fireos.tsx`):** swap lines 122-123 → `ready` is invoked before `onTracks`, red.
2. `it("ready does not overwrite playing: loading → buffering → playing → tracks leaves state 'playing' and reports no ready (KIT-028, the device sequence)")`
   — `render(A, undefined, { autoplay: true })`; `loadStart()`; `buffer(true)`; `buffer(false)` (→ `playing`, not paused); `playbackState(true)` (→ `playing` again, as the stick does); `load()`; `release(0, MASTER_A)`. Assert `states()` = `['loading', 'buffering', 'playing', 'playing']`; `onTracks` called once; `ctx.state` = `'playing'`; `api!.getTracks().text` has A's two urls.
   **Mutation (`KitPlayer.tsx`):** delete the overwrite `if` → `states()` ends with `'ready'`, `ctx.state` = `'ready'`, red. *(The device log is the oracle: `19:38:32.223 playing … 19:38:33.634 ready prev playing`.)*
3. `it("ready is still reported after buffering and paused (autoplay off): loading → buffering → paused → tracks → ready")`
   — `render(A)`; `loadStart()`; `buffer(true)`; `buffer(false)` (→ `paused`); `load()`; `release(0, MASTER_A)`. Assert `states()` = `['loading', 'buffering', 'paused', 'ready']`; `ctx.state` = `'ready'`.
   **Mutation (`KitPlayer.tsx`):** set `playbackBegan` on `paused` (or on every state except `loading`) → `ready` dropped, red. Guards against an over-eager rule.
4. `it("a source switched away from while playing does not swallow the new source's ready")`
   — `render(A, undefined, { autoplay: true })`; `loadStart()`; `playbackState(true)`; `load()`; `release(0, MASTER_A)` → no `ready`; `render(B)`; `loadStart()`; `load()`; `release(1, MASTER_B)`. Assert `states()` = `['loading', 'playing', 'loading', 'ready']`; `ctx.state` = `'ready'`.
   **Mutation (`KitPlayer.tsx`):** delete `playbackBegan.current = false` from the reset → B's `ready` dropped, red.

Stale-load `ready` on Fire OS stays covered by the existing T1 (`states()` = `['loading','loading']`) and T4; no new test. Note in T1's comment that it is now green under KIT-023 M1 because of the kit gate, and that T5 remains the adapter-cancel guard (§3).

The controls C1/C2 stay green (C1 asserts `['loading','ready']` — no `playing` before the manifest). The `adapter wiring` guard "one `onTracks` call site" stays.

### 7.3 `test/kit-player.test.tsx` — real `KitPlayer`, the platform double (PINNED #5 replaced)

**Infrastructure:** `ctx` becomes `{ tracks: Tracks | null; state: PlayerState | null }`; `renderControls` records `ctx.state = c.state`; reset in `beforeEach`. File header: replace the sentence about #5 pinning with "Since KIT-015 the state gate is asserted here too (#5–#7)".

**Test #5 today** (`"pins: a superseded load's onState('ready') still reaches the app — KIT-015 decides"`): renders A, `beginLoad()`, renders B, completes A's load through A's captured handlers, and asserts `onState.mock.calls` = `[['ready']]` — i.e. it *pins* that `handleState` is not source-scoped and forwards a superseded load's `ready`.

**Test #5 becomes** `it("drops a superseded load's onState: a report through a handler created for a source that is no longer live is not forwarded")`
— same steps; assert `onState` **not** called and `ctx.state` = `'idle'`; then `beginLoad().complete(TRACKS_B)` (B's own load, through B's handler) → `onState.mock.calls` = `[['ready']]`, `ctx.state` = `'ready'`. The second half is what catches a missing `sourceUri` dep (the handler would refuse B forever).
**Mutation (`KitPlayer.tsx`):** delete `if (sourceUri !== liveUri.current) return` in `handleState` → A's `ready` forwarded, red. Drop `sourceUri` from the deps → B's `ready` refused, red (also reddens `fireos-adapter` T1/T4 and 7.2 #4).

**New #6** `it("ready does not overwrite playing: a load whose tracks arrive after playback began stays 'playing'")`
— `render('A')`; `const loadA = beginLoad()`; `act(() => latest.props!.onState?.('playing'))`; `loadA.complete(TRACKS_A)`. Assert `onState.mock.calls` = `[['playing']]`; `ctx.state` = `'playing'`; `onTracks` called once with `TRACKS_A` (the tracks still land; only `ready` is dropped).
**Mutation:** delete the overwrite `if` → `[['playing'], ['ready']]`, red.

**New #7** `it("a source change forgets that the previous source was playing: the new source's ready is reported")`
— `render('A')`; `beginLoad().complete(TRACKS_A)`; `act(() => latest.props!.onState?.('playing'))`; `render('B')`; `beginLoad().complete(TRACKS_B)`. Assert `onState.mock.calls` = `[['ready'], ['playing'], ['ready']]`; `ctx.state` = `'ready'`.
**Mutation:** delete `playbackBegan.current = false` from the reset → `[['ready'], ['playing']]`, red.

The double is unchanged: `complete` already calls `onTracks(t)` then `onState('ready')`, which is the contract.

### 7.4 Vega — `test/hls-load.test.ts`, `describe('adapter wiring')`

The scaffold cannot render under vitest: it `require`s `@amazon-devices/react-native-w3cmedia` and `shaka-player` inside the component, neither is installed, and `vi.mock` does not reach a `require` (KIT-023 §0.5 — that is why `rnv.ts` exists). Giving Vega the same seam plus a fake Shaka `Player` (`attach`, `configure`, `addEventListener`, `load`, `getVariantTracks`, `getTextTracks`, `destroy`) and a ref-forwarding `VideoPlayer` is ~80 lines of test double for an adapter that is deferred and "does not play video as written" (0001). Not worth it before KIT-010; that plan must carry this contract with a real render test (§11).

Add, in the spirit of the existing structural guards there (`hls-load.test.ts:241`):

```ts
  it('the Vega adapter publishes tracks before it reports ready (KIT-015; source-order pin, see plan §7.4)', () => {
    const vega = src('player/adapters/vega.tsx')
    expect(vega).toMatch(/await p\.load\([^)]*\)\s*\n\s*publishTracks\(\)\s*\n\s*props\.onState\?\.\('ready'\)/)
  })
```

**Mutation (`vega.tsx`):** swap back to `ready` before `publishTracks()` → red. This is a pin of source order, not a mirror of logic; it is labelled so.

### 7.5 Counts

Vitest 168 → 175 (kit-player +2, fireos-adapter +4, hls-load +1). Harness 25 → 26. `pnpm typecheck && pnpm test && pnpm typecheck:harness && pnpm harness` green. (`pnpm lint` fails on HEAD for want of an `eslint.config.js` — pre-existing.)

---

## 8. Mutation table for the orchestrator (one at a time; revert; never commit)

| # | Mutation | Must go red |
|---|---|---|
| M1 | `KitPlayer.tsx`: delete `if (sourceUri !== liveUri.current) return` in `handleState` | kit-player #5 |
| M2 | `KitPlayer.tsx`: delete `if (s === 'ready' && playbackBegan.current) return` | kit-player #6; fireos 7.2 #2; harness 26 |
| M3 | `KitPlayer.tsx`: delete `playbackBegan.current = false` from the reset | kit-player #7; fireos 7.2 #4 |
| M4 | `KitPlayer.tsx`: `if (s !== 'loading') playbackBegan.current = true` | fireos 7.2 #3 |
| M5 | `KitPlayer.tsx`: drop `sourceUri` from `handleState` deps | kit-player #5 (second half); fireos T1, T4, 7.2 #4 |
| M6 | `web.tsx`: `ready` back on the `loadedmetadata` listener, out of the `.then` | harness 10 |
| M7 | `web.tsx`: swap `onTracks` / `ready` inside the `.then` | harness 11 |
| M8 | `web.tsx`: delete `props.onState?.('loading')` | harness 21 |
| M9 | `fireos.tsx`: swap `props.onTracks?.(l.tracks)` / `props.onState?.('ready')` | fireos 7.2 #1 |
| M10 | `vega.tsx`: `ready` before `publishTracks()` | hls-load Vega pin |

---

## 9. Decision record — `docs/decisions/0008-tracks-before-ready.md` (for the orchestrator to commit)

```
# 0008 — `onTracks` precedes `ready`; `ready` never overwrites `playing`; state reports are origin-gated

**Date:** 2026-09-29
**Status:** accepted — orchestrator, under `docs/ORCHESTRATOR.md` §3.2; amends 0005 §3; the human may veto §2 before 0.1.0
**Tickets:** KIT-015, KIT-028 · **Plan:** `docs/plans/KIT-015-tracks-before-ready.md`

## Context

The order of `onTracks` and `onState('ready')` was never a contract and differed per adapter (KIT-005 review):
Fire OS tracks → ready, Vega ready → tracks, web race-dependent. An app that reads `getTracks()` or calls
`selectText` in `onState('ready')` got an empty list on web. Separately, on Fire OS the master-playlist read
that produces `onTracks` completes after ExoPlayer has started playing, so the adapter's `ready` arrived
0.6–1.2 s after `playing` and overwrote it for the rest of playback (KIT-028; device log 2026-09-27). No
adapter ordering fixes that: `ready` cannot precede `onTracks`, and holding `playing` until the manifest
lands would show a spinner over video that is audibly playing.

## Decision

1. **Per load, every adapter reports `loading`, then exactly one `onTracks` (0004), then `ready` — from the
   same continuation as `onTracks`.** Web reports `ready` from its manifest + metadata join (it previously
   reported it on `loadedmetadata` alone, and never reported `loading`); Vega publishes tracks before
   `ready`; Fire OS already complied.
2. **`ready` means "loaded, not yet playing". The kit drops a `ready` for a load that has already reported
   `playing` or `ended`.** An autoplay load whose tracks arrive after playback began therefore reports
   `loading → … → playing` and no `ready`; `onTracks` still arrives in between. `buffering` and `paused`
   before `ready` do not suppress it — Fire OS reports both before the manifest-gated `ready` on every load,
   and an autoplay-off load must end in `ready`. Apps must not wait for `ready` to leave a loading screen;
   `onTracks` says the tracks are known and `playing` says playback started. (`described` reads only
   `buffering`; `lingo` only `paused`/`ended`; neither changes.)
3. **The kit drops every state report that arrives through an `onState` created for a source that is no
   longer live** — the KIT-022 gate extended from `onTracks` to `handleState`, for all states. Every adapter
   reports state through per-load closures or latest-props handlers, so a report through a superseded
   handler is a superseded load's or a duplicate. Adapter-side cancellation remains required for adapter
   state (0005 §3 amendment); the gate is the kit's own guarantee for adapters that do not cancel (the Vega
   scaffold; any future adapter).
4. **The rules live in the kit, not in each adapter.** The kit owns `PlayerState` and its meaning, so it
   enforces the state model once, where `renderControls`' `state` is set. 0005 §3 stands: the kit never
   synthesises `onState`; it now also refuses one. The kit does not re-order or defer reports — ordering is
   the adapter's obligation, stated in `AdapterProps`.

## Consequences

- No type changes. `KitPlayerProps.onState` and `AdapterProps` JSDoc state the contract.
- Web: `ready` arrives later than before by the manifest's latency; `loading` is now reported.
- The sample app's KitSpike HUD workaround (`KitSpikeScreen.tsx:116-118`, "treat `ready` as playing") can be
  removed; `Play/Pause` must key on `playing` alone.
- Harness specs that used `state:ready` as "the element has metadata" use `video.readyState` instead.
- KIT-023's mutation M1 now reddens only T5 (the kit gate masks T1); the adapter cancel is still guarded.
```

*Amendment to append under 0005 §3:* "*Amended (KIT-015/KIT-028, decision 0008):* the kit also refuses two kinds of state report — a `ready` that arrives after the live load reported `playing`/`ended`, and any state through a handler created for a source that is no longer live. Refusing is not synthesising; the kit still emits no state of its own."

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | An app that hides its loading screen only on `ready` would hang on an autoplay load. | None of the three consumers does (§1). 0008 §2 says so; `onState` JSDoc says so; the changeset says so. Human veto slot in 0008. |
| R2 | The harness `metadataLoaded` witness can be true one task before the adapter's `metadataSeen` resolves. | Every use is followed by a poll on an outcome that needs the promise (tracks, cues, `heldReady`); nothing asserts synchronously on it. |
| R3 | Kit-side gates mask adapter regressions: a leaked web `ready`/`playing` listener or an uncancelled Fire OS continuation no longer shows up as a duplicate `ready` at the app. | Spec 21 still counts `onPosition` against `timeupdate` (`handlePosition` is not gated) and KIT-023 T5 still reddens on the adapter's M1 (§3). Stated in the KIT-023 notes. |
| R4 | Web maps the `play` *event* (fired when `play()` is called, before data) to `playing`, so an autoplay web load reports `playing` at once and its `ready` is always dropped. | Consistent with the rule (the adapter said `playing`). The truthful mapping is the `playing` event — filed under KIT-025 (§11), not changed here because spec 7/21 timings would need re-verification. |
| R5 | Vega's `buffering:false → 'playing'` mapping can suppress its `ready`. | Experimental (0001); KIT-010 note (§11). The structural pin only guards order. |
| R6 | `handleState` is re-created per `source.uri`; an adapter that caches `props.onState` across loads would be refused forever. | Same exposure already accepted for `onTracks`/`onTextTrackData` (KIT-022 R1); contract text in `AdapterProps`; kit-player #5's second half catches a kit-side dep mistake. |
| R7 | StrictMode double-invokes the web load effect → two `loading` reports on mount in dev. | Harmless; the harness does not run StrictMode; both are for the live source. |
| R8 | Between a switch and Fire OS's `onLoadStart` (~0.9 s on the stick) `state` still shows the previous source's `playing`. | Pre-existing (0005 §3: the kit does not synthesise `loading`); not this ticket. |

---

## 11. Orchestrator notes (not questions)

- `TASKS.md`: KIT-015 and KIT-028 done in one commit; progress-log tests 175 + 26. Add to the KIT-023 notes the M1/T5 remark (§3). Device matrix "Seek / rate" row: replace the KIT-028 note with "fixed by 0008; HUD reads `playing`" after the device check below.
- **Device check (human, optional but cheap — Metro loads `src/` live):** remove the KitSpike HUD workaround (`KitSpikeScreen.tsx:116-118`, key `Play/Pause` on `state === 'playing'` only), run the screen: expect `state loading → buffering → playing` and **no** `state ready` line after `tracks`; `Play/Pause` pauses; after *Switch src* the same shape. Log to `spike-evidence/fireos-kit015-state.log`. The jsdom replay in 7.2 #2 is the device log verbatim, so this is confirmation, not the guard.
- KIT-025 (web lows) gains: "the web adapter reports `playing` on the `play` event, not the `playing` event, so an autoplay load reports `playing` before it has data (R4)".
- KIT-010 (Vega rewrite) gains: "must comply with 0008 — `onTracks` then `ready` from the load continuation; `buffering:false` must restore the previous state, not report `playing`; add a `w3c.ts`/`shaka.ts` seam like `rnv.ts` so the real adapter renders under vitest and the §7.4 source pin is retired".
- Model routing: implementation is mechanical (every line is above) → Opus. Review → Fable with §8. The harness edits touch seven specs; the reviewer should confirm each renamed spec still fails on its mutation.
- Optional follow-up, not folded in: gate `handlePosition` by origin the same way (a stale `onPosition` can set `position` for one tick after a switch). One line; needs its own guard; ticket if wanted.

## 12. Open questions

None that block. The one semantic call — an autoplay load may never report `ready` (0008 §2) — is recorded for the human's veto in the decision record, as 0005 was; the consumers are verified unaffected.

---

## 13. Changeset paragraph — append to `.changeset/release-0-1-0.md` (still `minor`)

```
**`onTracks` always precedes `ready`, and `ready` never overwrites `playing`.** Every adapter now reports a
load's tracks before its `ready`, from the same step: the web adapter reports `ready` once both the element's
metadata and the master playlist are in (previously on `loadedmetadata` alone, so `getTracks()` inside
`onState('ready')` could be empty), and now reports `loading` at the start of each load; the Vega adapter
publishes tracks before `ready`. `ready` means "loaded, not yet playing": the kit no longer reports it for a
load that has already reported `playing` — on Fire OS the master-playlist read finishes after ExoPlayer has
started, so `ready` used to arrive after `playing` and stay as the state for the rest of playback. An autoplay
load whose tracks arrive after playback began now reports `loading → buffering → playing`, with `onTracks` in
between and no `ready`; apps should leave their loading screen on `playing` (or `onTracks`), not on `ready`.
State reports from a source the app has switched away from are dropped, the way its track reports and
WebVTT already were. Multi-track text selection is unchanged.
```
