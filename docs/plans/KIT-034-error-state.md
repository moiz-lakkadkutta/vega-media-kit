# KIT-034 — Fire OS and Vega report `onState('error')` after a fatal error

**Role chain:** Planner (opus, standing in for fable; this document) → Implementer (opus) → Reviewer (fable) → device check
(human with the Fire TV Stick `AFTSS`).
**Protocol:** `docs/ORCHESTRATOR.md` §3, §4. **Decisions:** 0005 §3 (+KIT-016/KIT-025 amendments: the kit never synthesises
a state; `onError` origin-gated), 0008 (+KIT-025 amendment: the kit drops `ready` after `error`). **Plans:** KIT-025 §3.1
(web `MEDIA` → `error`, the model this ticket copies), KIT-023 (Fire OS per-load record). **Base:** `efefa95`.
**Status:** ready for an implementer. Nothing in §10 blocks. Parallel tickets: KIT-033 (Vega `play()` / `playing`),
KIT-035 (retry) — boundaries in §1.

Ticket text (`TASKS.md` KIT-034): "Fire OS and Vega never report `onState('error')` after a fatal error; web does since
KIT-025."

---

## 0. Verdict at a glance

1. **The contract already exists; the adapters break it.** `AdapterProps` (`src/player/types.ts:100-101`) already says
   "Report `error` after the fatal `onError` of a failed load", and `KitPlayerProps.onState` (`:56`) promises the app "A
   load that fails reports `error` (after `onError`)". Fire OS (`fireos.tsx:152`) and Vega (`vega.tsx:39-41`) report the
   fatal `onError` and stop. Today a Fire OS stream that 404s sits at `loading`/`buffering` forever in `renderControls`.
2. **Adapter-reported, not kit-derived** (§3). Each adapter calls `onState('error')` right after its fatal `onError`, as
   web does. The kit does **not** turn a `fatal: true` error into a state: that is synthesis, which 0005 §3 / 0008 §4 rule
   out; it would double-report on web; and it would make `fatal` load-bearing for state on codes whose fatality the kit
   cannot judge (§2). The kit-side guarantee is a cross-adapter vitest contract (§6.3), not runtime code.
3. **Fatal = "playback stopped and will not resume without the app".**
   - Fire OS `EXO`: fatal for every react-native-video `onError`, **except** `errorCode === '21002'`
     (`ERROR_CODE_BEHIND_LIVE_WINDOW`), which react-native-video recovers from itself (re-prepares at the live edge).
     That one becomes `fatal: false` and changes no state.
   - Vega `SHAKA_<n>`: fatal iff the Shaka error's `severity === 2` (`CRITICAL`); `RECOVERABLE` (1) becomes
     `fatal: false`, no state. A rejected `player.load()` is reported (today it is an unhandled rejection that leaves Vega
     at `loading`), except `LOAD_INTERRUPTED` (7000) / `OPERATION_ABORTED` (7001), which mean "superseded" and are silent.
   - `HLS_MASTER` and `TEXT_FETCH` stay non-fatal and **never** move the state (pinned by tests on Fire OS).
4. **Order: `onError` then `onState('error')`, synchronously, from the same handler** — identical to web R1.2.
5. **Per load.** Fire OS: the KIT-023 `Load` record gains `failed: boolean`, set by a fatal `EXO`. While set,
   ExoPlayer's own fallout of the error — `onPlaybackStateChanged({ isPlaying: false })`, which ExoPlayer delivers after
   `onPlayerError` when playback was running — is **not** reported as `paused` (it would overwrite `error`). Any sign the
   player is running again (`onBuffer`, `isPlaying: true`, `onLoadStart`) clears it. A new uri gets a new record, so the
   latch can never leak into the next title. Vega: the effect is already per load; it gains a `cancelled` flag and a
   per-load `failed` flag (one report per load when both the `error` event and the `load()` rejection fire).
6. **No kit code change.** `KitPlayer.tsx` already latches `readyClosed` on `error` (`:157`) and resets it per source
   (`:226`). JSDoc in `types.ts`, `docs/getting-started.md` and a changeset change.
7. **Changeset `minor`**: new observable `error` state on Fire OS and Vega; `fatal` changes for two codes; Vega load
   failures now reach `onError`.

---

## 1. Scope boundaries

