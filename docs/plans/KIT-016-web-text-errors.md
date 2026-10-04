# KIT-016 — Web `selectText` failures reach `onError`

**Role chain:** Planner (opus, standing in for fable; this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3, §4. **Decisions:** 0004 (master parsing), 0005 §3–§4 (source-change reset,
origin gate), 0007, 0008 (state gate). **Status:** ready for an implementer. Nothing in §9 blocks.

Goal in one sentence: when the web adapter cannot load a selected text track — HTTP non-2xx, a 200 body that is
neither WebVTT nor an HLS media playlist, or a network rejection — the app's `onError` receives one non-fatal
`TEXT_FETCH` per failed track, no per-line fetch storm happens first, and a failure that belongs to a source the app
has switched away from is never reported.

Ticket text (`TASKS.md`): "Web `selectText` failures unobservable: `fetchHlsVtt` never checks `res.ok`, non-VTT body
triggers per-line fetches, rejected promise discarded at `KitPlayer.tsx:38` → route through `onError`".

---

## 0. Verdict at a glance

1. **All three defects are confirmed on HEAD (`aeffe7f`); the line numbers have drifted.**
   - `src/player/hls.ts:84-92` `fetchHlsVtt`: no `res.ok` check on the playlist or on any segment. A 404 body
     (`Not Found`) or an HTML error page is not `WEBVTT`, so it falls through to the segment path: **every non-`#`
     line becomes a fetch** (`base + line`), in parallel, and the joined junk is resolved as if it were VTT.
   - `src/player/adapters/web.tsx:72-79` `selectText`: `async`, no `try`; one throwing track aborts the loop, so
     **later ids in the same `selectText([...])` are never fetched** (multi-track selection silently broken by one
     bad track).
   - `src/player/KitPlayer.tsx:61` (was `:38`): `adapterRef.current?.selectText(ids)` discards the returned promise
     → unhandled rejection, nothing reaches the app.
2. **No new error code and no public type change.** The Fire OS adapter already reports exactly this failure as
   `{ code: 'TEXT_FETCH', message: 'Could not load text track <id>', fatal: false, cause }`
   (`fireos.tsx:77`; also in `docs/spike-runbook.md`). `PlayerError.code` is `string`. The web adapter adopts the
   same payload. Docs gain the list of codes; types do not change.
3. **`onError` is currently not origin-gated at all.** `KitPlayer` spreads `{...props}` into the adapter, so the
   adapter receives the app's raw `onError`. Unlike `onTracks` / `onState` / `onTextTrackData`, nothing stops a
   superseded source's error. This plan adds `handleError` to `KitPlayer`, the same per-`source.uri` gate as
   `handleTracks` / `handleState` (decision 0005 §4, 0008), delivering to the app through a latest-props ref
   (KIT-012 pattern) so an inline `onError` is never stale.
4. **`fetchHlsVtt` classifies the body before fetching anything else**, using two new pure functions in
   `src/core/hls.ts`. Unknown body ⇒ throw, zero further requests. That is the fetch-storm fix.
5. **Behaviour change on Fire OS too**, because it shares `fetchHlsVtt`: a 404/HTML subtitle playlist now produces
   `TEXT_FETCH` there instead of resolving junk. Fire OS already catches per track, so no Fire OS code changes.

---

## 1. Scope boundaries

In scope: `fetchHlsVtt` validation, the web adapter's `selectText` error routing, `KitPlayer`'s `onError` gate and
`selectText` safety net, harness wiring for `onError`, docs, changeset.

Out of scope (do not touch):

- **KIT-025** — the element `error` listener (`web.tsx:85`), `void v.play()` AbortError noise, `play` vs `playing`,
  stale `onState`/`onPosition` listener callbacks. *Boundary:* KIT-025's new `error` listener should call the
  `props.onError` its load effect captured (per-load, like `onTracks`); this plan's `handleError` gate will then
  drop a superseded load's media error for free. This plan documents `onError` in the `AdapterProps` origin
  contract so KIT-025 inherits the rule; it does not add the listener.
- **KIT-020** — web/vega `tracks` ref surviving a switch.
- **KIT-002 §9 Q5** — segment URL resolution (`base + line` vs `resolveUrl`). The new code keeps today's
  resolution exactly (absolute `https?:` kept, otherwise playlist directory + line); the pinned tests that say
  "Do not fix them here" keep their URL assertions. Q5 stays its own follow-up.
- Concurrency limits / caps on legitimate segment counts (see §9 Q3).
- Vega `selectText` (selects inside Shaka, does not fetch).

---

## 2. Files to touch

| File | Change |
|---|---|
| `src/core/hls.ts` | + `subtitleBodyKind`, + `mediaPlaylistUris` (pure, no RN, no I/O) |
| `src/player/hls.ts` | `fetchHlsVtt`: optional `opts` (injectable fetch), `res.ok` checks, classify-before-fetch, segment validation |
| `src/player/adapters/web.tsx` | `selectText`: per-track `try/catch` → `onError(TEXT_FETCH)` via the `props.onError` of the render the call was made from |
| `src/player/KitPlayer.tsx` | + `handleError` (origin gate + latest-props ref), pass `onError={handleError}` to the adapter; `selectText` safety net for a rejected adapter promise |
| `src/player/types.ts` | Doc comments only: `onError` (codes, non-fatal text failures, superseded sources not reported), `AdapterProps` origin contract adds `onError` |
| `harness/player.tsx` | `Ev` gains `{ type: 'error'; code; message; fatal }`; `onError` logs it |
| `harness/e2e/helpers.ts` | `routeStream` gains a `respond` override (status/body, or `'abort'`) per relative path |
| `harness/e2e/player.spec.ts` | Specs 30–33 (§6.2); header comment lists them |
| `test/hls.test.ts` | Pure tests for the two core functions (imports only `../src/core`) |
| `test/hls-load.test.ts` | New `fetchHlsVtt` failure tests; existing pinned stubs gain `ok: true, status: 200, url` (contract change, §5.6) |
| `test/kit-player.test.tsx` | New `describe` for the `onError` gate and the safety net (platform double) |
| `test/web-adapter.test.tsx` (new) | Fast jsdom mirror of the real `WebAdapter`'s per-track routing (§6.1.4). The harness is guard of record |
| `docs/getting-started.md` | One paragraph next to the `HLS_MASTER` one: `TEXT_FETCH` |
| `.changeset/kit-016-text-fetch-errors.md` | New (§8) |

No file in `src/core` may import React / React Native (unchanged rule; the new functions are string → value).

---

## 3. Typed interfaces

### 3.1 `src/core/hls.ts` (new, exported through `src/core/index.ts` → public, additive)

```ts
/**
 * What a subtitle URL answered with, judged by its first non-blank line (BOM stripped, CRLF tolerated):
 * - 'webvtt'          — first line starts with `WEBVTT` followed by end-of-line, space or tab (W3C WebVTT §4.1)
 * - 'media-playlist'  — first line is `#EXTM3U` and `isMasterPlaylist` is false
 * - 'master-playlist' — first line is `#EXTM3U` and `isMasterPlaylist` is true
 * - 'unknown'         — anything else: empty, HTML error page, JSON, plain text
 */
export type SubtitleBodyKind = 'webvtt' | 'media-playlist' | 'master-playlist' | 'unknown'
export function subtitleBodyKind(text: string): SubtitleBodyKind

/**
 * Segment URI lines of a media playlist, in order, exactly as written (trimmed; not resolved): every non-blank
 * line that does not start with '#'. Uses `playlistLines` (BOM, CRLF). [] when there are none.
 * Resolution stays in src/player/hls.ts (KIT-002 §9 Q5 is a separate ticket).
 */
export function mediaPlaylistUris(text: string): string[]
```

Note the WebVTT rule is stricter than today's `/^WEBVTT/m` (any line) `&& !includes('#EXTM3U')`: an HTML page with a
line beginning `WEBVTT` is no longer accepted as VTT.

### 3.2 `src/player/hls.ts`

```ts
/** Options for fetchHlsVtt. Only `fetch` — subtitle requests stay header-less (no CORS preflight; unchanged). */
export type HlsVttOptions = Pick<HlsLoadOptions, 'fetch'>

/**
 * Resolve an HLS subtitle media playlist (or a bare .vtt) to one WebVTT body.
 * Rejects — and makes no further request — when:
 *   the URL answers non-2xx                       → Error message contains the status and the url
 *   the body is 'unknown' or 'master-playlist'    → Error message contains 'not WebVTT' and the url
 *   a media playlist lists no segments            → Error message contains 'no segments' and the url
 * Rejects after segment requests when any segment answers non-2xx or its body is not 'webvtt' (message names the
 * segment url). Network rejections propagate unchanged.
 */
export async function fetchHlsVtt(url: string, opts?: HlsVttOptions): Promise<string>
```

Signature change is additive (optional second parameter). `fetchHlsVtt` is public (`src/player/index.ts:3`).
Errors are plain `Error` (same style as `fetchHlsMaster`); no new error class is exported.

### 3.3 `src/player/KitPlayer.tsx` (internal)

```ts
const onErrorRef = useRef(props.onError); onErrorRef.current = props.onError
/** Origin gate on onError: re-created per source.uri; a report through a handler for a non-live source is dropped. */
const handleError = useCallback((e: PlayerError) => {
  if (sourceUri !== liveUri.current) return
  onErrorRef.current?.(e)
}, [sourceUri])
const handleErrorRef = useRef(handleError); handleErrorRef.current = handleError
```

`<Adapter … onError={handleError} />` — after the `{...props}` spread, like the other handlers.

### 3.4 Public types — **unchanged**

`PlayerError` (`src/core/types.ts:44`) and `KitPlayerProps.onError` keep their shapes. Only doc comments change.
No new code: web uses the existing `'TEXT_FETCH'`.

---

## 4. Behaviour rules

**R1 — HTTP.** `fetchHlsVtt` checks `res.ok` on the playlist request and on every segment request. Non-2xx ⇒ reject
with `status` and url in the message. The body of a non-2xx response is never parsed.

**R2 — Classify before fan-out (no storm).** The playlist body is classified with `subtitleBodyKind` before any
segment request:
- `webvtt` ⇒ return the body unchanged (today's behaviour; pinned).
- `media-playlist` ⇒ `mediaPlaylistUris`; `[]` ⇒ reject (`no segments`); else resolve each as today
  (`/^https?:/` kept, else `url.slice(0, url.lastIndexOf('/') + 1) + line`) and fetch in parallel.
- `master-playlist` / `unknown` ⇒ reject. **Exactly one request was made for that track.**

**R3 — Segments must be WebVTT.** Every segment body must classify as `webvtt` (RFC 8216 §3.5 requires WebVTT
segments; all repo fixtures comply). Otherwise reject naming the segment. Then `joinVttSegments` as today.
`Promise.all` fail-fast is acceptable: in-flight sibling segment requests are not aborted (`HlsFetch` has no
signal) but their results are discarded; nothing new is started.

**R4 — Per-track routing in the web adapter.** `selectText(ids)` keeps its sequential `for` over ids (order and
timing unchanged). Each track is wrapped in its own `try/catch`; on failure it calls
`props.onError?.({ code: 'TEXT_FETCH', message: \`Could not load text track ${id}\`, fatal: false, cause: e })`
and **continues with the next id**. A failure on one track never prevents delivery of another (multi-track
selection is a feature). Ids with no track or no `url` are skipped silently (unchanged). The web adapter's
`selectText` therefore never rejects.

**R5 — Which `onError`.** The adapter calls the `props.onError` of the render whose `useImperativeHandle` produced
the `selectText` being called — i.e. captured at `selectText` time, exactly like `onTextTrackData` (0005 §4). It
must not read it through a latest-props ref. Since `KitPlayer` passes `handleError`, that is the handler created
for the source live when `selectText` was called.

**R6 — Origin gate in the kit.** `handleError` drops any report delivered through a handler whose `sourceUri` is not
`liveUri.current`. Consequences: a superseded source's `TEXT_FETCH` (web and Fire OS), superseded `SHAKA_*` (Vega
load closure) and any future KIT-025 media error from a superseded load are not reported. Errors for the live
source — including Fire OS `EXO` (inline arrow, current props) and web/Fire OS `HLS_MASTER` (already cancel-gated) —
are unchanged. `handleError` delivers to the **latest** app `onError` (ref), so an inline `onError={(e) => …}` is
never stale and its identity never re-creates the handler.

**R7 — Safety net for adapters that reject.** In `KitPlayer.selectText`, capture `const report = handleErrorRef.current`
*at call time*, call `adapterRef.current?.selectText(ids)` synchronously as today (no change in timing), and if
the return value is a thenable attach `.then(undefined, (e) => report({ code: 'TEXT_FETCH', message: 'Could not load
text tracks', fatal: false, cause: e }))`. Because `report` is the handler of the source live at call time, a
rejection that settles after a switch is dropped by R6. Synchronous throws keep propagating to the caller
(unchanged). With R4 in place the web and Fire OS adapters never reach this path; it exists so a rejection can
never be unhandled again.

**R8 — Not gated on selection.** A failure for a track the app deselected (same source) before the failure
settled is still reported. The kit gates errors by source only (§9 Q2).

**R9 — State is untouched.** `TEXT_FETCH` is non-fatal; the kit does not move `PlayerState` to `'error'` and does
not synthesise any state (0005 §3). Playback, other tracks' cues and `onTracks` are unaffected.

**R10 — One error per failed track per `selectText` call.** No de-duplication across calls: selecting a broken track
twice reports twice (each is an app action).

---

## 5. Implementation notes (ordered; tests first — §6 lists them)

1. Write §6.1.1–§6.1.3 and the harness specs §6.2 against HEAD; confirm red (§7 table says which).
2. `src/core/hls.ts`: the two functions, reusing the private `playlistLines` and `isMasterPlaylist`.
3. `src/player/hls.ts`: rewrite `fetchHlsVtt` per R1–R3; `const doFetch = opts?.fetch ?? (globalThis.fetch as unknown as HlsFetch)`.
   Read `globalThis.fetch` at call time (not module load) so `vi.stubGlobal` keeps working.
4. `web.tsx` `selectText` per R4/R5.
5. `KitPlayer.tsx` per §3.3, R6, R7. Add a doc comment next to `handleError` in the style of `handleTracks`.
6. **Existing pins in `test/hls-load.test.ts` §"fetchHlsVtt (moved, behaviour pinned)":** their stubs return
   `{ text }` only; under R1 they would reject. Add `ok: true, status: 200, url` to each stub and add one sentence
   to that block's comment: "KIT-016 added the `ok` check; the URL-resolution pins (§9 Q5) are unchanged." Do not
   change any URL or output assertion.
7. `types.ts` docs: on `onError`, list `HLS_MASTER` (non-fatal), `TEXT_FETCH` (non-fatal, one per failed track),
   `EXO` (Fire OS, fatal), `SHAKA_<n>` (Vega, fatal); "errors of a source the app has switched away from are not
   reported". In the `AdapterProps` origin-contract paragraph, add `onError` to the handlers that must be held per
   load / per `selectText` call.
8. `docs/getting-started.md`: after the `HLS_MASTER` paragraph — "If a selected text track cannot be loaded (HTTP
   error, a body that is neither WebVTT nor an HLS playlist, network failure), the kit reports a non-fatal
   `TEXT_FETCH` through `onError` for that track; other selected tracks still load."
9. Harness: `Ev` union + `onError` logger; `routeStream(page, { respond: { 'subs/en/index.m3u8': { status: 404, body:
   'Not Found' } } })` and `'abort'` → `route.abort('failed')`. Apply `respond` **after** the `hold` gate so a spec
   can hold a request and then fail it. `respond` is keyed by the same relative path as `hold`.

---

## 6. Acceptance tests

### 6.1 Vitest (`pnpm test`)

**6.1.1 `test/hls.test.ts` — `describe('subtitleBodyKind / mediaPlaylistUris (KIT-016)')`**
- `it('classifies a WebVTT body as webvtt, tolerating a BOM, CRLF and leading blank lines')`
- `it('classifies "WEBVTT - title" and a bare "WEBVTT" as webvtt but "WEBVTTX" as unknown')`
- `it('classifies an HTML error page that contains a WEBVTT line further down as unknown')`
- `it('classifies an empty body, JSON and plain "Not Found" as unknown')`
- `it('classifies a media playlist (#EXTM3U + #EXTINF) as media-playlist')`
- `it('classifies a master playlist as master-playlist')`
- `it('lists segment URIs in order, skipping tags, comments and blank lines, with CRLF stripped')`
- `it('lists no URIs for a playlist without segment lines')`
- `it('the shaka-packager fixture playlist yields its 15 segment URIs, each fixture segment classifies as webvtt')`

**6.1.2 `test/hls-load.test.ts` — `describe('fetchHlsVtt failures (KIT-016)')`** (stub records every URL requested)
- `it('rejects with the status and url on a non-2xx playlist and requests nothing else')`
- `it('rejects a 200 HTML error page as not WebVTT and requests no segments (no per-line fetch storm)')`
- `it('rejects a master playlist instead of fetching its variants')`
- `it('rejects a media playlist with no segments')`
- `it('rejects when a segment answers non-2xx, naming the segment url')`
- `it('rejects when a segment body is not WebVTT')`
- `it('propagates a network rejection of the playlist request')`
- `it('uses the injected fetch when given, and globalThis.fetch otherwise')`
- (existing pins stay green with `ok: true` added — §5.6)

**6.1.3 `test/kit-player.test.tsx` — `describe('KitPlayer onError origin gate and selectText safety net (KIT-016)')`**
(extend the platform double: `selectText` may return a promise the test controls, and it may call the `onError`
it was handed at call time)
- `it("forwards an adapter error for the live source to onError")`
- `it("drops an error reported through a handler created for a source that is no longer live")`
- `it("routes a rejected adapter selectText promise to onError as one non-fatal TEXT_FETCH")`
- `it("drops a selectText rejection that settles after the source changed")`
- `it("delivers to the latest onError prop: an inline onError passed on a later render receives the error")`
- `it("does not report an error twice when the adapter both reports TEXT_FETCH and resolves")`

**6.1.4 `test/web-adapter.test.tsx` (new, `// @vitest-environment jsdom`)** — the real `WebAdapter`, `fetch`
stubbed, `loadedmetadata` dispatched by hand on the rendered `<video>` to complete the join. A fast mirror only.
- `it('selectText(["0","1"]) with track 0 answering 404 calls onError once with TEXT_FETCH for 0 and still delivers track 1 through onTextTrackData')`
- `it('a 200 HTML body for a subtitle playlist reports TEXT_FETCH after exactly one request for that track')`
- `it('selectText never rejects, whatever the fetch does')`

If jsdom's `HTMLMediaElement` makes this file impractical (it logs "not implemented" for `load`/`play`; that is
acceptable noise), the implementer may drop it and say so; the harness specs below remain mandatory.

