# KIT-020 — `getTracks()` never answers a superseded source (web + Vega halves, plus a kit-side gate)

**Role chain:** Planner (opus, standing in for fable; this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3, §4. **Decisions:** 0005 (§2.4, §3 amendments, Consequences (a)), 0008, 0001
(Vega experimental). **Plans:** KIT-023 (Fire OS half, `95564b2`), KIT-025 (§1 KIT-020 note, Q4).
**Base:** `4abcefc`. **Status:** ready for an implementer. Nothing in §10 blocks.

Ticket text (`TASKS.md` KIT-020): "Adapters keep the previous source's `tracks` ref until the new `onTracks`
(`web.tsx:13`, `vega.tsx:21`, `fireos.tsx:25`); fireos `audioIndex` survives a switch (`fireos.tsx:23`)". Fire OS half
done in `95564b2`. KIT-025's planner added: after a failed load (`MEDIA`), web `getTracks()` shows the previous source's
tracks indefinitely.

---

## 0. Verdict at a glance

1. **Confirmed on `4abcefc`; line refs drifted.** Web: `tracks` ref `web.tsx:64`, written only by the join
   (`:93-97`), read by `selectText` (`:145`) and `getTracks` (`:162`). Vega: `tracks` ref `vega.tsx:22`, written only by
   `publishTracks` (`:51-56`), read by `getTracks` (`:87`). Neither is reset on a `source.uri` change. KitPlayer's
   `api.getTracks` (`KitPlayer.tsx:241`) is `adapterRef.current?.getTracks() ?? tracksRef.current` — it prefers the
   adapter, so the kit's own reset (`:218-219`) never reaches the API.
2. **The web defect is worse than a wrong `getTracks()` answer — it is A's captions on B.** Web `selectText` resolves
   ids against `tracks.current` (`web.tsx:145`). An app that calls `selectText(['0'])` after a switch and before B's
   `onTracks` (a track sheet built from `getTracks()`, which answers A's list) makes the adapter fetch **A's** playlist
   for `'0'` and deliver it through **this render's** `onTextTrackData` — B's handler, so the kit's per-uri gate
   (`acceptsTextTrackData`) accepts it: A's captions on B. Permanent when `preferredText` is empty/absent (nothing
   re-selects `'0'` on B's `onTracks`). Same class as KIT-023 D1. After a failed switch (B's media 404s, no
   `loadedmetadata`, no join) it lasts forever. **So the adapter reset is a correctness fix, not hygiene.**
3. **Do both — adapter resets and a kit-side gate.** (§3)
   - *Adapters* (web, Vega) reset their `tracks` ref in a **layout effect keyed on `source.uri`**, like Fire OS. Required
     because adapter-internal state (web `selectText`'s url lookup) is invisible to any kit gate (0005 §3 KIT-022
     amendment: "Adapter-side cancellation remains required for adapter-internal state").
   - *KitPlayer* stops preferring the adapter until the live source's first `onTracks` has passed the origin gate. Until
     then `api.getTracks()` answers the kit's own list — exactly what `renderControls` is showing. This is the kit-side
     guarantee for every adapter, present and future (the KIT-010 rewrite), in the same spirit as the 0005 gates: the
     kit refuses an answer it cannot attribute to the live source; it synthesises nothing. Once the live source has
     published, the adapter is preferred again, so Fire OS's KIT-029 `active` marking on `selectAudio` stays visible.
4. **"On a failed load" needs no extra rule.** A failed load either publishes no `onTracks` (error before metadata) —
   then the switch reset alone yields empty — or publishes its *own* tracks (error after `loadedmetadata`, join
   completes, KIT-025 §3.1) — those belong to the live source, `renderControls` shows them, and `getTracks()` must agree.
   Neither the kit nor the adapter clears tracks on `error`. The rule is "never a *superseded* source's", and
   "consistent with `renderControls`' `tracks`".
5. **No other per-source adapter state survives a switch on web or Vega** in a way this ticket owns (§2). Web has no
   selected-id set, no audio selection (`selectAudio` is a no-op), no `hlsText` cache (the manifest promise is a
   per-load local), no `textUrls` (urls live on `tracks.current.text`, reset here). Vega's text/audio selection is
   per Shaka `Player`, which is per load. Two adjacent observations are filed as non-blocking follow-ups (§10 Q2, Q3).
6. **Vega: minimal.** One layout-effect reset, plus a `require` seam (`adapters/w3c.ts`, the `rnv.ts` precedent) so a
   vitest can render the adapter with Shaka and w3cmedia mocked. No behaviour change beyond the reset. KIT-024's defects
   stay KIT-024/KIT-010's; §6 lists what KIT-010 must preserve.
7. Changeset **patch**. No type change, no export change.

---

## 1. Scope boundaries

In: web `tracks` reset; Vega `tracks` reset + require seam; KitPlayer `getTracks` gate (+ reset-order fix §3.3);
JSDoc on `KitPlayerRef.getTracks` and `AdapterProps`; tests; harness specs 43–45 (+ one harness hook); changeset.

Out (do not touch):
- **KIT-033** (Vega `play()` guard, `playing` on `'play'`), **KIT-034** (Fire OS/Vega `onState('error')`),
  **KIT-035** (retry on same uri). Not a line of `vega.tsx:41,44` or `selection.ts:29` changes.
- **KIT-024** (Vega listener leak at `vega.tsx:43-46`, uncancelled `attach().then`, `publishTracks` reading
  `player.current`). Deliberately *not* fixed: see §6 — the `player.current` read is, today, what keeps a stale Vega
  continuation from writing A's tracks back; changing it without a cancel would regress this ticket.
- `getPosition()` during a switch (§10 Q2), web `playbackRate` across a switch (§10 Q3), abandoning in-flight
  `selectText` fetches (0005 Consequences (c), already gated by the kit).
- Fire OS: no change. Its tests must stay green.

---

## 2. Per-source adapter state — survey (web, Vega) on `4abcefc`

| State | Where | Survives a switch? | Action |
|---|---|---|---|
| web `tracks` ref | `web.tsx:64` | **yes** — until B's join; forever if B fails before metadata | reset (§3.1) |
| web text urls | on `tracks.current.text[].url`, read at `:145` | yes (same ref) | covered by the reset |
| web selected text ids | none in the adapter (kit owns `selectedText`) | — | — |
| web audio selection | `selectAudio: () => {}` (`:140`) | — | — |
| web manifest promise / `hlsText` | per-load local `manifest` (`:76`), join guarded by `cancelled` (`:86`) | no | — |
| web stale join write | `tracks.current = …` only `if (!cancelled)` (`:86-93`) | no | — (this is why a reset cannot be undone by A) |
| web in-flight `selectText` fetch | `for … await` loop (`:144-159`) delivers through A's handler | dropped by the kit gate | out of scope (0005 (c)) |
| web element `playbackRate` | `<video>` reused; HTML load algorithm resets it to `defaultPlaybackRate` on a new `src` | no on web; **yes on Fire OS** (`rate` state) | §10 Q3, not here |
| web element position | `el.currentTime` is A's until the passive effect sets `v.src` | briefly | §10 Q2, not here |
| Vega `tracks` ref | `vega.tsx:22` | **yes** — until B's `publishTracks` | reset (§3.2) |
| Vega `player` ref | `vega.tsx:21`, replaced in the passive load effect (`:28`) | until the passive effect | — (KIT-024/KIT-010) |
| Vega text/audio selection | inside the Shaka `Player`, one per load | no | — |
| Vega element listeners | `vega.tsx:43-46`, never removed | yes (leak) | KIT-024, out |

---

## 3. Files and behaviour rules

### Files to touch

| File | Change |
|---|---|
| `src/player/adapters/web.tsx` | layout-effect reset of `tracks.current` keyed on `source.uri` (§3.1) |
| `src/player/adapters/vega.tsx` | same reset (§3.2); `require`s moved behind the seam |
| `src/player/adapters/w3c.ts` (new) | `requireW3cMedia()`, `requireShaka()` — the `rnv.ts` pattern (§3.2) |
| `src/player/KitPlayer.tsx` | `tracksPublished` gate on `api.getTracks`; reset-order fix (§3.3) |
| `src/player/types.ts` | JSDoc only: `KitPlayerRef.getTracks`, `AdapterProps` contract line (§3.4) |
| `test/web-adapter-lows.test.tsx` | new `describe` (§5.1 W1–W6); `renderControls` double also captures `tracks` |
| `test/kit-player.test.tsx` | the double's `getTracks` returns a mutable list; new `describe` (§5.2 K1–K5) |
| `test/vega-adapter-tracks.test.tsx` (new) | §5.3 V1–V4 |
| `harness/player.tsx` | `__kit.tracks()` — the `tracks` KitPlayer last handed `renderControls` (§5.4) |
| `harness/e2e/player.spec.ts` | specs 43–45; header comment line for them |
| `.changeset/kit-020-get-tracks-reset.md` (new) | patch (§8) |

### 3.1 Web adapter

```tsx
import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
…
const tracks = useRef<Tracks>({ audio: [], text: [] })

/**
 * A `source.uri` change forgets the previous source's tracks — and with them the text urls `selectText` resolves ids
 * against — in the same commit as KitPlayer's reset, before anything of the new load can run (KIT-020). Without it a
 * `selectText(['0'])` made during the new load fetched the previous source's playlist for '0' and delivered it through
 * the live handler (A's captions on B), and a failed new load left the previous list in `getTracks()` for good.
 * Layout, not passive: child layout effects run before KitPlayer's, so nothing the kit emits during its reset
 * (`onCue([])`) can observe the old list. A no-op on mount; idempotent under StrictMode. Reports nothing.
 */
useLayoutEffect(() => {
  tracks.current = { audio: [], text: [] }
}, [props.source.uri])
```

Rules:
- **R-W1.** After a `source.uri` change, `WebAdapter`'s `getTracks()` returns `{ audio: [], text: [] }` (a fresh object)
  until this load's join publishes; then exactly what it published.
- **R-W2.** `selectText(ids)` during that window resolves no id (each `continue`s at `:146`): no fetch, no
  `onTextTrackData`, no `TEXT_FETCH`. Ids are only meaningful against the live source's `onTracks` (decision 0004).
- **R-W3.** No reset on `error`. A load that publishes its own tracks after a media error keeps them (KIT-025 §3.1).
- Placed above the load `useEffect`. The load effect is unchanged (`tracks.current` is still assigned only in the
  `!cancelled` join).

### 3.2 Vega adapter (experimental — decision 0001)

`src/player/adapters/w3c.ts` (new; mirrors `rnv.ts`):

```ts
import type React from 'react'

/** The w3cmedia module as the Vega adapter uses it. */
export type W3cMedia = { VideoPlayer: React.ComponentType<Record<string, unknown>> }

/**
 * The one place the Vega peers are loaded. Lazy `require`s, so the kit imports cleanly where they are not installed
 * (Fire OS, Node). A module of its own so the Vega adapter can render under vitest with both replaced: `vi.mock`
 * intercepts this ES import, not a `require` inside the adapter (test/vega-adapter-tracks.test.tsx). Names unchanged
 * from the scaffold; they are confirmed (or not) by KIT-010 on the VVD.
 */
export function requireW3cMedia(): W3cMedia {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@amazon-devices/react-native-w3cmedia') as W3cMedia
}
export function requireShaka(): typeof import('shaka-player') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('shaka-player') as typeof import('shaka-player') // installed via the sample's post-install step
}
```

`vega.tsx`: `const w3c = requireW3cMedia()`, `const shaka = requireShaka()` (replacing `:16-19`), and the same reset
as web, placed after the refs (`:22`), with a shorter comment that also states the KIT-010 constraint:

```tsx
/** A `source.uri` change forgets the previous source's tracks in the same commit as KitPlayer's reset (KIT-020).
 *  KIT-010: a superseded load must never write `tracks` afterwards — see the plan §6. */
useLayoutEffect(() => {
  tracks.current = { audio: [], text: [] }
}, [props.source.uri])
```

Nothing else in `vega.tsx` changes. `setVolume: setVolumeUnsupported,` stays byte-identical (pinned by source in
`test/vega-adapter-volume.test.ts`). Do not touch, delete or rename any `TODO(spike)` marker (CLAUDE.md).

Rules: **R-V1** as R-W1 for `VegaAdapter.getTracks()`. **R-V2** a continuation or Shaka event of the superseded load
that runs after the switch does not put the superseded source's tracks back (holds today because `publishTracks` reads
`player.current`, i.e. the new load's player — §6).

### 3.3 KitPlayer — the `getTracks` gate

```tsx
/**
 * Whether the live source's tracks have been reported: its first `onTracks` passed the origin gate. Until then
 * `getTracks()` answers the kit's own list — empty since the reset, what `renderControls` shows — never the adapter's,
 * which may still hold a superseded source's (KIT-020; every adapter resets its own too, but the kit does not rely on
 * it — 0005 §3). Afterwards the adapter is preferred again: it can be fresher than the last `onTracks` (Fire OS marks
 * the `selectAudio` pick active without re-publishing, KIT-029).
 */
const tracksPublished = useRef(false)
```

- `handleTracks` (`:128-147`): after the origin-gate `return`, **before** `onTracksRef.current?.(t)` and before the
  `appliedPrefs` block: `tracksPublished.current = true` (next to `tracksRef.current = t`). So `getTracks()` inside the
  app's `onTracks`, inside the auto-selection, and inside `onState('ready')` answers the adapter (== `t`).
- Reset layout effect (`:209-223`): set `tracksPublished.current = false` **and move `tracksRef.current = { audio: [],
  text: [] }` up**, both before `scheduler.update(start)` (`:217`) — directly after `readyClosed.current = false`.
  Today `tracksRef` is reset *after* `scheduler.update`, which synchronously emits `onCue([])`; an app reading
  `getTracks()` in that callback would get the old list from the fallback. `setTracks(...)` stays where it is
  (`renderControls` does not render inside the effect). `positionRef` is not moved (§10 Q2).
- `api.getTracks` (`:241`):
  `getTracks: () => (tracksPublished.current ? adapterRef.current?.getTracks() ?? tracksRef.current : tracksRef.current),`
  `api`'s deps are unchanged (a ref), so its identity stays stable (KIT-012 spec 20).

Rules:
- **R-K1.** From a `source.uri` change (inclusive of everything emitted during the kit's reset) until the live source's
  first accepted `onTracks`, `api.getTracks()` deep-equals `renderControls`' `tracks`: `{ audio: [], text: [] }`.
- **R-K2.** A report refused by the origin gate (a superseded load's `onTracks`) does not open the gate.
- **R-K3.** After the live source's `onTracks`, `api.getTracks()` returns the adapter's answer (unchanged behaviour).
- **R-K4.** On first mount the same rule applies (empty until the first `onTracks`) — indistinguishable from today for
  all three adapters, which start empty.
- **R-K5.** Never cleared on `onState('error')` / `onError` (R-W3).
- The kit still emits nothing new: no `onTracks`, no state. Answering a query from the kit's own reset state is 0005
  §2.4's existing fallback, not synthesis.

Known limit, unchanged (0005 §3 KIT-016 amendment): A → B → A revives A's first-load handlers; an adapter that does not
cancel its own superseded load (today: Vega) could open the gate with the first A load's report. Same uri, so not "a
superseded source" by 0005 §1; noted for KIT-010.

### 3.4 JSDoc (`src/player/types.ts`)

- `KitPlayerRef.getTracks()`: "The live source's tracks. Empty from a `source` change (and on mount) until that source's
  `onTracks` — the same list `renderControls` is handed; never a previous source's. Ids are only valid for the source
  that reported them (decision 0004)."
- `AdapterProps` contract paragraph, append one sentence: "`getTracks()` and anything resolved from it (text urls) must
  not answer a previous source after `source.uri` changes: reset per-source state in a layout effect keyed on
  `source.uri` (KIT-020) — resetting is not reporting, so this is allowed where reports are not."

---

## 4. Order of work (TDD)

1. Seam first (`w3c.ts`, `vega.tsx` requires). `pnpm typecheck && pnpm test` green, no behaviour change.
2. Write W1–W6, K1–K5, V1–V4 (and the test-double edits). Run: the "red on base" column of §7 must match.
3. Web reset → W2, W3(selectText part), W5 green. Vega reset → V1 green.
4. KitPlayer gate + reorder → K1, K3, K4 green; K2, K5, W6 stay green.
5. Harness hook + specs 43–45 (`pnpm harness`). Changeset. `pnpm typecheck && pnpm test && pnpm lint`.

---

## 5. Acceptance tests

### 5.1 Vitest — real `KitPlayer` + real `WebAdapter` (`test/web-adapter-lows.test.tsx`, new `describe`)

`describe('WebAdapter + KitPlayer: tracks never outlive their source (KIT-020)')`. Uses the file's held-manifest
`fetch`, `fire`, `fail`, `fetched`. `renderControls` double additionally records `ctx.tracks`. A's and B's manifests
are the same body, so their urls differ only by base (`…/a/subs/…` vs `…/b/subs/…`); no `preferredText` (so nothing
auto-selects and every fetch after the switch is the test's own).

- **W1** `it("getTracks() is empty right after a switch while the new manifest is held, equals renderControls' tracks, and is the new source's list once it lands")`
- **W2** `it("selectText(['0']) during the new source's load fetches nothing of the previous source's and delivers no cue")`
  — after `render(B)`: `api.selectText(['0'])`, flush; no `fetched` entry under `https://cdn.example/a/subs/`; no
  `onTextTrackData` reaches the scheduler (`onCue` never called with a cue). Red on base: fetches A's `de` playlist.
- **W3** `it('after a switch to a source whose media fails before metadata (MEDIA), getTracks() and renderControls stay empty and selectText fetches nothing of the previous source')`
  — A complete; `render(B)`; `fail(4)`; `releaseManifest(B)`; flush; assert empty `getTracks()`, empty `ctx.tracks`,
  `onTracks` called once (A's), then `selectText(['0'])` fetches nothing under `/a/`.
- **W4** `it("a load that fails after loadedmetadata keeps its own published tracks: getTracks() equals renderControls' tracks")`
  — R-W3/R-K5: `fire('loadedmetadata')`, `fail(3)`, `releaseManifest(A)` → `getTracks()` is A's list and equals
  `ctx.tracks`.
- **W5** `it('WebAdapter alone: getTracks() is empty right after source.uri changes, without KitPlayer')` — render
  `WebAdapter` directly (its own ref, plain `vi.fn` handlers); complete A; re-render with B; adapter `getTracks()` empty.
  The adapter-side guard the kit gate cannot mask.
- **W6** `it("getTracks() inside onTracks and inside onState('ready') answers the new source's list after a switch")`
  — inline handlers record `api.getTracks()`; both equal B's list.

### 5.2 Vitest — real `KitPlayer` + platform double (`test/kit-player.test.tsx`)

Double change: `getTracks: () => adapterTracks`, with module-level `let adapterTracks: Tracks` reset in `beforeEach`;
`complete(t)` sets `adapterTracks = t` before publishing (also for a refused stale report — "an adapter that keeps the
previous list and does not cancel", web/Vega before KIT-020); `selectAudio(id)` marks `id` active in `adapterTracks`
(Fire OS KIT-029 shape). Existing tests unaffected (they never read `getTracks()`; verify by running them).

`describe('KitPlayer getTracks gate: the adapter is not asked until the live source has reported (KIT-020)')`
- **K1** `it("answers the empty list from a source change until the new source's onTracks, though the adapter still holds the previous list")`
- **K2** `it("prefers the adapter once the live source's onTracks is accepted: an audio pick the adapter marks is visible (KIT-029)")`
- **K3** `it("a superseded load's onTracks, refused by the origin gate, does not open the gate: getTracks() stays empty")`
- **K4** `it('getTracks() read from the onCue([]) the switch emits answers the empty list')` — cues on screen via
  `preferredText` + the double's synchronous VTT + `api.seek(1)`; the app's `onCue` records `api.getTracks()` when
  called with `[]`.
- **K5** `it("on first mount getTracks() is empty until the first onTracks, then the adapter's answer")`

### 5.3 Vitest — Vega (`test/vega-adapter-tracks.test.tsx`, new, `// @vitest-environment jsdom`)

Mocks: `vi.mock('react-native', () => ({ Platform: { OS: 'kepler' } }))`;
`vi.mock('../src/player/adapters/w3c', () => ({ requireW3cMedia: () => rig.w3c, requireShaka: () => rig.shaka }))`.
- `rig.w3c.VideoPlayer`: `forwardRef((_p, ref) => React.createElement('video', { ref }))` (jsdom element; the adapter
  only calls `addEventListener`/`play`/`pause`/`currentTime`; stub `play`/`pause` as in the web tests).
- `rig.shaka.Player`: a class recording every instance; `attach()` and `load()` return per-instance deferreds the test
  resolves; `configure()` returns true; `addEventListener(type, fn)` records listeners per instance (so a test can fire
  A's `trackschanged`); `getVariantTracks()`/`getTextTracks()` return `[]` until that instance's `load` resolved, then
  the instance's fixture (A: one `en` variant + text `{ id: 1, language: 'en' }`; B: `de` + `{ id: 7, language: 'de' }`
  — `fromShakaVariants`/`fromShakaText` input shapes); `destroy()` resolves.
- Render **`VegaAdapter` directly** (its own ref, `vi.fn` handlers): the kit gate (§3.3) would mask the adapter reset
  through KitPlayer.

`describe('VegaAdapter: tracks never outlive their source (KIT-020; experimental, mocked Shaka)')`
- **V1** `it('getTracks() is empty right after source.uri changes, before the new player has attached')`
- **V2** `it("a superseded load whose attach/load settle after the switch does not put the previous source's tracks back")`
  — A's deferreds still pending at the switch; resolve them after `render(B)`; adapter `getTracks()` is not A's list
  (it is the new player's pre-load `[]`). This is the KIT-010 invariant (§6).
- **V3** `it("a trackschanged from the previous source's player after the switch does not put its tracks back")`
- **V4** `it("the new source's tracks are what getTracks() answers once its load publishes")`

### 5.4 Harness — real `KitPlayer` + `WebAdapter` in Chromium (`harness/e2e/player.spec.ts`)

Harness hook (`harness/player.tsx`): `tracks(): Tracks` on `window.__kit` — the `tracks` KitPlayer last handed
`renderControls` (captured next to `kitState`). Header comment: "Specs 43–45 (KIT-020): `getTracks()` never answers a
superseded source and equals `renderControls`' `tracks` during a load and after a failed one."

- **43** `test("getTracks() is empty while B's manifest is held after A, equals renderControls' tracks, and is B's list once it lands (KIT-020)")`
  — `routeStream(page, { hold: { 'master-b': b.promise } })`; `/player.html` (no `preferred`); wait for A's tracks;
  `setSource('/stream/master-b')`; `getTracks()` and `__kit.tracks()` both `{audio:[],text:[]}`; `b.resolve()`; poll two
  `tracks` events; `getTracks().text` equals `MANIFEST_TRACKS_B`.
- **44** `test("selectText(['0']) while B's manifest is held fetches nothing of A's and shows no cue (KIT-020)")`
  — same setup; after the switch `selectText(['0'])`; `waitForTimeout(500)`; no hit starting `fetch subs/de/` after
  the switch (count hits before/after); `cueText(page, 2)` is `[]` (A's `de` cue would show). Red on base.
- **45** `test("after a switch to a source whose media answers 404, getTracks() stays empty — not the previous source's — and equals renderControls (KIT-020 × KIT-025)")`
  — `routeStream(page, { mediaRespond: { 'master-b': { status: 404, body: 'Not Found' } } })`; A loads; switch; poll
  `state()` = `error`; `waitForTimeout(500)`; `getTracks()` and `__kit.tracks()` empty; one `tracks` event in total
  (A's). Red on base (getTracks is A's list).

---

## 6. What KIT-010 (the Vega rewrite) must preserve

1. **R-V1/R-V2 — V1–V4 must stay green** (rewrite them against the new surface, but keep the four behaviours).
2. **A superseded load never writes the adapter's per-source state.** Today R-V2 holds only by accident: `publishTracks`
   reads `player.current` (the *new* load's player), so A's late `attach().then` continuation or A's `trackschanged`
   writes B's (pre-load, empty) lists, never A's. KIT-024's suggested fix — "read `p`, not `player.current`" — **without**
   a per-load cancel (`if (cancelled) return` / a load record like Fire OS's) would write A's tracks back after the reset
   and break V2/V3. Fix KIT-024 as one change: per-load `cancelled` + read `p` + remove `p`'s and the element's listeners
   in the cleanup.
3. Keep the reset in a **layout** effect (or a Fire-OS-style load record swapped in one), so it precedes KitPlayer's
   reset and every passive effect.
4. Keep the `w3c.ts` seam (or an equivalent ES-import seam) so the adapter stays renderable under vitest.
5. Publish `onTracks` through the handler held by the load (origin contract); the kit's `getTracks` gate opens on it.

---

## 7. Mutation table (for the reviewer)

| # | Mutation | Caught by | Red on base? |
|---|---|---|---|
| M1 | Delete the web layout reset | W2, W3 (selectText half), W5; harness 44 | W2, W3, W5 red on base |
| M2 | Web reset moved into the load effect's passive cleanup | **not pinned** — under `act` and in Chromium the passive cleanup runs inside the switch's commit (KIT-022 §1), indistinguishable; layout placement is for determinism (§3.1 comment). Reviewer: accept or ask for a contrived `selectText`-inside-`onCue([])` test | — |
| M3 | Web reset on `error` (clearing own tracks) | W4 | green on base |
| M4 | Delete the Vega reset | V1 | V1 red on base |
| M5 | Vega `publishTracks` reads `p` instead of `player.current` (KIT-024 half-fix, no cancel) | V2, V3 | green on base (pins §6.2) |
| M6 | `api.getTracks` back to always preferring the adapter | K1, K3, K4 (web tests are masked by M1's fix — expected) | K1, K3, K4 red on base |
| M7 | `tracksPublished` never reset on a switch | K1, K4 | — |
| M8 | `tracksPublished = true` before the origin-gate `return` | K3 | — |
| M9 | `tracksPublished = true` after `onTracksRef.current?.(t)` | W6 (getTracks inside onTracks would be the empty fallback) | — |
| M10 | `tracksRef` reset left after `scheduler.update(start)` (today's order) | K4 | K4 red on base |
| M11 | Gate keyed on "any onTracks ever" (never reset) instead of per source | K1 | — |
| M12 | Vega seam: `requireShaka` returns the module's default export | V1–V4 (constructor missing) | — |

Masking note (as in KIT-023 T1): the Fire OS test `drops a superseded load's continuation: … getTracks() stays empty`
and W1 become kit-gate guards, not adapter guards. Adapter guards are W2/W3/W5 (web), V1–V3 (Vega), Fire OS T6's
`selectText` assertion (Fire OS) — none of them go through `api.getTracks()` alone.

---

## 8. Changeset — `patch`

`.changeset/kit-020-get-tracks-reset.md`:

```md
---
'@moizp/vega-media-kit': patch
---

**`getTracks()` never answers a previous source.** After `source.uri` changes, `ref.getTracks()` now returns an empty
list until the new source reports its tracks through `onTracks` — the same list `renderControls` is handed — on every
platform. Previously, on web and Vega it kept returning the previous source's tracks while the new one loaded, and on
web indefinitely if the new source failed to load. **Web:** a `selectText([...])` made in that window no longer fetches
the previous source's subtitle playlist for that id and shows its captions on the new source; it selects nothing until
the new source's tracks are in — select by the ids reported for the live source. A load that fails after reporting its
own tracks keeps them. No type changes; multi-track text selection is unchanged.
```

---

## 9. Decision record (orchestrator)

Amend **0005**: Consequences (a) → *resolved (KIT-020)*: adapters reset per-source state in a layout effect keyed on
`source.uri` (Fire OS `95564b2`, web and Vega here), and the kit enforces it: `api.getTracks()` answers the kit's own
list until the live source's first accepted `onTracks`, then prefers the adapter. §2 step 4 note: `tracksRef` (and the
published flag) are reset before step 3's `scheduler.update`, so `getTracks()` read inside the `onCue([])` the reset
emits answers empty. TASKS: KIT-020 row → done; KIT-024 row → append "KIT-010: see `docs/plans/KIT-020…` §6 — reading
`p` needs the cancel in the same change".

---

## 10. Open questions (none blocking)

- **Q1 (non-blocking, decided here).** Kit gate *and* adapter resets, or adapter-only? Both: adapter-only leaves every
  future adapter (KIT-010) to get it right with nothing at the API to catch it; kit-only leaves web's A-captions-on-B
  (§0.2). The two halves are separable (§4 steps 3 and 4) if the orchestrator wants them in separate commits.
- **Q2 (non-blocking, follow-up ticket).** `api.getPosition()` has the same shape: it prefers the adapter, and web
  (`el.currentTime`) and Vega answer the previous source's position until the passive load effect assigns the new
  `src`; KitPlayer's `positionRef` is also reset after the `onCue([])` emission. Fire OS resets its own in its layout
  effect. Suggest a small ticket (same gate/reorder pattern); not folded in to keep this one about tracks.
- **Q3 (non-blocking, follow-up).** Rate across a switch differs: the HTML media element load algorithm resets
  `playbackRate` to `defaultPlaybackRate` on a new `src`
  (https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm), so web returns to 1×, while Fire OS
  keeps its `rate` state on the new `<Video>`. Volume is documented "kept across source changes"; rate is undocumented.
  Needs a decision (keep or reset) and a harness check; not this ticket.
- **Q4 (non-blocking).** A `selectText` made before the live source's `onTracks` now selects nothing on web (as on Fire
  OS since KIT-023) yet leaves the ids in the kit's selected set; nothing replays it after `onTracks`. Recommended:
  correct as is — such ids came from a list the app should not have had (0004: ids are per source). Documented via the
  `getTracks` JSDoc (§3.4); no replay.
- **Q5 (non-blocking).** A → B → A within one Vega load can open the gate with the first A load's report (§3.3 known
  limit). Same uri; resolved properly by KIT-010's per-load cancel (§6.2).

---

## 11. Risks

- **The kit gate masks adapter regressions in KitPlayer-level tests.** Mitigated: adapter guards observe adapter
  behaviour directly (W5, V1–V3) or through `selectText`'s fetches (W2, W3, Fire OS T6). §7 masking note.
- **Reorder in the reset effect.** Moving `tracksRef` before `scheduler.update` changes no emitted event; `setTracks`
  stays put. K4 pins the reason. Fire OS suite must stay green unchanged.
- **The Vega seam changes how the peers are loaded.** Same `require` strings, moved one module down — the `rnv.ts`
  precedent for Fire OS, which Metro resolved on the device. Not device-verifiable (Vega experimental); the 0.1.0
  changeset already says the Vega adapter does not play video as written. `tsup` must still treat both as externals
  (they are bare `require`s of peer deps, unchanged).
- **jsdom Vega rig drifts from real Shaka.** Accepted: the tests pin the adapter's ref discipline, not Shaka behaviour;
  KIT-010 re-derives them on the VVD.
- **An app that read `getTracks()` before `onTracks` to pre-build a sheet** now sees empty where it saw the previous
  list — the intended change; the changeset says so.
