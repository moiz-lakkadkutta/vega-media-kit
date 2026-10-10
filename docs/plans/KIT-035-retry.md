# KIT-035 — Retry after a fatal error on the same uri

**Role chain:** Planner (opus, judgement brief; this document) → **human picks the API (§1, Q1)** → Implementer (opus) →
Reviewer (fable). **Protocol:** `docs/ORCHESTRATOR.md` §3, §6 (a public `KitPlayerRef` change touches `described`'s
test stub → kit ↔ app interface change → escalate). **Decisions:** 0005 (reset keyed on `uri`; §4 rejected a numeric
generation), 0008 (+ KIT-025 amendment: `ready` dropped after `error`). **Plans:** KIT-025 (R1.7, §3.2), KIT-020.
**Base:** `efefa95`. **Parallel ticket:** KIT-034 (Fire OS / Vega report `onState('error')`) — see §8.
**Status:** blocked on Q1 (the API choice). Everything below assumes the recommendation (A + D2, B and E documented).

Ticket (`TASKS.md` KIT-035): "No retry after a fatal `MEDIA` on the same uri: `sourceChanged` compares uri only
(`selection.ts:29`), `ref.play()` after a 404 rejects `NotSupportedError` (swallowed) → nothing happens, nothing
reported. Decide: a `reload()` on `KitPlayerRef`, or document 'retry with a new uri' in `docs/getting-started.md`."

---

## 0. What happens today (verified on `efefa95`)