### 6.2 Playwright harness (`pnpm harness`) — guard of record for `KitPlayer` + real `WebAdapter` wiring

- **Spec 30** `test('a subtitle playlist answering 404 reaches onError as one non-fatal TEXT_FETCH and nothing else is fetched for that track (KIT-016)')`
  — `respond: { 'subs/en/index.m3u8': { status: 404, body: 'Not Found' } }`, `preferred={"languages":["en"]}`.
  Poll error events → exactly `[{ type: 'error', code: 'TEXT_FETCH', fatal: false, … }]`; `hits` under `subs/en/`
  equal `['fetch subs/en/index.m3u8']`; `state:ready` was reported and no `state:error`.
- **Spec 31** `test('a 200 HTML error page for a subtitle playlist reaches onError and triggers no per-line fetches (KIT-016)')`
  — body `'<!doctype html>\n<html>\n<body>CDN error</body>\n</html>\n'`, status 200, content-type `text/html`.
  Same assertions as 30.
- **Spec 32** `test('one failing track does not block the other: selectText(["0","1"]) with de failing delivers en cues and reports one TEXT_FETCH (KIT-016)')`
  — `respond: { 'subs/de/index.m3u8': 'abort' }` (network rejection), `preferred={}`; `selectText(['0','1'])`;
  `cueIds(page, 2)` polls to `['1:c1']`; exactly one error event. Multi-track selection is exercised, not disabled.
