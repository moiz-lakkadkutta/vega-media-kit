# KIT-025 — Web adapter lows: media errors, `play()` rejections, `playing` vs `play`, stale callbacks

**Role chain:** Planner (opus, standing in for fable; this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3, §4. **Decisions:** 0005 (incl. KIT-016 amendment: `onError` origin-gated per
source), 0008 (tracks before ready; `ready` dropped after `playing`/`ended`). **Plans:** KIT-016 §1 (boundary note),
KIT-015, KIT-012 (TASKS.md). **Base:** `dfde483` (`setVolume` from PR #1 is in `web.tsx:71-73`).
**Status:** ready for an implementer. Nothing in §9 blocks. §8 lists one decision amendment for the orchestrator.

Ticket text (`TASKS.md` KIT-025): "no element `error` listener, so media failures never reach `onError`; `void v.play()`
AbortError noise on interrupted loads; listeners capture `props.onState`/`onPosition` at effect time so an inline app
callback is stale until the next switch — give them the KIT-012 `onCueRef` treatment; the web adapter reports `playing`
on the `play` event, not `playing`, so an autoplay load reports `playing` before data and (0008) never reports `ready`;
with no `error` listener a failed load now sits at `loading`."

---

## 0. Verdict at a glance

1. **All four defects confirmed on `dfde483`; line refs drifted:**
   - no `error` listener: the listener table is `web.tsx:49-55` (ticket said `:83`). A 404 / undecodable `src` leaves
     the kit at `loading` forever (the join at `:34` waits for a `loadedmetadata` that never comes).
   - `void v.play()`: `web.tsx:59` (autoplay, ticket said `:57`) **and** `web.tsx:67` (`ref.play()`, not in the ticket —
     same defect: `play()` then `pause()`, or `play()` then a switch, rejects with `AbortError`, unhandled).
     StrictMode's double effect produces one on every dev mount with `autoplay`.
   - `['play', () => props.onState?.('playing')]`: `web.tsx:52`.
   - stale callbacks: the adapter side is `web.tsx:51-54` (listeners close over the effect's `props`), but **the stale
     link is in KitPlayer**, not the adapter: `handleState` (`KitPlayer.tsx:152-161`, deps `[props.onState, sourceUri]`)
     and `handlePosition` (`:134-142`, deps `[props.onPosition, scheduler]`) are re-created when the app's callback
     identity changes, and the adapter's per-load listeners keep the one from the load's first render. Same for
     `handleTracks` (`:114-132`, deps include `props.onTracks`, `props.preferredAudio`, `props.preferredText`) — not in
     the ticket, same bug (§3.4).
2. **Stale callbacks are fixed in KitPlayer, not in the adapter** (§3.4). Latest-props refs for the *app's*
   `onState`/`onPosition`/`onTracks` (exactly `onErrorRef`'s KIT-016 pattern), so `handleState` depends on `[sourceUri]`
   only and `handlePosition` on `[scheduler]` only. The adapter keeps capturing per load — which *is* the origin gate.
   An adapter-side "latest ref" would defeat the per-uri gates and is forbidden by the `AdapterProps` contract. This
   fixes Fire OS and Vega for free (they pass the same handlers).
3. **The KIT-016 boundary note is correct; adopt it.** The new `error` listener calls the `props.onError` its load
   effect captured. Reasoning in §3.1.3.
4. **A media element error → one `{ code: 'MEDIA', fatal: true, message: <per MediaError.code>, cause: v.error }`,
   then `onState('error')`.** `'error'` is already a `PlayerState` (`src/core/types.ts:42`) that no adapter emits today:
   **no type change**. The kit additionally drops a `ready` that arrives after the live load reported `error` (an
   extension of the 0008 §2 gate — needs a one-paragraph amendment, §8).
5. **`play()` rejections:** `AbortError` and `NotSupportedError` swallowed (the first is the intended outcome of an
   interrupted load; the second is always accompanied by the element `error` event → `MEDIA`); `NotAllowedError` and
   anything else → one non-fatal `{ code: 'PLAY_REJECTED' }`. New documented code; no type change.
6. **`play` → `playing`, plus `waiting` → `buffering` (only while `!v.paused`).** `pause`/`ended` unchanged. The 0008
   contract is unchanged in wording; in practice a web autoplay load can now report `ready` (when the join beats the
   element's `playing`), which is the truthful order and what 0008 §2 already permits ("may never report `ready`").
7. **Changeset: `minor`** (new observable web states `buffering`/`error`, new codes `MEDIA`/`PLAY_REJECTED`, stale
   callbacks fixed on all platforms). No public type changes.

---

## 1. Scope boundaries

In scope: `src/player/adapters/web.tsx`, `src/player/KitPlayer.tsx` (latest-props refs; `ready`-after-`error` gate),
`src/player/types.ts` (JSDoc only), harness wiring + specs, vitest, `docs/getting-started.md`, changeset.

Out of scope (do not touch):

- **KIT-020 (web half)** — `tracks` ref (`web.tsx:13`) survives a switch. *Interaction:* after this ticket a **failed**
  load never publishes `onTracks`, so `api.getTracks()` (which prefers the adapter, `KitPlayer.tsx:225`) returns the
  *previous* source's tracks **for the whole life of the failed load** — not only until the next `onTracks`. That
  raises KIT-020's urgency; it should be next. Do not reset `tracks.current` here.
- **Vega adapter** — `vega.tsx:41` (`void el.play()`) and `:44` (`play` → `playing`) have the same two defects. Vega is
  experimental (decision 0001); open a follow-up ticket (§9 Q2). Do not edit `vega.tsx`.
- **Fire OS / Vega `onState('error')`** on their fatal `EXO` / `SHAKA_*` — parity follow-up (§9 Q2).
- `handlePosition` origin gate — not added. Web/Vega remove their listeners per load and Fire OS reports through
  latest props; there is no stale position path to gate. Unchanged behaviour.
- `props.onCue` passed straight to the adapter (`KitPlayer.tsx:241`) — no adapter emits cues today; leave.

---

## 2. Files to touch

| File | Change |
|---|---|
| `src/player/adapters/web.tsx` | + exported pure helpers `mediaElementError`, `playRejection`; + `startPlay`; listener table: `error`, `playing` (replaces `play`), `waiting`; both `play()` call sites through `startPlay` |
| `src/player/KitPlayer.tsx` | + `onStateRef` / `onPositionRef` / `onTracksRef` / `prefsRef` (latest-props); `handleState` deps `[sourceUri]`, `handlePosition` deps `[scheduler]`, `handleTracks` deps `[selectText, sourceUri]`; `playbackBegan` → `readyClosed`, latched also on `'error'` |
| `src/player/types.ts` | JSDoc only: `onError` codes (+`MEDIA`, +`PLAY_REJECTED`), `onState` (web `buffering`, `error`), `AdapterProps` state contract (a failed load reports `error`, may report no `onTracks`/`ready`; `ready` dropped after `error`) |
| `harness/player.tsx` | `?autoplay=1`; `kit.unhandled` (unhandledrejection recorder); `?inlineCallbacks=1` extended to `onState`/`onTracks` with a render-generation witness (§6.2) |
| `harness/e2e/helpers.ts` | `routeStream` gains `mediaRespond?: RouteOverride` (applied in the media branch, after `gates.media`) |
| `harness/e2e/player.spec.ts` | Specs 34–42 (§6.2); header comment lists them; spec 22's comment "a leaked `play` listener" → "`playing` listener" |
| `test/web-adapter-lows.test.tsx` (new) | Real `KitPlayer` + real `WebAdapter` under jsdom (pattern: `test/web-adapter-volume.test.tsx`) |
| `test/kit-player.test.tsx` | New `describe` for latest-props refs vs the gate, and `ready` after `error` (platform double) |
| `docs/getting-started.md` | One paragraph after the `TEXT_FETCH` one (`:52-54`): `MEDIA`, `PLAY_REJECTED`, `error` state |
| `.changeset/kit-025-web-adapter-lows.md` | New (§10) |

`src/core/**` untouched (no RN imports question arises).

---

## 3. Behaviour rules per fix

### 3.1 Element `error` → `onError(MEDIA)` + `onState('error')`

#### 3.1.1 Interfaces (in `web.tsx`, exported for unit tests; **not** re-exported from any `index.ts`)

```ts
import type { PlayerError } from '../../core'

/** `MediaError.code` → message. Codes per https://html.spec.whatwg.org/multipage/media.html#mediaerror */
const MEDIA_MESSAGES: Record<number, string> = {
  1: 'Media loading was aborted',                       // MEDIA_ERR_ABORTED
  2: 'A network error stopped the media download',      // MEDIA_ERR_NETWORK
  3: 'The media could not be decoded',                  // MEDIA_ERR_DECODE
  4: 'The media source is not supported or could not be loaded', // MEDIA_ERR_SRC_NOT_SUPPORTED (Chromium: also a 404)
}

/** The kit error for the element's current `MediaError`, or `null` when there is none (a spurious `error` event). */
export function mediaElementError(err: Pick<MediaError, 'code' | 'message'> | null): PlayerError | null
// → null                                         when err is null
// → { code: 'MEDIA', fatal: true, message: MEDIA_MESSAGES[err.code] ?? 'Playback error', cause: err }
```

#### 3.1.2 Rules

- R1.1 Listener: `['error', () => { const e = mediaElementError(v.error); if (!e) return; props.onError?.(e); props.onState?.('error') }]`
  in the same `listeners` table, so it is removed by reference in the cleanup like the others.
- R1.2 Order: `onError` **before** `onState('error')`, so an app that renders a message on `state === 'error'` already
  holds the error. One of each per event.
- R1.3 `fatal: true` for every code: after an element error the HTML load algorithm stops the resource (networkState
  EMPTY/IDLE, no further data). Matches `EXO` / `SHAKA_*`. `cause` is the `MediaError` (the browser's `message` detail,
  e.g. Chromium's `DEMUXER_ERROR_COULD_NOT_OPEN`, lives there). Do **not** pin per-code messages in the harness —
  Chromium reports a 404 as code 4, not 2.
- R1.4 One code, `MEDIA`, not `MEDIA_<n>`: the `MediaError.code` is in `cause`; Fire OS uses one code (`EXO`) too.
  (§9 Q1, non-blocking.)
- R1.5 The join is **not** cancelled by an error. If metadata already arrived and the manifest lands after a decode
  error, `onTracks` is still published (the tracks are true) and `ready` follows from the join as today — the **kit**
  drops that `ready` (R1.6). The adapter stays a plain reporter (0008 §4: rules live in the kit). An error before
  `loadedmetadata` means the join never completes: no `onTracks`, no `ready` for that load.
- R1.6 KitPlayer: rename `playbackBegan` → `readyClosed` (update its JSDoc) and set it on `'playing' | 'ended' | 'error'`;
  `handleState` drops `ready` when it is set; the layout-effect reset clears it (`KitPlayer.tsx:199`). Nothing else in
  the gate changes. "`ready` means loaded, not yet playing" — a load that failed is neither.
- R1.7 No adapter-side stickiness: after `error`, later element events are reported as the platform fires them (e.g. an
  app `play()` after a `MEDIA_ERR_NETWORK` re-runs the load algorithm and may reach `playing`). The kit does not
  synthesise or refuse anything else.

#### 3.1.3 Which `onError`: the load's (KIT-016 boundary — verified)

`handleError` (`KitPlayer.tsx:62-68`) is re-created per `sourceUri` and delivers to the app through `onErrorRef`.
Therefore:

- capturing the load effect's `props.onError` loses nothing for the app (delivery is via the latest-props ref, never
  stale), and
- it gains the gate: an error that belongs to load A reaches `handleError(A)`, which drops it once B is live.
- An adapter-side latest-props ref would route A's error through `handleError(B)` → **reported as B's error**. That is
  the misattribution the gate exists to prevent.

In practice the window is closed by the platform too: setting `v.src` runs the media element load algorithm, which
removes every queued task from the media element event task source before loading B
(https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm, step "If there are any tasks from the
media element's media element event task source in one of the task queues, then remove those tasks"), and the
cleanup removes A's listeners before B's effect assigns `src`. So the rule is belt-and-braces on web and load-bearing on
any adapter whose platform does not purge queued events. Decision: **per-load capture**, as KIT-016 said.

### 3.2 `play()` rejections

#### 3.2.1 Interfaces

```ts
/** `null` = swallow. AbortError (load/pause interrupted the play — the intended outcome) and NotSupportedError (always
 *  accompanied by the element `error` event, reported as MEDIA) are swallowed; everything else is PLAY_REJECTED. */
export function playRejection(e: unknown): PlayerError | null
// NotAllowedError → { code: 'PLAY_REJECTED', fatal: false, message: 'Playback was blocked by the browser (autoplay policy)', cause: e }
// other          → { code: 'PLAY_REJECTED', fatal: false, message: 'Playback could not start', cause: e }
// name read structurally: (e as { name?: unknown })?.name — a DOMException in browsers, a plain Error in tests

/** v.play(), with the rejection classified and reported. Tolerates a non-promise return (legacy engines, jsdom). */
function startPlay(v: HTMLVideoElement, report: (e: PlayerError) => void): void
```

The HTML spec's `play()` rejects with exactly `NotAllowedError`, `NotSupportedError` or `AbortError`
(https://html.spec.whatwg.org/multipage/media.html#dom-media-play); "other" is defensive.

#### 3.2.2 Rules

- R2.1 Autoplay (`web.tsx:59`): `startPlay(v, (e) => { if (!cancelled) props.onError?.(e) })` — the load's `onError`
  (§3.1.3), plus the adapter's own cancel (0005 §3 amendment: adapters cancel their own superseded reports; the kit
  gate is the second line).
- R2.2 `ref.play()` (`web.tsx:67`): `play: () => { const v = el.current; if (v) startPlay(v, (e) => props.onError?.(e)) }`
  — this render's props, i.e. the `handleError` of the source live when `play()` was called (same reasoning as
  `selectText`, `web.tsx:76-77`). A rejection settling after a switch is dropped by that handler's gate.
- R2.3 A swallowed rejection reports nothing: no `onError`, no state, no `console` output.
- R2.4 `PLAY_REJECTED` changes no state: the element stays paused; the load's join still reports `ready`. An app shows
  a "press play" affordance on `PLAY_REJECTED`.
- R2.5 Never an unhandled rejection from either call site, whatever `play()` does (incl. the report callback
  throwing — wrap `report` in `try {} catch {}` like `KitPlayer.tsx:93-97`).

### 3.3 `play` → `playing`; `waiting` → `buffering`

- R3.1 Listener table becomes: `loadedmetadata`, `timeupdate`, `playing → 'playing'`, `waiting → 'buffering'` (guarded),
  `pause → 'paused'`, `ended → 'ended'`, `error` (§3.1). **No `play` listener.**
- R3.2 `waiting`: report `buffering` only when `!v.paused`. Chromium fires `waiting` during a seek even while paused;
  reporting it then would leave the state at `buffering` with no event to leave it (`playing` never fires while paused).
  While playing, the element fires `playing` when it recovers — so `buffering → playing` closes itself.
- R3.3 Per the HTML spec's `play()` steps, a `play()` with `readyState < HAVE_FUTURE_DATA` queues `waiting`; with enough
  data it fires `playing`. So the sequences are: autoplay load `loading → buffering → [ready] → playing`, or
  `loading → buffering → playing` (+ `onTracks`, `ready` dropped) when playback beats the manifest; manual play on a
  loaded source `ready → playing` (or `ready → buffering → playing`). See R-1 if Chromium does not fire `waiting`.
- R3.4 **0008 effect.** Wording unchanged. Before: web's `play` event latched `playbackBegan` synchronously after
  `play()`, so an autoplay load *never* reported `ready`. After: `ready` is reported whenever the join (metadata +
  manifest) completes before the element is actually playing — usually true for a fast manifest. That is what 0008
  §2 describes ("`ready` means loaded, not yet playing"; an autoplay load *may* never report `ready`) and what Fire OS
  does. **It should**: `ready` before data would be a lie in the other direction. `buffering` before `ready` does not
  suppress it (0008 §2, already). Apps were told not to wait for `ready` (0008 §2); `described`/`lingo` read only
  `buffering`/`paused`/`ended` — `described` will now see `buffering` on web, as on Fire OS.
- R3.5 `pause`: unchanged. Note the spec fires `pause` before `ended` at the end of media; the final state is `ended`
  as today.

### 3.4 Stale callbacks: latest-props refs in KitPlayer (KIT-012 treatment)

#### 3.4.1 Where the staleness is

The app's callback is read inside a KitPlayer handler whose identity follows the app's callback; the adapter holds the
handler of the render its load began in. So the fix is to make the **handlers'** identity follow only `sourceUri`
(and stable deps), and read the app's callbacks through refs — exactly `onErrorRef` (`KitPlayer.tsx:45-46`).

#### 3.4.2 Interfaces (KitPlayer internals; no exports)

```ts
const onStateRef = useRef(props.onState);       onStateRef.current = props.onState
const onPositionRef = useRef(props.onPosition); onPositionRef.current = props.onPosition
const onTracksRef = useRef(props.onTracks);     onTracksRef.current = props.onTracks
const prefsRef = useRef({ audio: props.preferredAudio, text: props.preferredText })
prefsRef.current = { audio: props.preferredAudio, text: props.preferredText }

handleState    = useCallback((s) => { …gate…; setState(s); onStateRef.current?.(s) },           [sourceUri])
handlePosition = useCallback((s) => { …; onPositionRef.current?.(s); scheduler.update(s) },      [scheduler])
handleTracks   = useCallback((t) => { …gate…; onTracksRef.current?.(t); …pickAudio(t.audio, prefsRef.current.audio)…
                                      autoSelectedTextIds(t.text, prefsRef.current.text) …},       [selectText, sourceUri])
```

#### 3.4.3 Rules

- R4.1 The per-uri origin gates are untouched: each handler still closes over its own `sourceUri` and compares it with
  `liveUri.current`. The ref only changes *which app callback* receives an accepted report — always the latest. A
  report through a superseded handler is still dropped before the ref is read.
- R4.2 The adapter side does **not** change: listeners keep capturing `props.onState`/`onPosition` per load. Do not add
  any latest-props ref in `web.tsx` (contract, `types.ts:72-90`).
- R4.3 Identity: after this, `handleState`/`handleTracks`/`handleTextTrackData`/`handleError` change identity exactly
  on `sourceUri`; `handlePosition` never. No adapter re-subscribes on an app re-render.
- R4.4 `preferredAudio`/`preferredText` through `prefsRef` means the preference **current when `onTracks` arrives** is
  applied, not the one current when the load began. 0005 §2.2 says "with the props of the new render"; latest is the
  natural reading and fixes an inline `preferredText={{…}}` object (the harness itself builds one per render with
  `JSON.parse`). Scope extension — reviewer may cut it to `onTracks` only (§9 Q3).
- R4.5 Writing refs during render follows the existing precedent (`onCueRef`, `onErrorRef`); keep it consistent.

---

## 4. Docs (JSDoc + getting-started)

- `KitPlayerProps.onError`: add `MEDIA` (web: the `<video>` element reported a `MediaError` — unreachable, undecodable
  or unsupported media; fatal; `cause` is the `MediaError`) and `PLAY_REJECTED` (web: `play()` was refused, normally the
  browser's autoplay policy; non-fatal, playback stays paused and can be started by a later `play()`).
- `KitPlayerProps.onState`: append "A load that fails reports `error` (after `onError`); `ready` is not reported after
  `error`. Web reports `buffering` while it waits for data during playback."
- `AdapterProps` state contract (`types.ts:84-90`): "…`onTracks` exactly once when the track list is complete — none if
  the load fails first… Report `error` after the fatal `onError` of a failed load. The kit drops a `ready` that arrives
  after the load reported `playing`, `ended` or `error`…". Origin contract: unchanged (already names "a media error").
- `docs/getting-started.md` after `:54`: one paragraph — `MEDIA` (fatal, `state` becomes `error`), `PLAY_REJECTED`
  (non-fatal; show a play button).

---

## 5. Order of work (TDD)

1. Pure helpers `mediaElementError`, `playRejection` + their unit tests.
2. KitPlayer refs + `readyClosed` (double tests in `kit-player.test.tsx` first).
3. `web.tsx` listeners + `startPlay` (jsdom tests in the new file first).
4. Harness wiring, specs 34–42; run `pnpm test`, `pnpm typecheck`, the Playwright harness (all existing specs must stay
   green — especially 11, 22, 26).
5. JSDoc, getting-started, changeset.

---

## 6. Acceptance tests

### 6.1 Vitest

**`test/web-adapter-lows.test.tsx`** (new; `// @vitest-environment jsdom`; real `KitPlayer` with
`vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))` so `resolveAdapter` gives the real `WebAdapter`;
`fetch` stubbed per test; `HTMLMediaElement.prototype.play`/`pause` stubbed with `vi.spyOn` (jsdom does not implement
them); `v.error`/`v.paused` set with `Object.defineProperty` on the element; events via `v.dispatchEvent(new Event(…))`;
a `process.on('unhandledRejection')` spy asserted empty in `afterEach`).

`describe('mediaElementError / playRejection (KIT-025, pure)')`
- `it('maps each MediaError code 1–4 to a fatal MEDIA with the per-code message and the MediaError as cause')`
- `it('returns null for an error event with no MediaError')`
- `it('swallows AbortError and NotSupportedError')`
- `it('reports NotAllowedError as a non-fatal PLAY_REJECTED with the autoplay message')`
- `it('reports any other rejection reason (incl. a non-Error value) as a non-fatal PLAY_REJECTED')`

`describe('WebAdapter media errors (KIT-025, real KitPlayer + WebAdapter)')`
- `it("an element error reports one fatal MEDIA through onError, then onState('error'), in that order")`
- `it("a failed load with no metadata publishes no onTracks and no ready, and renderControls' state is 'error'")`
- `it('an error after loadedmetadata, then the manifest: onTracks is published but ready is dropped')`
- `it('an error after a source switch is reported once, as the new source's (the old listener is gone)')`
- `it("after a failed load, a switch reports loading, onTracks and ready for the new source")`

`describe('WebAdapter play() rejections (KIT-025)')`
- `it('autoplay: an AbortError rejection reports nothing and leaves no unhandled rejection')`
- `it('autoplay: a NotSupportedError rejection reports nothing (the element error reports MEDIA)')`
- `it('autoplay: a NotAllowedError rejection reports one non-fatal PLAY_REJECTED and the load still reports ready')`
- `it('ref.play(): NotAllowedError reports PLAY_REJECTED; AbortError reports nothing')`
- `it('an autoplay rejection that settles after a source switch is not reported')`
- `it('a play() that returns undefined does not throw')`
- `it("an app onError that throws on PLAY_REJECTED leaves no unhandled rejection")`

`describe('WebAdapter element states (KIT-025)')`
- `it("reports 'playing' on the element's playing event and nothing on play")`
- `it("reports 'buffering' on waiting while not paused, and nothing on waiting while paused")`
- `it('an autoplay load whose join completes before playing reports loading → ready → playing')`
- `it('an autoplay load that plays before the manifest lands reports loading → playing, onTracks, and no ready (0008 §2)')`

`describe('WebAdapter + KitPlayer: inline callbacks are never stale (KIT-025 × KIT-012)')`
- `it('a re-render with a new inline onState: the next element state reaches the new callback, not the old one')`
- `it('a re-render with a new inline onPosition: the next timeupdate reaches the new callback, not the old one')`
- `it('a re-render with a new inline onTracks before the join completes: the tracks reach the new callback')`
- `it('a re-render with a new preferredText before the join completes: the new preference is applied')` (drop with Q3)

**`test/kit-player.test.tsx`** (platform double; new `describe('KitPlayer latest-props callbacks and the origin gates (KIT-025)')`)
- `it('a state handler captured before a same-source re-render delivers to the latest app onState')`
- `it('a position handler captured before a re-render delivers to the latest app onPosition')`
- `it("the same captured state handler is still refused after a source switch: the ref does not bypass the gate")`
- `it('the state, tracks and position handlers keep their identity across a same-source re-render with new inline callbacks')`
- `it("ready is dropped after the live load reported error; the next source's ready is reported")`

Existing KIT-015/KIT-022/KIT-016 tests must pass unchanged.

### 6.2 Harness (`harness/e2e/player.spec.ts`, real KitPlayer + WebAdapter in Chromium)

Harness wiring:
- `?autoplay=1` → `autoplay` prop (the config already launches with `--autoplay-policy=no-user-gesture-required`).
- `kit.unhandled: string[]` — a `window` `unhandledrejection` listener pushes `String(reason?.name ?? reason)`.
- `?inlineCallbacks=1` also wraps `onState`/`onTracks` in per-render arrows; App keeps a render generation `gen`, each
  arrow records the `gen` it was created in to `kit.calledGen.{state,position}` before delegating; `kit.gen()` returns
  the current one. (Today the inline arrows delegate to module functions, so staleness is unobservable.)
- `routeStream(page, { mediaRespond })` — overrides the **media** request of a `master*` path (manifest stays real).

Specs:
- 34 `test('a media URL answering 404 reaches onError as one fatal MEDIA and the state becomes error; no tracks, no ready (KIT-025)')`
  — `mediaRespond: { status: 404 }`; no `HLS_MASTER` (manifest is fine).
- 35 `test('a 200 media body that is not media reaches onError as one fatal MEDIA (KIT-025)')` — `mediaRespond: { status: 200, body: 'not a video', contentType: 'video/webm' }`.
- 36 `test('a broken source followed by a switch: the new source reports loading, tracks and ready and no further error (KIT-025)')`
- 37 `test('an autoplay load interrupted by a source switch leaves no unhandled rejection and reports no error (KIT-025)')`
  — `?autoplay=1`, `gates.media` held for A, `setSource('/stream/master-b')`; assert `kit.unhandled` empty and no
  `error` events; **positive control**: B reaches `playing`.
- 38 `test('ref.play() then ref.pause() in one task leaves no unhandled rejection (KIT-025)')`
- 39 `test("an autoplay load reports no 'playing' until the element is playing: with the media held it is not playing, released it is (KIT-025)")`
  — assert, while held, states ⊆ {loading, buffering}; after release `playing` arrives; the `video.paused === false` witness.
- 40 `test("an autoplay load whose manifest is already in reports ready before playing (KIT-025 × 0008)")` — states with
  `buffering` removed equal `['loading','ready','playing']`; `onTracks` before `ready`.
- 41 `test('inline onState/onPosition: after re-renders the next state and position reach the latest callbacks (KIT-025)')`
  — `?inlineCallbacks=1`, three `rerender()`s, `play()`; `kit.calledGen.state === kit.gen()` and same for position.
- 42 (optional, own `test.describe` with `test.use({ launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] } })`)
  `test('autoplay blocked by policy reports one non-fatal PLAY_REJECTED and the load still reports ready (KIT-025)')`.
  If the worker-scoped override proves awkward, leave 42 out; the vitest NotAllowedError test is the guard.

Existing specs that must stay green unchanged in assertions: 11/10 (KIT-015 ordering), 22 (`playing` count 1 per
`play()`; comment wording only), 25, 26 (KIT-028), 30–33.

---

## 7. Mutation table (for the reviewer)

| # | Mutation | Must redden |
|---|---|---|
| M1 | Remove the `error` listener | web-lows "element error reports one fatal MEDIA…"; harness 34, 35 |
| M2 | `fatal: false`, or code `MEDIA_4` | pure "maps each MediaError code…"; web-lows MEDIA test; harness 34 |
| M3 | Omit `onState('error')` (or report it before `onError`) | web-lows "…in that order"; "…renderControls' state is 'error'"; harness 34 |
| M4 | KitPlayer does not latch `readyClosed` on `error` | web-lows "error after loadedmetadata… ready is dropped"; kit-player "ready is dropped after … error" |
| M5 | `readyClosed` not reset on switch | web-lows "after a failed load, a switch…"; kit-player same test (second half); harness 36 |
| M6 | Error listener reads `onError` through an adapter latest-props ref | **Not observable through the real web adapter** (platform purges queued events, §3.1.3); guarded by the `AdapterProps` contract + review; the kit-side gate is pinned by KIT-016's existing double tests |
| M7 | Back to `void v.play()` at either call site | web-lows AbortError tests (unhandled-rejection spy); harness 37, 38 |
| M8 | Swallow every rejection | pure NotAllowedError test; web-lows "NotAllowedError reports one PLAY_REJECTED"; harness 42 |
| M9 | Report `AbortError` / `NotSupportedError` | pure "swallows…"; web-lows AbortError/NotSupportedError tests; harness 37 |
| M10 | Drop the `cancelled` check in the autoplay report | Masked by the kit gate ("settles after a switch" still green) — acceptable, 0005 §3 amendment; reviewer confirms the check is present |
| M11 | Keep a `play → playing` listener | web-lows "reports 'playing' on playing and nothing on play"; harness 39 |
| M12 | `waiting` without the `!v.paused` guard | web-lows "…nothing on waiting while paused" |
| M13 | `handleState` keyed on `props.onState` again | web-lows inline onState test; kit-player identity + captured-handler tests; harness 41 |
| M14 | `handlePosition` keyed on `props.onPosition` again | web-lows inline onPosition; kit-player position test; harness 41 |
| M15 | `handleState` deps `[]` (gate closes over the first uri) | kit-player "still refused after a source switch"; existing KIT-015 "drops a superseded load's onState"; harness 22 |
| M16 | Read `props.onTracks` / prefs directly in `handleTracks` | web-lows inline onTracks / preferredText tests |
| M17 | `ready` reported by the adapter on `canplay`/`playing` instead of the join | existing harness 10/11, web-lows autoplay sequence tests |

---

## 8. Decision record (orchestrator)

Amend **0008** (one paragraph, "Amended (KIT-025)"): (a) the kit also drops a `ready` after the live load reported
`error`; (b) web now reports `playing` on the element's `playing` event and `buffering` on `waiting`, so a web autoplay
load reports `ready` whenever its tracks are known before playback actually starts — the "may never report `ready`"
case is now only the manifest-slower-than-playback case, as on Fire OS. Amend **0005**'s KIT-016 paragraph with one
line: element media errors and autoplay rejections are per-load reports (load-captured `onError`). (a) is a new kit
refusal of the 0008 §2 kind, which the human approved for `playing`/`ended`; offer it for veto, not blocking.

---

## 9. Open questions

- **Q1 (non-blocking)** Code names: `MEDIA` (one code, `MediaError.code` in `cause`) and `PLAY_REJECTED` (message
  distinguishes autoplay). Alternatives: `MEDIA_<n>` (mirrors `SHAKA_<n>`, but browser-specific — a 404 is `4` on
  Chromium), `AUTOPLAY_BLOCKED` (narrower than what `play()` can reject with). Default: as planned.
- **Q2 (non-blocking, follow-up tickets)** (a) Vega: `vega.tsx:41` `void el.play()` and `:44` `play` → `playing` have the
  same defects; (b) Fire OS `EXO` / Vega `SHAKA_*` do not report `onState('error')` — after this ticket web is the only
  adapter that does. Suggest one parity ticket.
- **Q3 (non-blocking)** Include `preferredAudio`/`preferredText` in the latest-props treatment (R4.4)? Default: yes.
  If cut, keep `onTracksRef` (same bug as the ticket's `onState`/`onPosition`).
- **Q4 (non-blocking)** KIT-020 should follow immediately: a failed load now leaves `api.getTracks()` on the previous
  source's tracks indefinitely (§1).

---

## 10. Changeset — `minor`

`.changeset/kit-025-web-adapter-lows.md`:

> **Web: media failures reach `onError`, and state follows the element.** When the `<video>` element cannot load or
> decode the source, the web adapter now reports a fatal `{ code: 'MEDIA', … , cause: MediaError }` through `onError`
> and then `onState('error')` — previously the failure was invisible and the state stayed `loading`. `ready` is not
> reported after `error`. A `play()` the browser refuses (normally its autoplay policy) is reported as a non-fatal
> `PLAY_REJECTED`; a `play()` interrupted by a source switch or `pause()` is no longer an unhandled `AbortError`.
> Web now reports `playing` when the element is actually playing (previously as soon as `play()` was called, before
> any data) and `buffering` while it waits for data during playback, so an autoplay load can report `ready` before
> `playing` (decision 0008). **All platforms:** an inline `onState`, `onPosition` or `onTracks` callback (a new
> function every render) is no longer stale — the latest one is always called, and `preferredAudio`/`preferredText`
> are read when the tracks arrive. No type changes; multi-track text selection is unchanged.

---

## 11. Risks

- **R-1** Chromium may not fire `waiting` on a `play()` with `readyState < HAVE_FUTURE_DATA` despite the spec. Spec 39
  surfaces it. Fallback (implementer, note it in the PR): in the `play` handler report `buffering` iff
  `v.readyState < 3` (still never `playing`). Do not reintroduce `play → playing`.
- **R-2** `playing` fires again after every stall recovery; spec 22's "exactly one `playing`" assumes no stall on the
  1 KB local fixture. If it flakes, that is a real stall, not a leaked listener — investigate before relaxing.
- **R-3** Web autoplay apps now see `ready` (often) and `buffering`. 0008 told apps not to rely on either; `described`
  already handles `buffering` from Fire OS. Low.
- **R-4** `'error'` was a declared but unreachable `PlayerState`; an app with a non-exhaustive `switch` may render
  nothing for it. Typed apps already had to handle it. Low.
- **R-5** jsdom: `play()`/`pause()` are unimplemented (console noise, `undefined` return) — stub them; `startPlay` must
  tolerate `undefined` anyway (pinned).
- **R-6** `prefsRef` (R4.4) changes which preference applies if an app changes `preferredText` mid-load — intended, but a
  behaviour change; covered in the changeset.
- **R-7** M6/M10 are unobservable through the real web adapter by construction; the reviewer must check them by reading.