In scope: `src/player/adapters/fireos.tsx`, `src/player/adapters/vega.tsx` (error paths only), `src/player/types.ts`
(JSDoc), `test/fireos-adapter.test.tsx`, new `test/vega-adapter-error.test.tsx`, `test/kit-player.test.tsx` (one pin),
`docs/getting-started.md`, `docs/device-matrix.md` (row added by the device check, not by the implementer),
`.changeset/kit-034-error-state.md`.

Out of scope — and who owns it:

- **KIT-033 (Vega `play()` / `playing`).** KIT-033 owns `vega.tsx` `play: () => void media.current?.play()` (`:64`), the
  autoplay `void el.play()` (`:46`), the `'play'` → `'playing'` listener (`:49`), any `waiting` → `buffering`, and the
  classification of `play()` rejections (incl. swallowing `NotSupportedError`). KIT-034 owns the Shaka `error`
  listener (`:39-41`), the `p.load()` rejection (`:43`), and a `cancelled` flag in the effect cleanup (`:52`).
  **Both edit the `attach().then(async () => { … })` block.** KIT-034 wraps `:43` in `try/catch` and returns from the
  catch before `:44-46`; it moves `:46` into the try **without changing its text**. Whichever lands second rebases;
  recommend KIT-033 first (smaller), or one implementer doing both back to back. If KIT-033 adds a `cancelled` flag
  too, there must be exactly one.
- **KIT-035 (retry after a fatal error).** KIT-034 adds no `reload()` and changes nothing about what `ref.play()` does
  after `error`. Facts for KIT-035's planner (read, not device-tested): react-native-video sets `playerNeedsSource = true`
  after `onPlayerError` (`node_modules/react-native-video/android/src/main/java/com/brentvatne/exoplayer/ReactExoplayerView.java:1977`),
  so what `setPaused(false)` does after an error is a KIT-035 device question. Whatever KIT-035 adds must start a new
  Fire OS `Load` record (or at least clear `failed` — `onLoadStart` does, R-F6) and a new Vega load.
- **Web** — done in KIT-025; untouched. No change to `MEDIA` / `PLAY_REJECTED`.
- `EXO` `message` stays `'Playback error'`. Surfacing `errorString` is tempting but is a separate observable change (Q3).
- No new public types, codes or exports. `exoError` / `shakaError` helpers are exported from their adapter modules for
  tests only, not from any `index.ts` (precedent: `mediaElementError` in `web.tsx`).

---

## 2. Which errors are fatal — evidence

### 2.1 Fire OS (react-native-video 6.19.2, installed; peer range `>=6`)

`onError` payload: `Video.tsx:536-540` forwards `e.nativeEvent`, typed `OnVideoErrorData`
(`src/specs/VideoNativeComponent.ts:296-305`): `{ error: { errorString?, errorException?, errorStackTrace?, errorCode? } }`
on Android, all strings. Docs: https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/events#onerror.
The adapter keeps passing the whole object as `cause` (unchanged).

Android emit sites (`ReactExoplayerView.java`), all through `VideoEventEmitter.kt:128-140`:

| errorCode | Site | Fatal? |
|---|---|---|
| `"2" + PlaybackException.errorCode` (e.g. `22004` bad HTTP status, `22001` network, `23002` manifest malformed, `24001` decoder init) | `onPlayerError` `:1952-1987` | **Yes.** ExoPlayer: "The playback state will transition to `STATE_IDLE` immediately after this method is called" — https://developer.android.com/reference/androidx/media3/common/Player.Listener#onPlayerError(androidx.media3.common.PlaybackException). react-native-video does not retry (except DRM once, before emitting). |
| `21002` (`ERROR_CODE_BEHIND_LIVE_WINDOW`, https://developer.android.com/reference/androidx/media3/common/PlaybackException#ERROR_CODE_BEHIND_LIVE_WINDOW) | same, `:1978-1982` | **No.** react-native-video calls `seekToDefaultPosition(); prepare()` right after emitting: playback resumes at the live edge with no app action. Reporting `error` would be followed by `buffering`/`playing` anyway. |
| `1001` (init failure) | `:671`, `:688`, `:700` | Yes. Can precede `onLoadStart` — so the error path must **not** be gated on `Load.started` (R-F5). |
| `3002`, `3003`, `3006`, `3007` (DRM) | `:2706`, `:914`, `:840`, `:829` | Yes (default). Unreachable: the kit passes no `drm`. `3002` is ExoPlayer's `onDrmSessionManagerError`, documented as "does not indicate that playback has failed"; not special-cased because unreachable (Q4). |
| `DAI_*` | `:2860`, `:2901` | Yes (default). Unreachable (no ads). |

Rule: `fatal = errorCode !== '21002'`; a missing / non-string `errorCode` (iOS shape, older versions, a mock) is fatal.

### 2.2 Vega (Shaka; Vega experimental, decision 0001)

- Shaka `error` event: `event.detail` is a `shaka.util.Error` with `severity`, `category`, `code` —
  https://shaka-player-demo.appspot.com/docs/api/shaka.Player.html#.event:ErrorEvent. `severity` 1 = `RECOVERABLE`
  ("the Player is attempting to recover"), 2 = `CRITICAL` ("cannot recover … a new manifest must be loaded") —
  https://shaka-player-demo.appspot.com/docs/api/shaka.util.Error.html#.Severity. Today every `error` event is reported
  `fatal: true` (`vega.tsx:40`), which is wrong for `RECOVERABLE`.
- `player.load()` rejects with a `shaka.util.Error` on failure (https://shaka-player-demo.appspot.com/docs/api/shaka.Player.html#load).
  `vega.tsx:43` awaits it inside `.then(async …)` with no catch: an unhandled rejection, no `onError`, state stuck at
  `loading`. Codes 7000 `LOAD_INTERRUPTED` and 7001 `OPERATION_ABORTED`
  (https://shaka-player-demo.appspot.com/docs/api/shaka.util.Error.html#.Code) are what a superseded load (cleanup's
  `p.destroy()`) rejects with — silent.
- Whether Shaka on the w3cmedia surface also dispatches `error` for a load failure (double report) is unknown →
  per-load `failed` dedupe (R-V4) and `TODO(spike)` on the VVD (§7.2).

---

## 3. Kit-derived vs adapter-reported `error` — decision

| | (A) Each adapter reports `onState('error')` after its fatal `onError` — **chosen** | (B) `handleError` derives `error` from `fatal: true` |
|---|---|---|
| 0005 §3 / 0008 §4 | Complies: "the kit never synthesises a state; it only refuses one". | Synthesis. Needs a decision amendment (human veto). |
| Web | Unchanged (already reports). | Double `error` unless web's report is removed or deduped — touches shipped KIT-025 code. |
| Correctness | The adapter knows its platform: `21002` / Shaka `RECOVERABLE` are not stops; ExoPlayer's trailing `isPlaying:false` must be swallowed (§4 R-F3) — only the adapter sees it. | Kit trusts `fatal`; still needs the Fire OS trailing-`paused` fix in the adapter, so (B) does not remove adapter work. |
| Guarantee for future adapters | A shared vitest contract (§6.3) plus the `AdapterProps` JSDoc. | Runtime. |

(B)'s only advantage is a runtime guarantee for adapters that do not exist yet. (A) keeps one owner per fact. A kit test
pins (A) (`K1`, §6.3) so nobody "fixes" this in the kit later without revisiting 0008.

---

## 4. Behaviour rules

### 4.1 Fire OS (`fireos.tsx`)

Interfaces (module-level, exported for tests only):

```ts
/** react-native-video's errorCode for ExoPlayer's ERROR_CODE_BEHIND_LIVE_WINDOW ("2" + 1002), which it recovers from itself. */
const BEHIND_LIVE_WINDOW = '21002'

/** The kit error for a react-native-video `onError` payload (`OnVideoErrorData`). */
export function exoError(e: unknown): PlayerError
// → { code: 'EXO', message: 'Playback error', fatal: errorCode !== BEHIND_LIVE_WINDOW, cause: e }
// errorCode read structurally: (e as { error?: { errorCode?: unknown } } | null)?.error?.errorCode

interface Load {
  …existing…
  /** Set by a fatal EXO. While set, ExoPlayer's isPlaying:false is the error's fallout, not a pause. */
  failed: boolean
}
// newLoad(uri) → { …, failed: false }
```

Rules:

- **R-F1** `onError={(e) => { const err = exoError(e); const l = load.current; props.onError?.(err); if (err.fatal) { l.failed = true; props.onState?.('error') } }}`.
  `onError` first, then `error`, synchronously (web R1.2). One of each per native event; a second fatal event reports
  both again (the kit's `setState('error')` is idempotent).
- **R-F2** `21002` → `onError` with `fatal: false`; no state, `failed` untouched.
- **R-F3** `onPlaybackStateChanged({ isPlaying: false })` while `load.current.failed` → reported as nothing. Reason:
  ExoPlayer delivers `onPlayerError` before `onIsPlayingChanged(false)` in the same playback-info update
  (`Player.Listener` callback order; react-native-video maps the latter to `onPlaybackStateChanged`,
  `ReactExoplayerView.java:1940-1950`), so a mid-playback failure would otherwise end at `paused`. Device-verified in
  §7.1 D2 (risk R-1).
- **R-F4** Recovery clears the latch: `onBuffer(any)`, `onPlaybackStateChanged({ isPlaying: true })` and `onLoadStart`
  set `failed = false` **before** reporting as today. (`onBuffer` only fires from `STATE_BUFFERING` / `STATE_READY`,
  `:1430-1441` — the player is running again.)
- **R-F5** The error path is **not** gated on `Load.started`: a `1001` can precede `onLoadStart`. Stale-source safety is
  `key={props.source.uri}` (an unmounted instance's events are dropped, KIT-023 §2.4) plus the kit's per-source
  `handleError` / `handleState` gates. `onError` / `onState` stay latest-props (unchanged Fire OS convention,
  `types.ts:103`).
- **R-F6** The pending `onLoad` continuation is **not** cancelled by a fatal error (web R1.5): if ExoPlayer's `onLoad` was
  dispatched and the error arrives during the manifest await, `onTracks` is still published (the tracks are true) and
  the adapter's `ready` is dropped by the kit (`readyClosed`). An error before `onLoad`: no `onTracks`, no `ready`.
- **R-F7** `HLS_MASTER` (`:95`) and `TEXT_FETCH` (`:80`) unchanged: `fatal: false`, no state, no effect on `failed`.
- **R-F8** `onEnd` / `onProgress` unchanged.

### 4.2 Vega (`vega.tsx`) — error paths only

Interfaces:

```ts
type ShakaErrorLike = { code?: number; message?: string; severity?: number } | undefined
/** The kit error for a Shaka error; fatal iff severity is CRITICAL (2). */
export function shakaError(detail: ShakaErrorLike, opts?: { fatal?: boolean }): PlayerError
// → { code: `SHAKA_${detail?.code ?? '?'}`, message: detail?.message ?? 'Playback error',
//     fatal: opts?.fatal ?? detail?.severity === 2, cause: detail }
/** A load() rejection that only means "superseded" (7000 LOAD_INTERRUPTED, 7001 OPERATION_ABORTED). */
export function isLoadInterrupted(e: unknown): boolean
```

Rules:

- **R-V1** Effect-local `let cancelled = false; let failed = false`; cleanup sets `cancelled = true` before `p.destroy()`.
  Every report below checks `!cancelled` (0005 §3 amendment: adapters cancel their own; the kit gate is the second line).
- **R-V2** `error` event: `const err = shakaError(e.detail); if (cancelled) return; if (err.fatal) { if (failed) return; failed = true }; props.onError?.(err); if (err.fatal) props.onState?.('error')`.
  `RECOVERABLE` → `onError` non-fatal, no state.
- **R-V3** `try { await p.load(...) } catch (e) { if (cancelled || isLoadInterrupted(e) || failed) return; failed = true; props.onError?.(shakaError(e, { fatal: true })); props.onState?.('error'); return }`
  — a rejected load is fatal regardless of `severity` (nothing is loaded). Then `publishTracks()` / `ready` / autoplay as
  today, inside the try (autoplay line text untouched — KIT-033's).
- **R-V4** At most one fatal report per load (`failed`), whichever of R-V2/R-V3 comes first.
- **R-V5** Handlers keep capturing the effect's `props` (per-load origin, KIT-016) — no latest-props ref.
- Not changed: listeners on `el` (KIT-033), `selectText`, `publishTracks`.

### 4.3 Kit, types, docs

- `KitPlayer.tsx`: no change.
- `types.ts` JSDoc, `onError` (`:63-72`): `EXO` → "Fire OS playback error; fatal — the state becomes `error` — except
  ExoPlayer's behind-live-window (`cause.error.errorCode === '21002'`), which recovers by itself and is non-fatal";
  `SHAKA_<n>` → "Vega; fatal (state `error`) when Shaka reports it CRITICAL or the load fails, non-fatal when Shaka is
  recovering". `onState` (`:55-56`): drop nothing; the sentence already covers all adapters.
- `docs/getting-started.md:56-59`: generalise "On web, …" to "If the source cannot be loaded or played — `MEDIA` on web,
  `EXO` on Fire OS, `SHAKA_<n>` on Vega — the kit reports a fatal error through `onError` and then `onState('error')`;
  no `ready` follows. Non-fatal errors (`HLS_MASTER`, `TEXT_FETCH`, `PLAY_REJECTED`) never change the state. To try
  again, change `source`." (KIT-035 may amend the last sentence.)

---

## 5. Files

| File | Change |
|---|---|
| `src/player/adapters/fireos.tsx` | `exoError`, `BEHIND_LIVE_WINDOW`; `Load.failed`; `onError` per R-F1/F2; `onPlaybackStateChanged` / `onBuffer` / `onLoadStart` per R-F3/F4 |
| `src/player/adapters/vega.tsx` | `shakaError`, `isLoadInterrupted`; `cancelled`/`failed`; `error` listener R-V2; `load()` try/catch R-V3 |
| `src/player/types.ts` | JSDoc only (§4.3) |
| `test/fireos-adapter.test.tsx` | new `describe` (§6.1); add `exoErr(code?)` fixture + a `log` that records `onError`/`onState` interleaved |
| `test/vega-adapter-error.test.tsx` (new) | §6.2; FakePlayer copied from `vega-adapter-tracks.test.tsx` with `fire(type, detail)` and a rejectable `load` |
| `test/kit-player.test.tsx` | `K1`, §6.3 |
| `docs/getting-started.md` | §4.3 |
| `.changeset/kit-034-error-state.md` | §9 |

`src/core/**`, `KitPlayer.tsx`, `web.tsx`, `selection.ts`, `hls.ts` untouched.

---

## 6. Tests (vitest; real adapters, platform mocked)

Order is asserted with one interleaved log: `log.push(['error', e.code])` from `onError`, `log.push(['state', s])` from
`onState`.

### 6.1 `test/fireos-adapter.test.tsx` — `describe('FireOsAdapter — fatal errors report error (KIT-034)')`

Real `KitPlayer` + real `FireOsAdapter`, `MockVideo` as today.

- F1 `it('a playback error reports a fatal EXO through onError, then onState(error), and renderControls shows error')`
- F2 `it('an error before onLoad: loading → buffering → error, and no onTracks or ready follows when the manifest resolves')`
- F3 `it('an error during the manifest await: onTracks is still published, ready is not (the kit drops ready after error)')`
- F4 `it("a mid-playback error is not overwritten by ExoPlayer's isPlaying:false that follows it")` — `playing`, EXO, `playbackState(false)` → last state `error`, `ctx.state === 'error'`
- F5 `it('onBuffer after a fatal error reports again: the player is running')` — EXO, `buffer(true)` → `buffering`; then `playbackState(false)` → `paused` (latch cleared)
- F6 `it('behind-live-window (errorCode 21002) is a non-fatal EXO and changes no state')`
- F7 `it('an EXO with no errorCode, or an unrecognised one, is fatal')` (`exoError` unit, 3 inputs: `undefined`, `{}`, `{ error: { errorCode: '22004' } }`)
- F8 `it('a master-playlist failure is a non-fatal HLS_MASTER and never moves the state to error; ready still follows')`
- F9 `it('a text track that cannot be loaded is a non-fatal TEXT_FETCH and never moves the state to error')`
- F10 `it("the error latch is per load: after a switch, the new source's isPlaying:false reports paused and its ready is reported")`
- F11 `it('an error reported before onLoadStart (player init failure) still reports error')`

### 6.2 `test/vega-adapter-error.test.tsx` — `describe('VegaAdapter — fatal errors report error (KIT-034)')`

Real `VegaAdapter`, rendered directly with spies (as `vega-adapter-tracks.test.tsx`; the kit's gates are covered elsewhere).

- V1 `it('a CRITICAL Shaka error reports a fatal SHAKA_<code> through onError, then onState(error)')`
- V2 `it('a RECOVERABLE Shaka error reports a non-fatal SHAKA_<code> and no state')`
- V3 `it('a rejected load() reports a fatal SHAKA_<code> then error, and no onTracks or ready')`
- V4 `it('a load() rejected with LOAD_INTERRUPTED or OPERATION_ABORTED reports nothing')`
- V5 `it('a load failure reported by both the error event and the load() rejection is reported once')`
- V6 `it("a superseded player's error or load rejection after a source switch reports nothing")`
- V7 `it('no unhandled rejection when load() rejects')` (record `unhandledrejection` / `process.on('unhandledRejection')`)

### 6.3 `test/kit-player.test.tsx` — inside the KIT-016 `describe` or a new one

- K1 `it('the kit does not derive a state from a fatal onError: an adapter that reports only onError leaves the state unchanged (0005 §3)')`
- K2 `it('after an adapter reports error, a late ready is dropped and a new source starts from loading')` — already partly
  covered by KIT-025; add only if no existing `it` pins it with the platform double (implementer checks).

Expected count: +11 Fire OS, +7 Vega, +1–2 kit.

### 6.4 Mutation table (implementer runs each, records red tests)

| # | Mutation | Must redden |
|---|---|---|
| M1 | Fire OS: delete `props.onState?.('error')` | F1, F2, F4, F11 |
| M2 | Fire OS: report `error` before `onError` | F1 |
| M3 | Fire OS: `fatal: true` for `21002` | F6 |
| M4 | Fire OS: drop the R-F3 `isPlaying:false` suppression | F4 |
| M5 | Fire OS: R-F4 not clearing `failed` on `onBuffer` | F5 |
| M6 | Fire OS: `failed` on a component ref instead of the `Load` record | F10 |
| M7 | Fire OS: gate the error path on `l.started` | F11 |
| M8 | Fire OS: `HLS_MASTER` or `TEXT_FETCH` call `onState('error')` | F8 / F9 |
| M9 | Fire OS: missing `errorCode` → non-fatal | F7 |
| M10 | Vega: ignore `severity` (all fatal) | V2 |
| M11 | Vega: no catch on `load()` | V3, V7 |
| M12 | Vega: no 7000/7001 swallow | V4 |
| M13 | Vega: no `failed` dedupe | V5 |
| M14 | Vega: no `cancelled` check | V6 |
| M15 | Kit: `handleError` sets `error` on `fatal` | K1 |

---

## 7. Device steps

### 7.1 Fire OS — Fire TV Stick `AFTSS` (primary; required before ticking)

Setup as in `docs/device-matrix.md` (sample app `KitSpikeScreen`, kit via `portal:`, logcat `KIT-SPIKE`). The HUD must
log every `onState` and every `onError` as `code fatal cause.error.errorCode` (sample-app change, not the kit).

- **D1 Startup 404.** Source = own CloudFront host with a missing path (`…/spike/hls/nope.m3u8`). Expect: `loading`,
  (`buffering`), `EXO fatal 22004` immediately followed by `state error`; `HLS_MASTER` (non-fatal) in either order
  relative to EXO; no `tracks`, no `ready`; HUD shows `error` and stays there 30 s.
- **D2 Mid-playback failure (verifies R-F3).** A copy of the own HLS package with segments ≥ 6 deleted from S3 (or a
  media playlist pointing at missing segments). Play; after the buffer drains expect `EXO fatal 22004` (or `22001`),
  `state error`, and **no `paused` after it** for 30 s. Record the raw logcat order of
  `onVideoError` / `onVideoPlaybackStateChanged` (react-native-video's `DebugLog` + ours). If ExoPlayer delivers
  `isPlaying:false` *before* the error, R-F3 is moot but harmless — note it in the matrix.
- **D3 Undecodable media.** A master whose variant is a non-media file (e.g. a `.txt` renamed). Expect a `23xxx` EXO
  fatal → `error`.
- **D4 Non-fatal stays non-fatal.** Own HLS with one subtitle URI broken (or Angel One + header override to a 404 VTT);
  select it: `TEXT_FETCH` non-fatal; state remains `playing`; other text track still renders.
- **D5 Recovery by switch.** From D1's `error`, switch to Angel One: `loading → … → playing`, `tracks` once, no stray
  `error`; pause/play reports `paused`/`playing` normally (latch did not leak).
- **D6 Switch before the error lands.** Start D1's broken uri, switch to Angel One within ~200 ms: no `EXO` and no
  `error` reported at all; Angel One plays.
- **D7 (optional) Behind live window.** Only if a live HLS is at hand: pause > window length, resume → `EXO` non-fatal
  `21002`, no `error` state, playback resumes. Mark "not verified" otherwise.

Device-matrix row: "Fatal error (KIT-034)" with D1–D6 results and evidence file.

### 7.2 Vega — Vega Virtual Device (if available; not blocking, decision 0001)

- V-D1 Broken uri: `SHAKA_<n>` fatal once, then `error`; no unhandled rejection in the Metro log.
- V-D2 Record whether Shaka dispatches `error` *and* rejects `load()` for the same failure (resolves the R-V4 dedupe
  `TODO(spike)` — leave a `TODO(spike)` comment at R-V4 in `vega.tsx` until then).
- V-D3 Switch mid-load: no 7000 reported.

---

## 8. Risks

- **R-1 ExoPlayer listener order (R-F3) is from documentation/reading, not observed.** If `isPlaying:false` arrives
  first, the state goes `playing → paused → error`, which is still correct; the suppression is then dead code but
  harmless. D2 decides; keep the rule either way.
- **R-2 `errorCode` format across react-native-video versions.** The `"2" + code` string is 6.x Android
  (`ReactExoplayerView.java:1953`). The peer range is `>=6`; on a version that changes it, `21002` would become fatal —
  i.e. the old behaviour plus a state; not a crash. Note it in the JSDoc.
- **R-3 Latch too sticky.** If ExoPlayer re-emits `isPlaying:false` after a genuine app-driven recovery without any
  `onBuffer` in between, a real pause would be swallowed. No such path exists in 6.19.2 (recovery always goes through
  `STATE_BUFFERING`); KIT-035's reload must clear it (§1).
- **R-4 Apps that treated the old silence as "still loading".** `described` / `lingo` read only `buffering` / `paused`
  / `ended` (0008 §2) — an `error` state shows nothing new in them; they keep their own error UI on `onError`. No app
  ticket needed, but mention in the changeset.
- **R-5 Vega is a scaffold.** The Vega tests pin the adapter's discipline against a fake, not Shaka-on-w3cmedia
  behaviour (same caveat as `vega-adapter-tracks.test.tsx`).
- **R-6 Merge conflict with KIT-033** in the `attach().then` block (§1).

---

## 9. Changeset

`.changeset/kit-034-error-state.md`, **`minor`**:

> **Fire OS and Vega report `onState('error')` after a fatal error.** As on web since the last release, a source that
> cannot be loaded or played now reports its fatal error through `onError` and then `onState('error')`; no `ready`
> follows. Previously Fire OS stayed at `loading`/`buffering` (or showed `paused` after a mid-playback failure). Fire OS:
> ExoPlayer's behind-live-window error (`cause.error.errorCode === '21002'`), which react-native-video recovers from by
> itself, is now `fatal: false` and changes no state. Vega (experimental): a Shaka error is fatal only when Shaka marks
> it CRITICAL, and a failed load now reaches `onError` instead of being an unhandled rejection. `HLS_MASTER` and
> `TEXT_FETCH` remain non-fatal and never change the state. To try again, change `source`.

---

## 10. Open questions

Non-blocking (defaults in brackets):

- **Q1** Kit-derived `error` (§3 B) as a runtime safety net for future adapters? [No — vitest contract K1 + JSDoc;
  revisit if a fourth adapter appears.]
- **Q2** Should a `HLS_MASTER` that arrives after a fatal `EXO` for the same load be suppressed (noise: "captions
  unavailable" after "playback failed")? [No — it is true; apps key UI on `fatal`.]
- **Q3** Use react-native-video's `errorString` (e.g. `ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS`) as the
  `EXO` `message`? [Not in this ticket — separate observable change; candidate follow-up.]
- **Q4** Treat DRM `3002` (`onDrmSessionManagerError`) as non-fatal? [No — unreachable without `drm`; default fatal.]
- **Q5** Land order with KIT-033 [KIT-033 first, or same implementer sequentially].

Blocking: **none**. §3 follows the existing 0005 §3 / 0008 §4 text and the `AdapterProps` contract, so no decision
amendment is needed; the orchestrator may record the `21002` / Shaka-severity fatality rule as a one-line 0008
amendment for visibility.