- **Spec 33** `test("a subtitle fetch that fails after a source switch does not reach onError for the new source; the new source's own failure does (KIT-016 × 0005 §4)")`
  — modelled on the existing "VTT fetched for the previous source is dropped…" spec: `hold` **and** `respond
  { status: 500 }` on `subs/de/seg-1.vtt`, `preferred={"languages":["de"]}`; switch to `/stream/master-b`; B's `de`
  cue lands ('Zweite Quelle'); release A's held segment; wait for its response to finish + 500 ms; assert **zero**
  error events and B's cue unchanged. Positive control in the same page: `respond` also sets
  `'subs-b/en/index.m3u8': { status: 404 }`; `selectText(['0','1'])` on B ⇒ exactly one `TEXT_FETCH`. Without the
  control the spec would pass vacuously on HEAD.

Update the spec-file header comment: "Specs 30–33 (KIT-016): text-load failures reach `onError` as `TEXT_FETCH`
without a fetch storm; a superseded source's failure does not."

---

## 7. Red-before-green and mutations for the reviewer

**On HEAD** (tests + harness wiring written, `src/` untouched): red ⇒ every §6.1.2 test except "propagates a network
rejection" (HEAD's `fetchHlsVtt` already propagates it; the web adapter then discards it — spec 32 covers that);
§6.1.1 (functions do not exist); §6.1.3 gate/safety-net tests; §6.1.4; harness 30, 31, 32 and the positive control
of 33.