1. A failed web load reports `MEDIA` (fatal) then `error`. The app's only same-uri levers:
   - `ref.play()` → `startPlay` (`web.tsx:43-54`) → `v.play()`. With `v.error.code === 4` (Chromium reports a 404 as
     code 4) the HTML `play()` steps return a promise rejected with `NotSupportedError` and fire **no** new `error`
     event (https://html.spec.whatwg.org/multipage/media.html#dom-media-play, step 2). `playRejection` swallows
     `NotSupportedError` (`web.tsx:32`) because on the *autoplay* path it is always paired with the element `error`
     event. On the `ref.play()` path after a failure it is not → **silence**. Fire OS: `play` = `setPaused(false)` on a
     dead ExoPlayer → silence. Vega: `void media.current?.play()` → silence.
   - Re-rendering with the same `source` → `sourceChanged` false (`selection.ts:29`), the adapters' load effects are
     keyed on `props.source.uri` (`web.tsx:78-141`, `vega.tsx:29-54`, `fireos.tsx:135` `key={props.source.uri}`) → nothing.
2. **What works today, everywhere: remount.** `described` does exactly this — `<KitPlayer key={attempt} …>`
   (`described/packages/shared-ui/src/screens/Player.tsx:378-379`, `retry()` at `:286-289` bumps `attempt`, resets its
   own state and resumes via `startAt = getPosition()`). `lingo` passes no `onError` at all
   (`lingo/packages/shared-ui/src/screens/Player.tsx:158-165`) — a failed clip sits silently.
3. A cache-buster uri (`?retry=1`) also works today on all adapters: it is a source change (0005 §1).

## 1. Options

| | What | API | Cost | Verdict |
|---|---|---|---|---|
| **A** | `KitPlayerRef.reload(): void` — re-runs the full 0005 §2 reset and a new adapter load for the *same* uri, on every adapter. The reset and every origin gate are keyed on a **load key** (`uri` + a reload generation) instead of `uri` | +1 ref method (minor) | KitPlayer + 3 adapters (one dep each) + `selection.ts`; ~60 lines + tests | **Recommended** |
| **B** | Document "retry with a new uri" (cache-buster query param) | none | docs only | Document as the fallback for a CDN that caches the failure; not the primary answer — signed URLs / HLS relative paths may break with an appended param, and it relies on the app mangling its own uri |
| **C** | `play()` after `error` reloads implicitly | none (semantics) | as A, plus a hidden branch in `play` | **Rejected.** Magic: `play` after a fatal error silently restarts from `startAt` (not where the user was), refetches the manifest, resets selections — none of which `play` means anywhere else. Platform-dependent today (needs KIT-034 to know "after error" on Fire OS/Vega). Can be layered on A later if wanted |
| **D** | Report the swallowed `play()` after a failure instead of silence | none (new behaviour of an existing code) | small | **Recommended, as D2** (below), with A or without it |
| **E** | Document the remount (`key={attempt}`) | none | docs only | Document as an alternative (it is what `described` ships). Loses kit-held state the app may not expect: volume and rate reset (contradicts "volume kept across source changes" for an app that thinks of retry as a reload), `onCue([])` is not emitted (the app's overlay keeps the last cue), `renderControls` remounts |

**D variants.**
- **D1 (adapter, web only):** `ref.play()` on an element whose `error` is non-null at call time reports the
  `NotSupportedError` as non-fatal `PLAY_REJECTED`. Web only; Fire OS/Vega stay silent.
- **D2 (kit, every platform) — recommended:** the kit remembers that the live load has failed (a fatal `onError` it
  accepted, or an accepted `onState('error')`) and answers `api.play()` on a failed load with one non-fatal
  `PLAY_REJECTED` ("The source failed to load; call reload() to retry"), **without** forwarding to the adapter. Works on
  Fire OS/Vega now because their fatal `EXO`/`SHAKA_*` already reach `handleError`; independent of KIT-034.
  The kit already synthesises an error from an adapter outcome (`TEXT_FETCH` from a rejected `selectText`,
  `KitPlayer.tsx:108-120`); 0005 §3 forbids synthesising *state*, not errors.

**Recommendation: A + D2; document B and E as alternatives in `getting-started.md`.** A because retry is the most
common thing a TV app does after a fatal error, the kit's per-source reset/gates are exactly what a retry needs, and
neither consumer should have to reinvent them (`described`'s `retry()` re-implements half of 0005 §2 by hand). D2
because silence is the actual bug the ticket reports, and it costs nothing on top.

**Changeset: `minor`** (new public method on `KitPlayerRef`; an app's own `KitPlayerRef` test double needs a
`reload` member — `described/packages/shared-ui/test/stubs/kit.tsx:10`, same precedent as `setVolume`). **Flag:**
public API change + cross-repo stub → human approval (ORCHESTRATOR §6).

---

## 2. The load key (why A needs a generation, and why 0005 §4's objection no longer holds)

Every per-source gate in KitPlayer closes over `sourceUri` and compares it with `liveUri.current`
(`handleError` `:84`, `handleTracks` `:136`, `handleState` `:177`, `handleTextTrackData` `:196`).
On a same-uri reload **the handlers would not even be re-created** (`useCallback(…, [sourceUri])`), so the failed
load's handlers *are* the new load's: a late report of the dead load — a Fire OS `onLoad` resolving its manifest
await, a web `TEXT_FETCH` from a `selectText` made before the failure, a Vega `SHAKA_*` from the destroyed player —
would pass every gate and be attributed to the retry. And `liveUri` cannot tell the two loads apart.

So the identity of "one load" becomes **`loadKey = `${generation}:${uri}``** where `generation` is a KitPlayer state
bumped only by `reload()`. Gates, reset, adapters' load effects and Fire OS's `<Video key>` key on it.

0005 §4 rejected a numeric generation because "it needs a state and a ref where the uri needs one ref, and the only
case it distinguishes — A→B→A — delivers the same bytes". A same-uri reload is a case the uri **cannot** distinguish
and where the old load's reports are *wrong* (its errors, its `ready`). That is the new fact; decision 0009 records it
(§9). Scope note: `generation` is **not** bumped on a uri change, so the A→B→A known limit (0005 §3, KIT-016
amendment) is unchanged — bumping it there would need render-time bookkeeping; out of scope (Q4).

`headers`/`type` still do not count (0005 §1 stands). `reload()` is the only new way to start a load.

---

## 3. Files

| File | Change |
|---|---|
| `src/player/selection.ts` | + `loadKey(uri, generation)`; `sourceChanged` → `loadChanged(prevKey, nextKey)` (string compare); JSDoc. `acceptsTextTrackData` unchanged in shape — its `requestedFor`/`live` become load keys (rename params, JSDoc) |
| `src/player/types.ts` | `KitPlayerRef.reload(): void` + JSDoc; `AdapterProps.loadKey?: string` + contract text; `onError` JSDoc: `PLAY_REJECTED` also on `play()` after a fatal error |
| `src/player/KitPlayer.tsx` | `generation` state; `load = loadKey(uri, generation)`; `liveUri` → `liveLoad`; every gate and the reset keyed on `load`; `failed` ref (D2); `api.reload`, `api.play` (D2); pass `loadKey={load}` to the adapter |
| `src/player/adapters/web.tsx` | layout reset + load effect deps `[props.source.uri]` → `[loadKey]` (`loadKey = props.loadKey ?? props.source.uri`). No other change |
| `src/player/adapters/fireos.tsx` | `Load.uri` stays; + `Load.key`; layout effect compares `load.current.key` with `loadKey`; `<Video key={loadKey}>` |
| `src/player/adapters/vega.tsx` | layout reset + load effect deps → `[loadKey]` |
| `test/selection.test.ts` | `loadKey` / `loadChanged` |
| `test/kit-player.test.tsx` | new `describe` (§6.1) |
| `test/web-adapter-lows.test.tsx` | new `describe` (§6.2) |
| `test/fireos-adapter.test.tsx`, `test/vega-adapter-tracks.test.tsx` | one `it` each (§6.3) |
| `harness/e2e/player.spec.ts` | specs 46–49 (§6.4); header comment line |
| `harness/e2e/helpers.ts` | none expected: `mediaRespond` is read per request (`helpers.ts:60`), so a spec can `delete gates.mediaRespond.master` before reloading. If that proves false, add `mediaRespondTimes` |
| `docs/getting-started.md` | "Retrying after an error" subsection after the `MEDIA` paragraph (`:56-59`) |
| `docs/decisions/0009-reload.md` | **orchestrator writes it** (record step), not the implementer; amends 0005 §1/§4 |
| `.changeset/kit-035-reload.md` | §7 |

`src/core/**` untouched. `src/player/index.ts` unchanged (`KitPlayerRef` is already exported; `AdapterProps` is not).

---

## 4. Interfaces

```ts
// src/player/selection.ts
/** One load of one source: a source change (new uri) or a `reload()` (same uri, next generation) is a new load. */
export function loadKey(uri: string, generation: number): string // `${generation}:${uri}` — opaque; compare only
/** Whether the load changed. Replaces `sourceChanged`; `headers`/`type` still never count (0005 §1). */
export function loadChanged(prevKey: string, nextKey: string): boolean
export function acceptsTextTrackData(selected: ReadonlySet<string>, trackId: string, requestedFor: string /* load key */, live: string /* load key */): boolean
```

```ts
// src/player/types.ts — KitPlayerRef
  /**
   * Loads the current `source` again from the start, as if it were a new source: the same reset as a `source.uri`
   * change (selected text cleared, `onCue([])` if cues were on screen, `getTracks()` empty, `preferredAudio` /
   * `preferredText` re-applied on the new `onTracks`, position = `startAt ?? 0`), then `loading`, `onTracks`, `ready` /
   * `playing` as for any load. Nothing the previous load reports afterwards (state, tracks, cues, errors) is
   * delivered. Volume and rate are kept. Use it to retry after a fatal `onError`; to resume where the viewer was, set
   * `startAt` in the same update. Callable at any time, not only after an error.
   */
  reload(): void
```

```ts
// src/player/types.ts — AdapterProps
  /**
   * The identity of the current load: changes on a `source.uri` change and on `KitPlayerRef.reload()` (same uri).
   * Key the load and the per-source reset on it instead of `source.uri`; absent (an adapter rendered alone in a test)
   * means `source.uri`. Opaque: compare, never parse. The handlers the kit passes are re-created per `loadKey`.
   */
  loadKey?: string
```

KitPlayer internals (no exports):

```ts
const [generation, setGeneration] = useState(0)
const sourceUri = props.source.uri
const load = loadKey(sourceUri, generation)
const liveLoad = useRef(load)      // replaces liveUri
const failed = useRef(false)       // D2: the live load reported a fatal onError or state 'error'
// gates: `if (load !== liveLoad.current) return` — deps [load] (handleError, handleState),
//        [selectText, load] (handleTracks), [scheduler, load] (handleTextTrackData)
// reset: useLayoutEffect(() => { if (!loadChanged(liveLoad.current, load)) return; liveLoad.current = load; …0005 §2…; failed.current = false }, [load])
// api.reload: () => setGeneration((g) => g + 1)                        — stable; `api` deps unchanged
// api.play:   () => { if (failed.current) { reportDeadPlay(); return } adapterRef.current?.play() }
```

---

## 5. Behaviour rules

**A — reload**

- R1 `reload()` schedules one re-render with `generation + 1`. Two `reload()` calls in one task → one new load
  (batched; the later generation wins). No synchronous reports from inside `reload()`.
- R2 The reset in KitPlayer's layout effect runs **unchanged** (0005 §2 order, KIT-020 `tracksPublished`/`tracksRef`
  before `scheduler.update`, `readyClosed = false`) plus `failed = false`. Keyed on `load`, so a uri change and a
  reload share one code path; a commit that changes both (uri + reload in one batch) resets once.
- R3 Every per-source gate compares the handler's `load` with `liveLoad.current`. After a reload, every report
  delivered through a handler of the previous load — state, tracks, VTT, errors — is dropped, exactly as for a source
  change. `onPosition` stays ungated (KIT-025 §1; nothing changes).
- R4 Adapters reload on `loadKey`: web's and Vega's load effect and layout reset deps become `[loadKey]`; Fire OS
  starts a new `Load` record and remounts `<Video key={loadKey}>` (one ExoPlayer per load, as per uri today). Adapter
  state that survives a uri change survives a reload identically: web element volume/rate (same `<video>`), Fire OS
  `paused`/`rate`/`volume` state, Vega nothing new. **Autoplay on reload = autoplay on a source change** for that
  adapter (web: `props.autoplay`; Fire OS: its current `paused` state; Vega: `props.autoplay`).
- R5 Web: assigning `v.src` the same string runs the media element load algorithm (HTML: "If a src attribute of a
  media element is set or changed, the user agent must invoke the media element's media element load algorithm",
  https://html.spec.whatwg.org/multipage/media.html#attr-media-src). Keep `v.src = uri`; do **not** add `v.load()`
  (it would run the algorithm twice). The harness proves the refetch (spec 46). Fallback if it does not: R-2.
- R6 Position after reload = `startAt ?? 0` (0005 §2.5). The kit does not resume by itself; the app sets `startAt`
  in the same update as `reload()` (documented; Fire OS ignores `startAt` today — `described` seeks on `ready`).
- R7 `reload()` on a healthy load is allowed and behaves the same (restart). No `onError`, no special state.
- R8 `reload()` before the adapter has mounted / after unmount: a state update on an unmounted component is a no-op
  in React 18+; nothing to guard.

**D2 — `play()` on a failed load**

- R9 `failed` is set when `handleError` **accepts** an error with `fatal: true`, or `handleState` accepts `'error'`.
  Reset by the load reset (R2). A rejected/stale report never sets it (it is set after the gate).
- R10 `api.play()` while `failed`: report once per call, through the live `handleErrorRef.current`,
  `{ code: 'PLAY_REJECTED', fatal: false, message: 'The source failed to load; call reload() to retry' }` (no
  `cause`), wrapped in `try {} catch {}` like the `selectText` safety net; **do not** call the adapter's `play`
  (Fire OS would flip `paused` to false and the reload would then autoplay unasked).
- R11 `api.play()` while not `failed`: unchanged. The web adapter's `playRejection` is unchanged (`NotSupportedError`
  still swallowed: on the autoplay path it is paired with `MEDIA`; on `ref.play()` the kit no longer forwards after a
  failure, so the silent case cannot arise from `api.play`).
- R12 `pause`/`seek`/`setRate`/`setVolume`/`selectAudio`/`selectText` on a failed load: unchanged (no report).

---

## 6. Tests

### 6.1 `test/kit-player.test.tsx` — `describe('KitPlayer reload(): a same-uri load is a new load (KIT-035)')` (platform double)

- `it('reload() runs the source-change reset on the same uri: selected text cleared, onCue([]) once, getTracks() and renderControls tracks empty, position = startAt')`
- `it('reload() re-applies preferredAudio and preferredText on the new load\'s first onTracks')`
- `it('reload() reports nothing synchronously and re-creates the handlers handed to the adapter, and passes a new loadKey')`
- `it('a state reported through the previous load\'s onState after reload() is dropped')`
- `it('onTracks reported through the previous load\'s handler after reload() is dropped and does not latch the preferences')`
- `it('VTT delivered through the previous load\'s onTextTrackData after reload() is refused, even for the same selected id')`
- `it('an error reported through the previous load\'s onError after reload() is dropped')`
- `it('after a failed load reported error, reload() lets the new load report ready (readyClosed reset)')`
- `it('two reload() calls in one act produce one reset and one new loadKey')`
- `it('reload() keeps the api identity handed to renderControls')`
- `it('a re-render with the same uri and no reload() changes neither loadKey nor handlers (0005 §1 unchanged)')`
- `it('a headers-only change still does not reset')` (exists in some form — keep or extend)
- `describe('KitPlayer play() on a failed load (KIT-035 D2)')`:
  - `it('after a fatal onError, play() reports one non-fatal PLAY_REJECTED through the latest onError and does not call the adapter')`
  - `it('after onState(\'error\') alone, play() reports PLAY_REJECTED')`
  - `it('a non-fatal error (TEXT_FETCH, HLS_MASTER, PLAY_REJECTED) does not mark the load failed: play() reaches the adapter')`
  - `it('a stale fatal error from a superseded load does not mark the live load failed')`
  - `it('after reload() (or a source change), play() reaches the adapter again')`
  - `it('an app onError that throws on the dead-play report does not throw out of play()')`

### 6.2 `test/web-adapter-lows.test.tsx` — `describe('WebAdapter reload (KIT-035, real KitPlayer + WebAdapter)')`

- `it('reload() after an element error re-assigns src and reports loading, then onTracks and ready for the new load')`
- `it('a manifest of the failed load that resolves after reload() publishes nothing (cancelled by the load effect cleanup)')`
- `it('an element error listener of the failed load is removed on reload(): a stale error event reports nothing')`
- `it('reload() keeps element volume and playbackRate')`

### 6.3 Adapters alone

- `test/fireos-adapter.test.tsx`: `it('a new loadKey with the same uri starts a new load record: an onLoad of the previous record that resolves after it publishes nothing')`
- `test/vega-adapter-tracks.test.tsx`: `it('a new loadKey with the same uri destroys the previous player and clears getTracks()')`
- `test/selection.test.ts`: `it('loadKey differs by generation for the same uri and by uri for the same generation')`, `it('loadChanged compares keys only')`

### 6.4 Harness (`harness/e2e/player.spec.ts`, specs 46–49; header: "Specs 46–49 (KIT-035): `reload()` retries a failed source on the same uri; `play()` on a failed load is reported")

- 46 `test('a 404 media load, then the media is fixed and ref.reload(): the element refetches the same uri and reports loading, tracks and ready; one MEDIA in total (KIT-035)')` — assert the media request count for `master` is 2.
- 47 `test('ref.play() after a fatal MEDIA reports one non-fatal PLAY_REJECTED and no unhandled rejection (KIT-035)')`
- 48 `test('reload() while A\'s manifest is held: the held manifest released afterwards publishes nothing; the new load publishes once (KIT-035)')`
- 49 `test('reload() with subtitles selected clears the cue and re-applies preferredText on the new load (KIT-035)')`

### 6.5 Mutation table (each mutation must redden at least the listed tests)

| # | Mutation | Reddens |
|---|---|---|
| M1 | `reload` is a no-op | 6.1 reset, 6.2 #1, spec 46 |
| M2 | gates keep `sourceUri` (handlers deps `[sourceUri]`), reset keyed on `load` | 6.1 stale state/tracks/VTT/error (4 `it`s) |
| M3 | reset keyed on `sourceUri` only, gates on `load` | 6.1 reset `it`, spec 49 |
| M4 | web load effect deps stay `[props.source.uri]` | 6.2 #1, spec 46 |
| M5 | Fire OS `key={props.source.uri}` (no remount on reload) | 6.3 Fire OS |
| M6 | Fire OS layout effect compares `uri`, not `key` | 6.3 Fire OS |
| M7 | Vega deps stay `[props.source.uri]` | 6.3 Vega |
| M8 | `failed` not reset on load change | 6.1 D2 "after reload() play() reaches the adapter" |
| M9 | `failed` set before the gate | 6.1 D2 "stale fatal error" |
| M10 | `failed` set on any error (not only fatal) | 6.1 D2 "non-fatal error" |
| M11 | dead-play report forwards to the adapter too | 6.1 D2 first `it` |
| M12 | `readyClosed` not reset on reload | 6.1 "reload() lets the new load report ready", spec 46 |
| M13 | `generation` bumped on uri change too, reset compares `uri` | 6.1 "same uri and no reload()" stays green — acceptable; check A→B→A is not claimed fixed |
| M14 | `api` memo gains `generation` dep | 6.1 "keeps the api identity" |
| M15 | web adds `v.load()` after `v.src` | spec 46 (request count 3 or an AbortError in `unhandled`) — if it does not redden, drop this row |

---

## 7. Changeset — `.changeset/kit-035-reload.md`

```md
---
'@moizp/vega-media-kit': minor
---

**`KitPlayerRef.reload()`: retry a source on the same uri.** After a fatal error (`MEDIA`, `EXO`, `SHAKA_*`), call
`ref.current?.reload()` to load the current `source` again. It behaves like switching to a new source: selected text
is cleared, `getTracks()` is empty until the new `onTracks`, `preferredAudio`/`preferredText` are re-applied, the
position starts at `startAt` (set `startAt` in the same update to resume), and nothing the failed load reports
afterwards reaches your callbacks. Volume and rate are kept. Previously the only way to retry the same uri was to
remount `KitPlayer` with a new `key` or append a cache-buster to the uri; both still work.

**`play()` on a failed load is reported.** `ref.play()` after a fatal error used to do nothing and report nothing. It
now reports a non-fatal `PLAY_REJECTED` ("The source failed to load; call reload() to retry") and leaves the player
as it is. Code that implements `KitPlayerRef` itself (test doubles) needs a `reload` member.
```

---

## 8. Dependency on KIT-034 (planned in parallel)

- **Logical:** none blocking. A works on every adapter without KIT-034. D2 keys on *fatal `onError` or* `error`
  state, so it works on Fire OS/Vega today via `EXO`/`SHAKA_*`.
- **Textual (merge conflicts):** both touch `fireos.tsx` (`onError` at `:152`, `key` at `:135`, and this plan's `key`/layout effect),
  `vega.tsx` (error listener `:39` vs this plan's deps), and possibly `KitPlayer.tsx` `handleState`/`handleError`
  if KIT-034 goes kit-side. **Land KIT-034 first, rebase KIT-035 on it.** If KIT-034 makes the *kit* emit `error`
  after a fatal `onError` (instead of the adapters), D2's `failed` reduces to "accepted `'error'` state" — the
  reviewer should collapse R9 accordingly.
- **Harness:** Fire OS/Vega retry has no device spec here; KIT-034's device steps should add "fatal error → reload()
  → loading → playing" to the Fire OS checklist (Q5).

## 9. Decision record (orchestrator, after Q1)

`docs/decisions/0009-reload.md`: a load is identified by `(uri, generation)`; `reload()` is the only thing that
bumps the generation; amends 0005 §1 ("a source change is a change of `uri`" → "a new load is a change of `uri` or a
`reload()`") and §4 (the generation rejected there is adopted for the same-uri case; A→B→A limit unchanged). D2: the
kit reports `PLAY_REJECTED` for `play()` on a failed load and does not forward it.

## 10. Risks

- **R-1 Fire OS `paused` across reload.** Fire OS keeps `paused` across loads (as across uri changes). If the viewer
  had pressed play before the failure, the reload autoplays even with `autoplay={false}`. Same as a source change
  today; documented, not fixed.
- **R-2 Same-string `src` assignment.** Spec-mandated to reload; if Chromium skips it, use
  `v.removeAttribute('src'); v.load(); v.src = uri` only on a same-uri load (the effect knows: previous key's uri
  equals this one). Spec 46 decides.
- **R-3 HTTP caching of the failure.** A CDN that caches the 404 (with `Cache-Control`) serves it again on reload.
  That is what B (cache-buster) is for — the docs say so.
- **R-4 Gate churn.** Every gate's dependency changes from `sourceUri` to `load`. Mechanical, but it is the whole
  origin-gate machinery (KIT-016/020/022/025); the 0005-era tests must stay green unchanged (they exercise uri changes,
  which still change `load`).
- **R-5 0005 §4 reversal** needs the human's nod (it is a recorded decision).
- **R-6 Cross-repo:** `described`'s stub (`test/stubs/kit.tsx:10`) fails typecheck on the next kit bump until it adds
  `reload: vi.fn()`. App ticket, not kit work.

## 11. Open questions

| # | Question | Blocking? | Default if unanswered |
|---|---|---|---|
| Q1 | Which API: **A + D2** (recommended), B/E docs only, or D2 alone? | **Yes** — public API | — |
| Q2 | Approve amending 0005 §1/§4 (load = uri + generation)? Only if A | **Yes, with A** | — |
| Q3 | `reload({ startAt })` overload to resume without a prop update? | No | No: `startAt` prop in the same update (one way to set a start) |
| Q4 | Also bump the generation on every uri change to close the A→B→A limit? | No | No; separate ticket if wanted |
| Q5 | Fire OS device step for reload (with KIT-034's device run)? | No | Yes, add to KIT-034's device checklist |
| Q6 | App follow-ups: `described` switch `key={attempt}` → `reload()` (keeps volume, clears cues); `lingo` handle `onError` at all | No | Open app tickets; not kit work |
