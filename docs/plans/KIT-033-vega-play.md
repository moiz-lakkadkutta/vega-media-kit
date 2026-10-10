# KIT-033 — Vega adapter: guarded `play()`, `playing` on `'playing'` (KIT-025 parity)

**Role chain:** Planner (opus; this document) → Implementer (opus) → Reviewer (fable or opus*).
**Protocol:** `docs/ORCHESTRATOR.md` §3, §4. **Decisions:** 0001 (Vega experimental), 0002 (the adapter is a rewrite,
not a rename), 0005 §3 (+KIT-016 amendment), 0008 (+KIT-025 amendment). **Plans:** KIT-025 (the web fix mirrored here),
KIT-020 §6 (what KIT-010 must keep). **Base:** `efefa95`.
**Status:** ready for an implementer. Nothing in §10 blocks.

Ticket text (`TASKS.md` KIT-033): "Vega adapter has KIT-025's web defects: unguarded `play()` and `playing` reported on
`'play'` (`vega.tsx:41,44`)." Line refs drifted: on `efefa95` they are `vega.tsx:46` (`void el.play()` in the autoplay
continuation), `vega.tsx:64` (`play: () => void media.current?.play()`, the same defect, not in the ticket) and
`vega.tsx:49` (`el.addEventListener('play', () => props.onState?.('playing'))`).

Not in scope, owned by KIT-034 (parallel plan): Vega's `SHAKA_*` error reporting `onState('error')`. Do not touch the
Shaka `error` listener (`vega.tsx:39-41`).

---

## 0. Verdict at a glance

