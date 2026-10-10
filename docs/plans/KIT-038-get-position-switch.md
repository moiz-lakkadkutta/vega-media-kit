# KIT-038 — `getPosition()` never answers a superseded source (kit-side gate)

**Role chain:** Planner (opus; this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3, §4. **Decisions:** 0005 (§2.5, §3 amendments, Consequences (a) resolved by
KIT-020), 0008, 0001 (Vega experimental). **Plans:** KIT-020 (`docs/plans/KIT-020-adapter-tracks-reset.md` — the pattern
mirrored here; its §10 Q2 is this ticket), KIT-025 (§1 line 68: "`handlePosition` origin gate — not added"; partly
reversed here, see §3.2 and Q1), KIT-022 (§1: the switch commit flushes the adapters' passive effects in-commit).
**Base:** `efefa95`. **Status:** ready for an implementer. Nothing in §10 blocks.
**Parallel ticket:** KIT-039 (playback rate across a switch) — boundaries in §1.

Ticket text (`TASKS.md` KIT-038): "`api.getPosition()` prefers the adapter during a switch, like `getTracks` before
KIT-020 — may report A's position until B loads."

---

## 0. Verdict at a glance

1. **Real on web and Vega; not real on Fire OS.** Evidence per adapter in §2. KitPlayer's `api.getPosition`
   (`KitPlayer.tsx:252`) is `adapterRef.current?.getPosition() ?? positionRef.current` — it always prefers the adapter, so
   the kit's own reset of `positionRef` (`:233`) never reaches the API.
   - **Web:** the `<video>` element is reused. Its `currentTime` is A's from KitPlayer's reset (layout phase) until the
     adapter's passive load effect assigns `v.src` (`web.tsx:132`). Assigning `src` resets `currentTime` to 0
     *synchronously* (probed in Chromium, §2.1). The window is narrow — the switch commit's layout phase — but it is
     exactly where the kit emits `onCue([])` and where an app's own layout effects run.
   - **Vega:** the w3cmedia element is reused and nothing resets it; `getPosition()` reads `media.current.currentTime`
     (`vega.tsx:91`) — A's until the old Shaka player's asynchronous `destroy()` detaches and B's `attach().then → load`
     sets the start position. A long window (network-bound). Code reading only; Vega is not device-verified (0001).
   - **Fire OS:** fixed already by KIT-020 (`95564b2`): the adapter's layout effect resets `position.current` to
     `startAt ?? 0` (`fireos.tsx:50-55`), and child layout effects run before KitPlayer's, so at the kit's reset the
     adapter already answers the new source's start. Pinned by `test/fireos-adapter.test.tsx:229`.
2. **Second defect, same reset:** `positionRef.current = start` runs *after* `scheduler.update(start)` (`:230` vs
   `:233`), which emits `onCue([])` synchronously — so even a kit-only answer read inside that callback would be A's
   last tick. Same reorder as KIT-020 §3.3 did for `tracksRef`.
3. **Third, adjacent:** `selectText`'s prune re-evaluation reads `adapterRef.current?.getPosition() ?? 0`
   (`KitPlayer.tsx:106`) — the same unguarded read. A deselect during the window re-evaluates B's cues at A's position.
4. **Fix: kit-side gate, mirroring KIT-020.** No adapter changes. `api.getPosition()` answers the kit's own position
   (`startAt ?? 0` since the reset, or the last `api.seek` target) until the live source's first **accepted**
   `onPosition`, then prefers the adapter again (it is fresher than the last ≤ 4 Hz tick). "Accepted" requires an origin
   gate on `handlePosition` (re-created per `source.uri`, like `handleTracks`/`handleState`) — needed because Vega's
   element listeners leak across loads (KIT-024, `vega.tsx:48`) and would otherwise report through A's handler and open
   B's gate; and a stale tick would drive B's scheduler with A's position.
   - Why no adapter change: web's element already resets on `src` (the platform does it, in the passive effect);
     Fire OS already resets in a layout effect; Vega's reset belongs to the KIT-010 rewrite (§6) and the kit gate covers
     it meanwhile. A web layout-effect reset is impossible — `currentTime` cannot be zeroed without starting a load.
5. Changeset **patch**. No type change, no export change.

---

## 1. Scope boundaries

In: KitPlayer `getPosition` gate, `handlePosition` origin gate, reset reorder, mount initial position = `startAt ?? 0`,
`api.seek` updates the kit's position ref, `selectText` prune reads the gated position; JSDoc on
`KitPlayerRef.getPosition` and `AdapterProps`; vitest K-P1…K-P7 + one flipped KIT-025 assertion; harness hook + specs
46–47; changeset.

Out (do not touch):
- **KIT-039** (rate across a switch): no line of `setRate` (`KitPlayer.tsx:245`, `web.tsx:148`, `fireos.tsx:61`,
  `vega.tsx:67`), Fire OS `rate` state (`fireos.tsx:38`), or the `KitPlayerRef.setRate` JSDoc. **Conflict surface:**
  both tickets may edit KitPlayer's reset layout effect (`:218-235`), `src/player/types.ts`, and `harness/player.tsx`.
  Land them sequentially (rebase the second); the hunks do not overlap semantically.
- **Spec numbers are provisional:** the unlanded KIT-035 plan also claims harness specs 46–49. Whichever lands second
  renumbers (here: next free numbers); the spec titles in §5.3 are the identity. KIT-035 (reload on the same uri)
  also edits the reset effect — if it lands first, its reset must include §3.3's two lines (a reload is a new load).
- **KIT-024 / KIT-010** (Vega listener leak, per-load cancel): `vega.tsx` unchanged; §6 lists what KIT-010 must keep.
- Fire OS `startAt` playback (Q3 — a separate defect found while verifying). `fireos.tsx` unchanged.
- `renderControls`' `position` on `api.seek` (Q2). The `position` state is not set by `seek`.
- Web/Vega/Fire OS adapters: no change. Their tests must stay green unchanged.

---

## 2. Per-adapter evidence (base `efefa95`)

### 2.1 Web — real (narrow window); platform resets on `src`

Code: `getPosition: () => el.current?.currentTime ?? 0` (`web.tsx:173`); `v.src = props.source.uri` in the passive
load effect (`:132`), then `v.currentTime = startAt` if set (`:133`). The adapter has a `useLayoutEffect` reset for
`tracks` only (`:74-76`).

Probe (Chromium via `@playwright/test`, standalone script; `<video muted>`, A = `black-15s.webm`, B's request never
answered):

```
before switch: currentTime 1.502 (playing, playbackRate set to 2)
v.src = '/hold/b'  → synchronously: currentTime 0, readyState 0, paused true, playbackRate 1
v.currentTime = 12 → synchronously: currentTime 12 (readyState still 0)
+400 ms            → currentTime 12; exactly one timeupdate, whose listener read currentTime 12
```

Matches the spec: setting `src` runs the media element load algorithm synchronously, which sets the official playback
position to 0 and queues one `timeupdate` if it changed
(https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm); a `currentTime` set while
`HAVE_NOTHING` becomes the *default playback start position*, which the getter returns
(https://html.spec.whatwg.org/multipage/media.html#dom-media-currenttime).

Consequences:
- From KitPlayer's reset until the adapter's passive effect runs, `getPosition()` = A's position. KIT-022 §1 showed the
  reset's SyncLane `setTracks` makes React flush the passive effects inside the same commit, so the observable window is
  the switch commit's layout phase: the `onCue([])` the reset emits (`KitPlayer.tsx:230`) and every ancestor
  `useLayoutEffect` / ref callback of that commit. The harness can observe it (App's layout effect runs there, §5.3).
- After `v.src`, the adapter's answer is right (0, or `startAt`).
- The queued `timeupdate` reaches B's listener (A's were removed in the cleanup, `:137-140`) and reports B's position —
  so on web the gate opens on the first switch tick with a correct value, typically within one task.

### 2.2 Vega — real (long window); code reading only

- `getPosition: () => media.current?.currentTime ?? 0` (`vega.tsx:91`); the element is one `<w3c.VideoPlayer>` for the
  component's life. Layout reset covers `tracks` only (`:25-27`).
- On a switch: the cleanup calls `void p.destroy()` (`:52`, async), the new effect creates a player and
  `attach(el).then(async () => { …; await p.load(uri, startAt) })` (`:34-47`). Nothing sets `currentTime` until Shaka's
  load; Shaka's detach on destroy (`removeAttribute('src')`/`load()` on the element) happens after its own awaits. So
  `currentTime` is A's for attach + manifest fetch + first segment.
- Element listeners are added per effect run and never removed (`:48-51`, KIT-024): A's `timeupdate` listener keeps
  calling **A's** `props.onPosition` after the switch, with the element's time. Today `handlePosition` has no gate
  (`[scheduler]` deps, `KitPlayer.tsx:158-166`), so those ticks reach the app's `onPosition`, `renderControls` and
  **B's scheduler**. B's own listener, too, reports A's element time until Shaka detaches A — that one the kit cannot
  attribute (§6, Q4).

### 2.3 Fire OS — not real for `getPosition`

- `getPosition: () => position.current` (`fireos.tsx:84`); `position.current` is written only by `onProgress` (`:148`)
  and reset to `props.startAt ?? 0` in the KIT-020 layout effect on a uri change (`:50-55`). Child layout effects run
  before KitPlayer's, so the adapter answers B's start even inside the kit's reset.
- `<Video key={props.source.uri}>` (`:135`): A's ExoPlayer view is unmounted on the switch and React Native drops events
  from an unmounted view — no stale `onProgress`. The inline `onProgress` arrow is re-created per render, so B's events
  use B's `handlePosition` (with §3.2's gate, still accepted).
- Pinned: `test/fireos-adapter.test.tsx:229` `'resets tracks, text urls, position and the audio index when source.uri
  changes (KIT-020)'` (`onProgress(42)` → switch → `getPosition()` = 0).
- Found while verifying, **out of scope** (Q3): `startAt` never reaches ExoPlayer — `fireos.tsx` passes no start
  position to `<Video>` and does not seek on load — so Fire OS answers `startAt` while playing from 0 until the first
  `onProgress`.

---

## 3. Files and behaviour rules

### Files to touch

| File | Change |
|---|---|
| `src/player/KitPlayer.tsx` | `positionReported` gate; `readPosition`; `handlePosition` origin gate; reset reorder; mount init; `api.seek`; `selectText` prune (§3.1–§3.4) |
| `src/player/types.ts` | JSDoc only: `KitPlayerRef.getPosition`, one sentence in the `AdapterProps` contract (§3.5) |
| `test/kit-player.test.tsx` | double's `getPosition` returns a mutable `adapterPosition`; new `describe` K-P1…K-P7 (§5.1); flip the KIT-025 identity assertion (§5.2) |
| `harness/player.tsx` | `window.__kit.switchProbe` (§5.3) |
| `harness/e2e/player.spec.ts` | specs 46–47; header comment line for them |
| `.changeset/kit-038-get-position-switch.md` (new) | patch (§8) |

No adapter file changes. No `src/core` change.

### 3.1 The gate

Next to `tracksPublished` (`KitPlayer.tsx:70`):

```tsx
/**
 * Whether the live source's position has been reported: its first `onPosition` passed the origin gate. Until then
 * `getPosition()` answers the kit's own position — `startAt ?? 0` since the reset (or mount), or the last `seek` target —
 * never the adapter's, which may still read a superseded source's element (web until the load effect assigns `src`;
 * Vega until Shaka detaches it) (KIT-038; the KIT-020 `getTracks` pattern). Afterwards the adapter is preferred again: it
 * is fresher than the last ≤ 4 Hz tick.
 */
const positionReported = useRef(false)
/** The position `getPosition()` answers; also what `selectText` re-evaluates cues at after a prune. Reads refs only. */
const readPosition = useCallback(
  () => (positionReported.current ? adapterRef.current?.getPosition() ?? positionRef.current : positionRef.current),
  [],
)
```

- `api.getPosition` (`:252`) → `getPosition: readPosition,`. Add `readPosition` to `api`'s deps; it is stable (`[]`),
  so `api` is still created once (KIT-012, harness spec 20).
- `selectText` (`:106`) → `if (prune.length) scheduler.update(readPosition())`; add `readPosition` to its deps
  (`[scheduler, readPosition]`, both stable). `readPosition` must be declared above `selectText`.

### 3.2 `handlePosition` — origin gate + opening the gate

```tsx
const handlePosition = useCallback(
  (s: number) => {
    if (sourceUri !== liveUri.current) return // a tick for a source that is no longer live (Vega's leaked listeners)
    positionRef.current = s
    positionReported.current = true // before the app's onPosition, which may read getPosition()
    setPosition(s)
    onPositionRef.current?.(s)
    scheduler.update(s)
  },
  [scheduler, sourceUri],
)
```

Comment above it: re-created per `source.uri` like `handleTracks`; adapters report position through the handler of the
load (web, Vega listeners) or the latest render (Fire OS inline `onProgress`, whose view is per uri); a tick through a
superseded handler is dropped whole — no app `onPosition`, no `renderControls` position, no scheduler update, gate not
opened. Delivery stays through `onPositionRef` (KIT-025: an inline `onPosition` is never stale and never re-creates
this handler — identity still changes only on `sourceUri`).

This reverses KIT-025's "`handlePosition` origin gate — not added" (its premise "Web/Vega remove their listeners per
load" does not hold for Vega, KIT-024). Q1.

### 3.3 Reset layout effect (`:218-235`) — reorder

Directly after `tracksRef.current = { audio: [], text: [] }` (`:228`), **before** the scheduler prune and
`scheduler.update(start)` (`:229-230`):

```tsx
positionReported.current = false
positionRef.current = start
```

and delete the old `positionRef.current = start` at `:233`. `setPosition(start)` stays where it is (`renderControls`
does not render inside the effect; and KIT-022's note on `setTracks`/`setPosition` scheduling is untouched). Extend the
existing KIT-020 comment at `:225-226` to say "`getTracks()`/`getPosition()`".

### 3.4 Mount and `seek`

- Mount: `useState(props.startAt ?? 0)` (`:23`) and `useRef(props.startAt ?? 0)` for `positionRef` (`:61`) — the same
  value the reset uses (0005 §2.5) and what every adapter answers once its load began (web `currentTime` = default
  playback start position, Fire OS `position` init `fireos.tsx:42`, Vega `load(uri, startAt)`). Without it the gate
  would regress `getPosition()` on a mount with `startAt` from `startAt` to 0 until the first tick.
- `api.seek` (`:241-244`): `positionRef.current = s` before `scheduler.update(s)`. While the gate is closed this is what
  `getPosition()` answers (the adapter has been told to seek; web's element already reads `s`); while it is open the
  adapter is preferred and the ref is overwritten by the next tick. `setPosition` is **not** called (Q2).

### Rules

- **R-P1.** From a `source.uri` change (inclusive of everything emitted during the kit's reset — the `onCue([])`) until
  the live source's first accepted `onPosition`, `api.getPosition()` = `startAt ?? 0` of the new render, or the target of
  the latest `api.seek` made in that window. Never the adapter's answer.
- **R-P2.** A tick refused by the origin gate (through a handler created for a superseded source) does not open the gate
  and has no effect at all: not forwarded, not in `renderControls`, no `scheduler.update`.
- **R-P3.** After the live source's first accepted `onPosition`, `api.getPosition()` returns the adapter's answer
  (unchanged behaviour) — including inside that first `onPosition` callback.
- **R-P4.** On first mount the same rule applies; `getPosition()` and `renderControls`' `position` start at
  `startAt ?? 0`.
- **R-P5.** `selectText`'s prune re-evaluates at `readPosition()` — the same answer as `getPosition()`.
- **R-P6.** The kit emits nothing new: no `onPosition`, no state. Answering a query from the kit's own reset state is
  0005 §2.5's existing fallback, not synthesis (0005 §3).
- Known limit, unchanged (0005 §3 KIT-016 amendment): A → B → A revives A's first-load handler; Vega's leaked A
  listener could then open the gate. Same uri; resolved by KIT-010's listener cleanup.

### 3.5 JSDoc (`src/player/types.ts`)

- `KitPlayerRef.getPosition()` (`:25`, currently undocumented): "Seconds into the live source. From a `source` change
  (and on mount) until that source's first `onPosition`: `startAt` (or 0), or the target of a `seek` made since — never a
  previous source's position (KIT-038). Afterwards the platform's current position, which can be fresher than the last
  `onPosition`."
- `AdapterProps` contract (`:93-95`), append: "Likewise `getPosition()`; and report `onPosition` through the handler of
  the load it belongs to (or the latest render's, if the platform drops a previous source's events) — the kit drops ticks
  through a handler created for a source that is no longer live (KIT-038)."

---

## 4. Order of work (TDD)

1. Double change (§5.1) + K-P1…K-P7; flip the KIT-025 assertion (§5.2). Run: the "red on base" column of §7 must match.
2. Reorder + gate + `readPosition` → K-P1, K-P2, K-P4, K-P5 green. `handlePosition` origin gate → K-P3 and the flipped
   assertion green. `seek` → K-P6. `selectText` → K-P7.
3. JSDoc. Harness hook + specs 46–47 (`pnpm harness`). Changeset. `pnpm typecheck && pnpm test && pnpm lint`.
4. Full `pnpm harness` — in particular specs 20 (ref stability), 41 (inline `onPosition` reaches the latest arrow),
   the KIT-019 "one position tick per timeupdate" spec, 25 (KIT-022 handover) must stay green.

---

## 5. Acceptance tests

### 5.1 Vitest — real `KitPlayer` + platform double (`test/kit-player.test.tsx`)

Double change: module-level `let adapterPosition = 0`, reset in `beforeEach`; the double's `getPosition: () =>
adapterPosition` (`:74`). Never reset on a switch: an adapter that still reads the previous source's element (web
before its passive effect, Vega). Existing tests do not read `getPosition()` — verify by running them.

Helper: `const tick = (s: number) => act(() => latest.props!.onPosition?.(s))` (the live render's handler) and a way to
render with `startAt` (extend `render` with an optional `startAt`, or a local render in the `describe`).

`describe('KitPlayer getPosition gate: the adapter is not asked until the live source has reported a position (KIT-038)')`

- **K-P1** `it("answers startAt, or 0, from a source change until the new source's first onPosition, though the adapter still reads the previous source's position")`
  — render A; `adapterPosition = 40; tick(40)`; `getPosition()` = 40. Render B (no `startAt`): `getPosition()` = 0
  (`adapterPosition` still 40). Render C with `startAt: 12`: 12. Red on base (40).
- **K-P2** `it("prefers the adapter once the live source's onPosition is accepted, already inside that onPosition")`
  — render A, switch to B; app `onPosition` records `api.getPosition()`; `adapterPosition = 5.2; tick(5)`; recorded
  `[5.2]`; afterwards `getPosition()` = 5.2; `adapterPosition = 6`: 6.
- **K-P3** `it("a tick through a superseded source's handler is dropped: no app onPosition, no renderControls position, no cue update, and the gate stays closed")`
  — render A with `PREF` (cue `A/0` 0–10 s via `beginLoad().complete(TRACKS_A)`); `const tickA = latest.props!.onPosition`;
  render B, `beginLoad().complete(TRACKS_B)` (PREF selects B's `'1'`, cue `B/1` 0–10 s; no seek, so nothing on screen);
  `onPosition.mockClear()`, `onCue.mockClear()`; `adapterPosition = 3; act(() => tickA!(3))`. Expect: app `onPosition`
  not called; `ctx.position` = 0 (capture `position` in the `renderControls` double); `onCue` not called (on base B's
  cue would be shown at 3); `getPosition()` = 0. Red on base.
- **K-P4** `it('getPosition() read from the onCue([]) the switch emits answers the new source\'s start')`
  — render A (PREF), complete, `tick(7)` (cue on screen, `positionRef` = 7), `adapterPosition = 7`; `onCue` records
  `api.getPosition()` when called with `[]`; render B with `startAt: 3`; recorded `[3]` — exactly one. Red on base (7).
  Mutation M5 (old order) gives 7 through the fallback.
- **K-P5** `it("on first mount getPosition() and renderControls' position are startAt until the first onPosition, then the adapter's answer")`
  — `adapterPosition = 99` (an adapter not at the start yet); mount with `startAt: 12`; `getPosition()` = 12,
  `ctx.position` = 12; `tick(12.25)` with `adapterPosition = 12.3` → 12.3. Red on base (99, and `ctx.position` 0).
- **K-P6** `it("a seek before the live source's first onPosition moves getPosition() to the seek target")`
  — render A, `tick(40)`, `adapterPosition = 40`; render B; `seek(25)`; `getPosition()` = 25. (On base 40.)
- **K-P7** `it("a deselect before the new source's first onPosition re-evaluates cues at the kit's position, not the previous source's")`
  — `preferredText` `{ languages: ['en', 'de'] }` (module-level constant) so B selects `'0'` and `'1'`; render A,
  complete, `tick(40)`, `adapterPosition = 40`; render B, `beginLoad().complete(TRACKS_B)`; `seek(2)` → `lastCueTexts()`
  = `['B/0', 'B/1']` (order as the scheduler emits); `selectText(['0'])` → `lastCueTexts()` = `['B/0']`. On base the
  prune's `scheduler.update(40)` empties the set (the double re-delivers `'0'`'s VTT synchronously, but `setTrack` does
  not notify, so `[]` is the last emission). Implementer: confirm red on base exactly as stated; if the double's
  synchronous re-delivery changes the emission order, assert on the emission made by the prune instead.

`renderControls` double: also capture `position` into `ctx` (add `position: number | null` to `ctx`, reset in
`beforeEach`).

### 5.2 Flipped assertion (`test/kit-player.test.tsx:591-595`)

In `'the state, tracks and position handlers keep their identity across a same-source re-render with new inline
callbacks'`: the comment becomes "…and change on a source switch (the per-uri gates)." and
`expect(latest.props!.onPosition).toBe(before.p)` → `.not.toBe(before.p)`. The same-source half (`after.p` is
`before.p`) is unchanged — KIT-025's guarantee stands.

### 5.3 Harness — real `KitPlayer` + `WebAdapter` in Chromium (`harness/e2e/player.spec.ts`)

Hook (`harness/player.tsx`): `switchProbe: { layout: number | null; cueClear: number | null; videoSrc: string | null }`
on `window.__kit`, initially all `null`. In `App`, a second `useLayoutEffect(() => { if (uri === src) return;
kit.switchProbe.layout = kit.ref?.getPosition() ?? null; kit.switchProbe.videoSrc = videoSrc() }, [uri])` — it runs in
the switch's commit after KitPlayer's reset and before the adapter's passive effect (the existing comment at the
`deferredTarget` effect says so). In `onCue`, when `active.length === 0`: `kit.switchProbe.cueClear =
kit.ref?.getPosition() ?? null`. Header comment line: "Specs 46–47 (KIT-038): `getPosition()` never answers a superseded
source; the element itself resets on `src`."

- **46** `test("getPosition() inside the switch's commit answers B's start, not A's position, while <video> still holds A's src (KIT-038)")`
  — `routeStream(page)`; `/player.html?preferred=` `{"languages":["de"]}`; wait for tracks + metadata;
  `seek(2)` and expect a non-empty `active` (a cue on screen, so the reset emits `onCue([])`); reset `switchProbe` to
  nulls; `setSource('/stream/master-b')` (flushSync). Expect `switchProbe.videoSrc` = `'/stream/master'` (proves the
  read was inside the window), `switchProbe.layout` = 0, `switchProbe.cueClear` = 0. Then, in one `evaluate`,
  `document.querySelector('video')!.currentTime` = 0 (pins the platform assumption of §2.1 the gate lets go of) and
  `__kit.ref!.getPosition()` = 0. Red on base: `layout`/`cueClear` = 2.
- **47** `test("after a switch, getPosition() follows B's playback once B reports a position (KIT-038)")`
  — load A, `seek(5)`; `setSource('/stream/master-b')`; wait for B's tracks; `__kit.play()`; poll
  `__kit.ref!.getPosition()` > 0.3 within 5 s; then `positionTicks` ≥ 1. Guards M9 / a gate that never re-opens
  (green on base).

---

## 6. What KIT-010 (the Vega rewrite) must keep

1. Report `onPosition` only for the live load: add the element's `timeupdate` (and every other) listener per load and
   remove it in the cleanup (KIT-024), **and** do not report a position before this load's `p.load()` has resolved (or
   the element has emitted `emptied` for it) — otherwise B's own listener reports A's element time, which the kit
   cannot attribute (Q4) and which would open B's gate with A's value.
2. `getPosition()` must not answer A's element after a switch: either the per-load pattern above plus answering
   `startAt ?? 0` until this load's first `timeupdate`, or a Fire-OS-style layout-effect reset of an adapter-held value.
3. Keep the KIT-020 §6 list.

---

## 7. Mutation table (for the reviewer)

| # | Mutation | Caught by | Red on base? |
|---|---|---|---|
| M1 | `api.getPosition` back to always preferring the adapter | K-P1, K-P4, K-P5, K-P6; harness 46 | K-P1, K-P4, K-P5, 46 red on base |
| M2 | `positionReported` never reset on a switch | K-P1, K-P4 | — |
| M3 | `positionReported = true` before the origin-gate `return` | K-P3 (`getPosition()` would be the adapter's 3) | — |
| M4 | `handlePosition` without the origin gate (`[scheduler]` deps) | K-P3, §5.2 flipped assertion | K-P3 red on base |
| M5 | `positionRef` reset left after `scheduler.update(start)` (today's order) | K-P4 | K-P4 red on base |
| M6 | Mount init left at 0 | K-P5 | K-P5 red on base |
| M7 | `api.seek` does not write `positionRef` | K-P6 | K-P6 red on base |
| M8 | `selectText` prune reads the adapter (`adapterRef.current?.getPosition()`) | K-P7 | K-P7 red on base |
| M9 | Gate opened only once per component life ("any onPosition ever") | K-P1 (B and C legs) | — |
| M10 | `positionReported = true` after `onPositionRef.current?.(s)` | K-P2 (records 5, not 5.2) | — |
| M11 | `readPosition` not stable (deps include `sourceUri`) → `api` re-created per switch | harness spec 20 / KIT-012 ref-identity vitest | — |

Masking note: on Fire OS the adapter reset (`fireos.tsx:53`) and on web the platform reset make the gate unobservable
after the passive effect; the gate's guards are the double-based K-P tests and harness 46 (inside the commit), not
adapter-level tests. No adapter guard is added because no adapter changes.

---

## 8. Changeset — `patch`

`.changeset/kit-038-get-position-switch.md`:

```md
---
'@moizp/vega-media-kit': patch
---

**`getPosition()` never answers a previous source.** After `source.uri` changes, `ref.getPosition()` now answers the new
source's `startAt` (or 0) — or the target of a `seek` made since — until the new source reports its first position
through `onPosition`, then the platform's position as before. Previously, on web (inside the switch's render, e.g. in
the `onCue([])` the switch emits) and on Vega (until the new source had loaded) it answered the previous source's
position. On mount, `getPosition()` and `renderControls`' `position` now start at `startAt` rather than 0. Position
reports from a source the app has switched away from are no longer delivered to `onPosition`. No type changes.
```

---

## 9. Decision record (orchestrator)

Amend **0005**: §2 step 5 note — `positionRef` and the reported flag are reset before step 3's `scheduler.update`, and
the mount value is `startAt ?? 0` too. Add a *KIT-038* amendment under §3: "`onPosition` is origin-gated like
`onTracks`/state/`onError` (`handlePosition` re-created per `source.uri`); `api.getPosition()` answers the kit's
position (`startAt ?? 0`, or the last `seek` target) until the live source's first accepted `onPosition`, then prefers
the adapter." Note in KIT-025's plan reference that its "no `handlePosition` gate" is superseded. TASKS: KIT-038 → done;
KIT-024 row → append "KIT-010: also `docs/plans/KIT-038…` §6 (position per load)"; open Q3 as a new ticket if accepted.

---

## 10. Open questions (none blocking)

- **Q1 (non-blocking, decided here).** Add the `handlePosition` origin gate, reversing KIT-025? Yes: without it "first
  *accepted* `onPosition`" is not definable, Vega's leaked A listener would open B's gate with A's time (and drive B's
  scheduler), and every other per-source report is already gated. Cost: one flipped assertion (§5.2); `handlePosition`'s
  identity changes on a switch, which no adapter depends on (web/Vega capture per load, Fire OS per render). Veto →
  drop §3.2's `return` line, K-P3, M3, M4, §5.2; the rest stands.
- **Q2 (non-blocking).** `api.seek` before the first tick moves `getPosition()` but not `renderControls`' `position`
  (unchanged today; the next tick moves it). Recommend leaving it — making `seek` call `setPosition` is a re-render per
  seek and a separate behaviour change.
- **Q3 (non-blocking, new ticket suggested).** Fire OS never applies `startAt`: no start position is passed to `<Video>`
  and there is no seek on load (`fireos.tsx:132-154`), so ExoPlayer plays from 0 while `getPosition()` (adapter and kit)
  and `renderControls` say `startAt` until the first `onProgress`. Confirm on the Fire TV stick; fix with
  react-native-video's start-position source option or a seek in `onLoad` (cite the rnv v6 docs then).
- **Q4 (non-blocking, KIT-010).** Vega: B's own `timeupdate` listener can report A's element time before Shaka detaches
  A; the kit cannot attribute it (same handler). §6.1.
- **Q5 (non-blocking).** A → B → A within one Vega load: §3 known limit, as KIT-020 Q5.

---

## 11. Risks

- **Stale kit answer while the gate is closed.** If an adapter moves without reporting (a platform seek ignored by the
  kit), `getPosition()` answers `startAt`/the seek target until the first tick. Web reports on every position change
  (the load algorithm's queued `timeupdate` opens the gate within a task); Fire OS reports while playing; while paused
  with no tick, the adapter's own answer is the same start value. Acceptable and strictly closer to the truth than A's.
- **Identity change of `handlePosition` per switch.** Harness spec 41 and the KIT-019 tick-count spec must stay green;
  `api` identity is unaffected (`readPosition` is stable).
- **Mount `startAt` now visible in `renderControls`.** An app that rendered 0 before the first tick now renders
  `startAt`; intended (consistent with the switch rule); in the changeset.
- **KIT-039 merge.** Both may edit the reset effect and `types.ts`; land sequentially.