Mutations — each must turn at least the named tests red; restore after each:

| # | Mutation | Must go red |
|---|---|---|
| M1 | `fetchHlsVtt`: delete the playlist `if (!res.ok) throw` | 6.1.2 non-2xx; spec 30 (`Not Found` becomes a segment fetch) |
| M2 | `fetchHlsVtt`: revert to `/^WEBVTT/m.test(body) && !body.includes('#EXTM3U')` then fall through to segments for anything else | 6.1.2 HTML page / master / no-segments; spec 31 (stray `subs/en/<…>` hits) |
| M3 | `fetchHlsVtt`: drop the per-segment `ok` / `webvtt` check | 6.1.2 segment non-2xx / segment not WebVTT |
| M4 | `web.tsx`: remove the per-track `try/catch` (let it throw) | spec 32 (en never fetched); 6.1.4 first test |
| M5 | `web.tsx`: catch but `return` instead of continuing | spec 32; 6.1.4 first test |
| M6 | `KitPlayer`: delete `if (sourceUri !== liveUri.current) return` in `handleError` | 6.1.3 stale-handler + stale-rejection tests; spec 33 |
| M7 | `KitPlayer`: pass `onError={props.onError}` (or drop the prop so the spread wins) | 6.1.3 stale-handler test; spec 33 |
| M8 | `KitPlayer`: `handleError` calls a closed-over `props.onError` with deps `[sourceUri]` | 6.1.3 latest-onError test |
| M9 | `KitPlayer.selectText`: remove the `.then(undefined, report)` safety net | 6.1.3 rejected-promise test (also an unhandled rejection) |
| M10 | `KitPlayer.selectText`: read `handleErrorRef.current` inside the rejection callback instead of at call time | 6.1.3 "drops a selectText rejection that settles after the source changed" |
| M11 | `subtitleBodyKind`: accept any line starting `WEBVTT` | 6.1.1 HTML-with-WEBVTT-line test |