1. **Fix now, minimally; do not wait for KIT-010.** KIT-010 is *deferred*, not scheduled (0001: "pick them up only if
   the VVD column is ever run"), so "fold into KIT-010 if that lands first" means "never" in practice. The fix is ~20
   lines, reuses KIT-025's code verbatim, and is unit-testable through the existing `adapters/w3c` mock seam. Its real
   value is that **the behaviour gets pinned by tests KIT-010 must keep green** (added to the KIT-020 §6 list, §8 below),
   so the rewrite cannot reintroduce the web defects. Honest caveat (0002): the scaffold does not play video on a
   device as written — `<w3c.VideoPlayer ref>` renders a class, not a component — so this changes no on-device behaviour
   today. It is contract parity, not a user-visible fix.
2. **Share the helpers.** Move `playRejection` and `startPlay` out of `web.tsx` into a new
   `src/player/adapters/play.ts` (no React, no React Native — only `PlayerError` from `core`). Both adapters import it.
   `startPlay` takes `Pick<HTMLMediaElement, 'play'>` instead of `HTMLVideoElement` (the w3cmedia `VideoPlayer` is
   documented as implementing `HTMLVideoElement`, but the kit should not depend on more than `play`).
   `mediaElementError` stays in `web.tsx` (Vega errors are Shaka's, and KIT-034 owns them).
3. **State reporting:** element `playing` → `'playing'` (replaces `play`). Shaka `buffering` is guarded by `el.paused`
   the way web's `waiting` is: `buffering: true` → `'buffering'` only while `!el.paused`; `buffering: false` →
   `'playing'` only while `!el.paused`, otherwise nothing. (Today a seek while paused reports `'playing'` on Shaka's
   `buffering: false` — the same lie as `play` → `playing`, from a different event.)
4. **Per-load cancel, scoped.** One `cancelled` flag per load effect, used for exactly two things: the autoplay
   rejection report and whether the autoplay continuation calls `play()` at all. The element listeners move into a
   table removed by reference in the cleanup (the element half of KIT-024, which sits on exactly the lines this ticket
   edits). The `attach().then` / `publishTracks` / `load()`-rejection half of KIT-024 is **not** touched — KIT-020 §6.2
   says it must be fixed as one change with `publishTracks` reading `p`, and that belongs to KIT-010.
5. **Changeset: `patch`**, worded as experimental.
6. **VVD needed for** (none of it blocks this ticket — §9): that the w3cmedia `VideoPlayer` fires `playing`; that its
   `play()` returns a promise and rejects with DOMException-named reasons; Shaka 4.8.5-patched `buffering` semantics on
   Vega (fires while paused? does the element fire `playing` on stall recovery?).

---

## 1. Scope boundaries

In scope: `src/player/adapters/vega.tsx`, `src/player/adapters/web.tsx` (import only), new `src/player/adapters/play.ts`,
`test/vega-adapter-tracks.test.tsx` (new `describe`s + rig extensions), `test/web-adapter-lows.test.tsx` (one import
line), `docs/plans/KIT-020-adapter-tracks-reset.md` §6 (append items 6–8 — see §8; the orchestrator may prefer to do
this itself), `src/player/types.ts` (JSDoc only), `.changeset/kit-033-vega-play.md`.

Out of scope (do not touch):

- **KIT-034** — Fire OS / Vega `onState('error')`. Vega's Shaka `error` listener stays as is.
- **KIT-024 remainder / KIT-010** — `attach().then` has no cancel check before `configure`/`publishTracks`/`ready`;
  `publishTracks` reads `player.current`; `load()` rejection after `destroy()` is uncaught; Shaka listeners on `p` are
  not removed (harmless: `p` is destroyed). Do **not** make `publishTracks` read `p`, and do **not** add `cancelled`
  checks to the continuation beyond the one before `startPlay` (KIT-020 §6.2: reading `p` without the full per-load
  cancel writes A's tracks back after the reset and breaks V2/V3).
- **Any `TODO(spike)` name** — `requireW3cMedia`, `requireShaka`, `w3c.VideoPlayer`, `p.attach`, `selectText`'s TODO at
  `vega.tsx:84`. No renames, no surface change (0002 is KIT-010's).
- No `waiting` listener on Vega: Shaka's `buffering` event is the buffering authority on an MSE pipeline (Shaka
  `BufferingEvent`, https://shaka-player-demo.appspot.com/docs/api/shaka.Player.html#.event:BufferingEvent). Adding the
  element's `waiting` too would double-report with unknown ordering on an unverified element. Revisit in KIT-010.
- `setVolume`, `selectAudio`, `selectText`, `CaptureTextDisplayer` — unchanged.

---

## 2. Files to touch

| File | Change |
|---|---|
| `src/player/adapters/play.ts` (new) | `playRejection` and `startPlay`, moved verbatim from `web.tsx:24-55`; `startPlay` param type widened to `Pick<HTMLMediaElement, 'play'>`; header comment says "shared by web and Vega (KIT-033)". Not re-exported from any `index.ts`. |
| `src/player/adapters/web.tsx` | Delete the two functions; `import { startPlay } from './play'`. No behaviour change. No re-export of `playRejection` (one home). |
| `src/player/adapters/vega.tsx` | §3 rules R1–R5 |
| `src/player/types.ts` | JSDoc only: `PLAY_REJECTED` "(web; Vega, experimental: …)"; one clause in `onState` (§5) |
| `test/web-adapter-lows.test.tsx` | Line 16: import `playRejection` from `../src/player/adapters/play`; `mediaElementError`, `WebAdapter` stay from `web` |
| `test/vega-adapter-tracks.test.tsx` | Rig extensions + two new `describe`s (§6). Header comment gains one line: "KIT-033: play() and state reporting (plan `docs/plans/KIT-033-vega-play.md`)". File name kept (KIT-020 plan and TASKS reference it). |
| `docs/plans/KIT-020-adapter-tracks-reset.md` | §6: append items 6–8 (§8 below) |
| `.changeset/kit-033-vega-play.md` | New (§7) |

`src/core/**` untouched; `play.ts` imports only `type { PlayerError } from '../../core'`, no React Native.

---

## 3. Behaviour rules (`vega.tsx`)

Target shape of the load effect (illustrative; names other than these are the implementer's):

```ts
useEffect(() => {
  const el = media.current
  if (!el) return
  // Per load: `cancelled` gates the autoplay play() and its rejection report only (KIT-033). The rest of the
  // attach/load continuation is KIT-010's (KIT-024; docs/plans/KIT-020-adapter-tracks-reset.md §6.2).
  let cancelled = false
  const p = new shaka.Player()
  player.current = p
  p.attach(el as unknown as HTMLMediaElement).then(async () => {
    …configure, trackschanged, adaptation unchanged…
    p.addEventListener('buffering', (e: Event & { buffering?: boolean }) => {
      if (el.paused) return // R3
      props.onState?.(e.buffering ? 'buffering' : 'playing')
    })
    …error listener unchanged (KIT-034)…
    props.onState?.('loading')
    await p.load(props.source.uri, props.startAt)
    publishTracks()
    props.onState?.('ready')
    if (props.autoplay && !cancelled) startPlay(el, (e) => { if (!cancelled) props.onError?.(e) }) // R1, R4
  })
  const listeners: [string, () => void][] = [
    ['timeupdate', () => props.onPosition?.(el.currentTime)],
    ['playing', () => props.onState?.('playing')], // R2: not 'play'
    ['pause', () => props.onState?.('paused')],
    ['ended', () => props.onState?.('ended')],
  ]
  for (const [type, fn] of listeners) el.addEventListener(type, fn)
  return () => {
    cancelled = true
    for (const [type, fn] of listeners) el.removeEventListener(type, fn)
    void p.destroy()
  }
}, [props.source.uri])
```

- **R1 — Autoplay `play()` is guarded.** `void el.play()` → `startPlay(el, report)`, where `report` drops the error
  when `cancelled` and otherwise calls the **load's** `props.onError` (KIT-016 boundary / 0005 §3 amendment: per-load
  capture; the kit's per-uri gate in `handleError` is the second line). Classification is `playRejection`'s, unchanged:
  `AbortError` / `NotSupportedError` swallowed, `NotAllowedError` and anything else → one non-fatal `PLAY_REJECTED`. No
  state change on `PLAY_REJECTED` (the load stays at `ready`). Never an unhandled rejection, including when `onError`
  throws (`startPlay` already wraps `report`), and a non-promise return from `play()` is tolerated.
- **R1b — `ref.play()` is guarded.** `play: () => { const el = media.current; if (el) startPlay(el, (e) =>
  props.onError?.(e)) }` — this render's `onError`, as on web (`web.tsx:145`) and `selectText`.
- **R2 — `playing` on the element's `playing` event; no `play` listener.** `play` fires synchronously-queued on
  `play()`, before any data (https://html.spec.whatwg.org/multipage/media.html#dom-media-play); `playing` fires when
  playback actually proceeds. `pause` / `ended` / `timeupdate` unchanged.
- **R3 — Shaka `buffering` is reported only while not paused.** `e.buffering === true` → `'buffering'` iff
  `!el.paused`; `e.buffering === false` → `'playing'` iff `!el.paused`; while paused, nothing. Rationale: Shaka evaluates
  its buffering state on the playhead regardless of `paused`, so a seek while paused into unbuffered media produces
  `buffering: true` then `false` — today that reports `'playing'` on a paused player (and, without the guard on `true`,
  would leave `'buffering'` with nothing to leave it, the Chromium `waiting` case of KIT-025 R3.2). `buffering: false`
  while playing keeps reporting `'playing'`: it is the only stall-recovery signal we can rely on until the VVD shows the
  w3cmedia element fires `playing` after a stall (§9 V3). A duplicate `'playing'` (Shaka + element) is idempotent in
  `renderControls`; the app's `onState` may see it twice — acceptable, documented in the KIT-020 §6 item 7 for KIT-010.
- **R4 — A superseded load never starts playback.** The autoplay continuation checks `!cancelled` before `startPlay`.
  On a real Shaka `destroy()` the pending `load()` rejects (`LOAD_INTERRUPTED`) and never reaches this line, but under
  the mock (and any engine whose `load` survives `destroy`) A's continuation would otherwise call `play()` on the shared
  element **after B has mounted** — starting B even when B's `autoplay` is false. This is the only `cancelled` check
  added to the continuation (§1).
- **R5 — Element listeners are removed per load.** The four element listeners live in a table removed by reference in
  the cleanup, before `p.destroy()`. Today they accumulate per `source.uri` on the same element (KIT-024's element
  half); after a switch A's `pause`/`ended`/`playing` listeners report through A's `onState` (dropped by the kit's 0008
  §3 gate, but observable on a directly-rendered adapter and a leak).
- **R6 — Ordering unchanged.** `loading` → `onTracks` → `ready` → (autoplay) `play()` from one continuation, as 0008 §1
  requires; with R2 the `playing` that follows is the element's, after `ready`, so a Vega autoplay load reports
  `loading → ready → [buffering] → playing` (the kit no longer has a `play`-time `playing` that could close `ready` if the
  order ever changed in KIT-010).

---

## 4. `play.ts` interface

```ts
import type { PlayerError } from '../../core'

/** (JSDoc moved verbatim from web.tsx; add: "Shared by the web and Vega adapters (KIT-033).") */
export function playRejection(e: unknown): PlayerError | null

/** `el.play()`, with its rejection classified by `playRejection` and reported — never an unhandled rejection, even
 *  when `report` throws. Tolerates a non-promise return (legacy engines, jsdom, an unverified Vega element). */
export function startPlay(el: Pick<HTMLMediaElement, 'play'>, report: (e: PlayerError) => void): void
```

Bodies unchanged. The `NotAllowedError` message ("Playback was blocked by the browser (autoplay policy)") stays — it is
pinned by `web-adapter-lows`; on Vega it is not expected to occur (§10 Q2).

---

## 5. Docs

- `types.ts` `onError` JSDoc: `PLAY_REJECTED (web: … ; Vega, experimental: the same classification of the w3cmedia
  element's play() rejection)`.
- `types.ts` `onState` JSDoc: after "Web reports `buffering` while it waits for data during playback." add "Vega
  (experimental) reports `playing` when the element is playing and `buffering` only while playing."
- No `getting-started.md` change: the Vega section already says the adapter does not play video as written.

---

## 6. Acceptance tests (vitest)

All in `test/vega-adapter-tracks.test.tsx` (real `VegaAdapter`, rendered directly, peers via the `adapters/w3c` mock).

**Rig extensions** (keep the four KIT-020 tests unchanged in assertions):
- `render(uri, extra: Partial<AdapterProps> = {})` spreads `extra` (for `autoplay`).
- `FakePlayer.fire(type, init?: Record<string, unknown>)` assigns `init` onto the `Event` (for `{ buffering: true }`).
- `play()` stub as in `web-adapter-lows.test.tsx:133-141`: **a plain function on `HTMLMediaElement.prototype`, not
  `vi.spyOn`** (a vitest spy attaches its own `.then` and hides unhandled rejections), returning `playImpl()`; a
  `playCalls` counter; restore in `afterEach`. The stub does **not** dispatch `play`/`playing`; tests dispatch them.
- `process.on('unhandledRejection')` recorder; `afterEach` awaits one macrotask, then `expect(unhandled).toEqual([])`.
- `setPaused(bool)` via `Object.defineProperty(video, 'paused', …)`; `fireEl(type)` dispatches on the `<video>`.
- `const dom = (name) => new DOMException('play() failed', name)`.

`describe('play.ts helpers (KIT-033: shared by web and Vega)')`
- `it('startPlay reports a classified rejection once and swallows AbortError')`
- `it('startPlay tolerates a play() that returns undefined')`
- `it('startPlay leaves no unhandled rejection when report throws')`

`describe('VegaAdapter play() (KIT-033; experimental, mocked Shaka)')`
- `it('autoplay: play() is called once, after onTracks and ready')`
- `it('autoplay: an AbortError rejection reports nothing and leaves no unhandled rejection')`
- `it('autoplay: a NotSupportedError rejection reports nothing')`
- `it('autoplay: a NotAllowedError rejection reports one non-fatal PLAY_REJECTED and no state change')`
- `it('autoplay: a rejection that settles after a source switch is not reported')`
- `it("a superseded load whose load() settles after the switch does not call play()")` — `render(A, {autoplay:true})`,
  `render(B)` (autoplay off), `settle(0)`: `playCalls === 0`.
- `it('ref.play(): NotAllowedError reports PLAY_REJECTED; AbortError reports nothing')`
- `it('a play() that returns undefined does not throw')`
- `it('an onError that throws on PLAY_REJECTED leaves no unhandled rejection')`

`describe('VegaAdapter state reporting (KIT-033; experimental, mocked Shaka)')`
- `it("reports 'playing' on the element's playing event and nothing on play")`
- `it("Shaka buffering while playing reports 'buffering', then 'playing' when it ends")`
- `it('Shaka buffering while paused reports nothing, neither on start nor on end')`
- `it("after a source switch, the previous load's element listeners report nothing")` — `render(A)`, `settle(0)`,
  `render(B)`, `fireEl('pause')`, `fireEl('playing')`: `onState` gets exactly one `'paused'` and one `'playing'` (B's).
- `it('an autoplay load reports loading → ready → playing in that order')` — `settle(0)` with autoplay,
  then `fireEl('playing')`; filter `onState` calls.

Existing tests that must stay green unchanged: the four KIT-020 V1–V4 in this file; all of
`test/web-adapter-lows.test.tsx` (only its import line changes); `test/kit-player.test.tsx`. Run
`pnpm typecheck && pnpm test`. No harness change (the harness is web-only).

---

## 7. Changeset — `patch`

`.changeset/kit-033-vega-play.md`:

> ---
> '@moizp/vega-media-kit': patch
> ---
>
> **Vega (experimental, not device-verified): `play()` and playback state follow the web adapter.** A refused
> `play()` is reported as a non-fatal `PLAY_REJECTED` and an interrupted one (`AbortError`) is no longer an unhandled
> rejection; `playing` is reported when the element is actually playing, not as soon as `play()` is called, and
> `buffering`/`playing` from Shaka are not reported while paused. A source switch no longer leaves the previous
> source's element listeners attached. No type changes; multi-track text selection is unchanged. Web: no behaviour
> change (its `play()` helpers moved to a module shared with Vega).

Patch, not minor: no new codes or states (both exist since KIT-025), experimental platform with no support promise
(0001), web unchanged.

---

## 8. Additions to KIT-020 §6 (what KIT-010 must preserve)

Append to `docs/plans/KIT-020-adapter-tracks-reset.md` §6:

6. **KIT-033 — every `play()` goes through `startPlay` (`adapters/play.ts`)**; the autoplay report is per-load and
   cancelled; a superseded load never calls `play()`. The KIT-033 `describe`s in `test/vega-adapter-tracks.test.tsx`
   stay green against the new surface.
7. **KIT-033 — `playing` comes from the element's `playing`, never `play`**; Shaka `buffering` is ignored while paused.
   If the VVD shows the element fires `playing` on stall recovery, drop Shaka's `buffering: false → 'playing'`.
8. **KIT-033 — element listeners are removed per load** (the element half of KIT-024 is done; the
   `attach().then`/`publishTracks`/`load()` half remains, item 2).

---

## 9. What only the VVD can confirm (no blocker; for the device-matrix Vega column / KIT-010)

- **V1** The w3cmedia `VideoPlayer` (documented as a class implementing `HTMLVideoElement`,
  https://developer.amazon.com/docs/vega-api/0.24/README.amazon-devices_react-native-w3cmedia.html) dispatches
  `playing` (and `pause`/`ended`/`timeupdate`) through `addEventListener`. If it does not fire `playing`, R2 leaves a
  Vega player that never reports `playing` from the element — Shaka's `buffering: false` (R3) is then the only source.
- **V2** Its `play()` returns a promise and rejects with DOMException-like `name`s (`AbortError` on an interrupted
  play). If it returns `undefined`, `startPlay` is a no-op wrapper (pinned). If it rejects with other shapes, they become
  `PLAY_REJECTED` "Playback could not start" — check that this is not noisy on every switch.
- **V3** Shaka 4.8.5 + Amazon's patch series: does `buffering` fire while paused (R3's premise), and does the element
  fire `playing` after a stall (decides KIT-020 §6 item 7)?
- **V4** Whether an autoplay load on the VVD reports `ready` before `playing` (it should: R6).
None of these can be run today (0001: SDK not installed). The unit tests pin the adapter's logic against the mock only.

---

## 10. Open questions

- **Q1 (non-blocking)** R5 takes the element half of KIT-024 now. Default: yes — it is on the exact lines edited, has
  no interaction with the `tracks` ref, and makes the "previous load's listeners" test meaningful. If the orchestrator
  prefers strict scope, drop R5 and its test; nothing else depends on it. Update the KIT-024 row either way.
- **Q2 (non-blocking)** The shared `NotAllowedError` message says "browser". Default: keep (pinned on web; a TV app has
  no documented autoplay policy, so not expected on Vega). Alternative: drop "by the browser" for both — a web wording
  change and a test edit; not worth it now.
- **Q3 (non-blocking)** R3 keeps `buffering: false → 'playing'` while playing, so `onState('playing')` can arrive twice
  per stall recovery. Default: accept until V3. Alternative: drop it and rely on the element — risks a stuck
  `buffering` on an unverified element.

---

## 11. Mutation table (for the reviewer)

| # | Mutation | Must redden |
|---|---|---|
| M1 | Autoplay back to `void el.play()` | "autoplay: an AbortError rejection reports nothing and leaves no unhandled rejection" (unhandled recorder); "NotAllowedError reports one … PLAY_REJECTED" |
| M2 | `ref.play()` back to `void media.current?.play()` | "ref.play(): NotAllowedError reports PLAY_REJECTED; AbortError reports nothing" |
| M3 | Drop `!cancelled` in the autoplay report | "a rejection that settles after a source switch is not reported" (direct render: no kit gate to mask it) |
| M4 | Drop `!cancelled` before `startPlay` | "a superseded load whose load() settles after the switch does not call play()" |
| M5 | Keep a `play → 'playing'` listener (alone or alongside `playing`) | "reports 'playing' on the element's playing event and nothing on play"; "loading → ready → playing" (extra `playing`) only if the test dispatches `play` — it must |
| M6 | Remove the `playing` listener | "reports 'playing' on the element's playing event…"; "loading → ready → playing" |
| M7 | Drop the `el.paused` guard on Shaka `buffering` | "Shaka buffering while paused reports nothing…" |
| M8 | Guard only `buffering: true` (still `'playing'` on `false` while paused) | same test (the "nor on end" half) |
| M9 | Element listeners not removed in the cleanup | "after a source switch, the previous load's element listeners report nothing" |
| M10 | `startPlay` swallows every rejection / reports AbortError | helper tests + Vega AbortError / NotAllowedError tests + existing `web-adapter-lows` tests |
| M11 | `startPlay` without the `try/catch` around `report` | "an onError that throws on PLAY_REJECTED leaves no unhandled rejection" (Vega and web) |
| M12 | `publishTracks` reads `p` (out-of-scope "fix" of KIT-024) | existing KIT-020 V2/V3 ("…does not put the previous source's tracks back") |
| M13 | Autoplay `startPlay` moved before `publishTracks`/`ready` | "autoplay: play() is called once, after onTracks and ready" |

---

## 12. Risks

- **R-1** The fix is to an adapter that does not play video on a device as written (0002). Value is contract parity and
  pinned tests for KIT-010, not user impact. Stated in the changeset as experimental; no README status change.
- **R-2** jsdom's `play()` is unimplemented (console noise, `undefined`). The Vega test file has not stubbed it until now
  because nothing called it (no test sets `autoplay`); the new stub must be restored in `afterEach` so V1–V4 are
  unaffected.
- **R-3** The mock `FakePlayer.load` resolves after `destroy()` — real Shaka rejects. R4's test relies on the mock's
  behaviour to reach the line; that is the point (an engine that does not reject must still not start playback).
- **R-4** Duplicate `'playing'` reports on Vega stall recovery (R3, Q3). Idempotent in `renderControls`; an app counting
  `playing` events would see two. Low (no app runs on Vega).
- **R-5** Moving `playRejection` changes an internal import path; it is not public API (not in any `index.ts`,
  no `package.json` `exports` subpath reaches `adapters/`). Low.
- **R-6** Overlap with KIT-034: both edit the Shaka listener block in the same continuation. This ticket edits only the
  `buffering` listener and the autoplay line; KIT-034 edits the `error` listener. Expect a trivial merge; land either first.