Also run: `pnpm typecheck && pnpm test && pnpm typecheck:harness && pnpm harness`, and confirm all existing harness
specs (10–29) and `test/fireos-adapter.test.tsx` stay green untouched.

---

## 8. Changeset (required — user-facing)

`.changeset/kit-016-text-fetch-errors.md`, bump **minor** (pre-1.0; a public function now rejects where it used to
resolve junk — same reasoning as KIT-014's changeset). Content must say:
- Web: a text track that cannot be loaded now reports a non-fatal `TEXT_FETCH` through `onError` (Fire OS already
  did); other selected tracks still load.
- `fetchHlsVtt` rejects on non-2xx, on a body that is neither WebVTT nor an HLS media playlist, on a playlist with no
  segments, and on a non-WebVTT segment — instead of fetching every line of an error page as a segment. It gains an
  optional `{ fetch }` option. Affects Fire OS too: a broken subtitle URL is now an error, not empty captions.
- `onError` is no longer called for a source the app has switched away from (all platforms, all codes), and always
  reaches the latest `onError` prop.
- New pure exports from core: `subtitleBodyKind`, `mediaPlaylistUris`, type `SubtitleBodyKind`.
- No type changes; `PlayerError` is unchanged.

Commit: `fix(player): web text-load failures reach onError; onError is origin-gated (KIT-016)`.

---

## 9. Risks and open questions

**Risks**
- *Over-strict classification* could reject a real CDN that serves VTT with leading garbage or segments without a
  `WEBVTT` header. Mitigation: BOM/CRLF/leading blank lines tolerated; RFC 8216 §3.5 and W3C WebVTT require the
  header; all 28 fixture segments comply. The error is non-fatal and observable — the point of the ticket.
- *Fire OS behaviour changes* through the shared `fetchHlsVtt`. Re-run the device-matrix "captions" row when next on
  the stick; no code change there.
- *Origin gate on all codes* drops a superseded Vega `SHAKA_*` fatal error. Intended (0008 symmetry), called out in
  the changeset.
- *KIT-025 coupling:* if KIT-025 reads `onError` through a latest-props ref inside the adapter, a superseded load's
  media error would arrive through the live `handleError` and pass the gate. The `AdapterProps` doc added here is
  the guard; KIT-025's reviewer should check it.
- *Harness route fulfilment for junk paths* (spec 31 on HEAD) may throw inside the route handler (`ENOENT`) — that
  is the red, not flakiness. After the fix no such request exists.
- *Pinned test edits* (§5.6) touch a block that says "do not fix". Only `ok/status/url` are added; reviewer should
  diff that block and see no assertion changed.

**Open questions — none block**
- Q1 (non-blocking): `minor` vs `patch` for the changeset. Plan says `minor`; orchestrator may downgrade.
- Q2 (non-blocking): report a failure for a track deselected (same source) before it settled? Plan: yes (R8),
  matching Fire OS today. Gating on selection would need the track id in the payload (a type change) — not worth it.
- Q3 (non-blocking): bound segment fan-out (count cap / concurrency) for very long VOD playlists. Pre-existing,
  not a storm in the ticket's sense; suggest a follow-up ticket if wanted.
- Q4 (non-blocking): KIT-002 §9 Q5 (`resolveUrl` for segments) remains separate; the new `mediaPlaylistUris` makes
  it a one-line change later.
- Q5 (non-blocking): a media playlist with zero segments is treated as an error (R2). The kit does not support
  live/EVENT refresh (getting-started), so an empty VOD playlist is a broken source.
- Suggest the orchestrator record "onError is origin-gated per source like onTracks/onState" as an amendment to
  decision 0005 §4 (or a short 0009).
