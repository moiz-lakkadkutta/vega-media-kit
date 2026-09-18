# KIT-002/003/004 — HLS master-playlist parsing in the kit

**Role chain:** Planner (fable, this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3.2 (plan contents), §4 (invariants), §6 (escalation).
**Status of this plan:** ready for an implementer, **except** the `described` question in §9 Q1, which the
orchestrator must escalate to the human before the deprecation wording in `docs/getting-started.md` is final.
Everything else can start now.

Goal in one sentence: the kit reads text-track (and audio-rendition) metadata from the HLS master playlist
itself, so `TextTrack.url` is populated by the kit and `source.headers['x-kit-text-urls']` is no longer how an
app tells the kit where subtitles live.

---

## 0. Decisions at a glance

| # | Question | Decision |
|---|---|---|
| 1 | Where does the module live; what is public | **Pure parser in `src/core/hls.ts`** (public from `./core`, six functions + three types). **Fetch layer in `src/player/hls.ts`** (the file the scaffold comments already name), public from `./player`: `loadHlsTextTracks`, `fetchHlsVtt`. |
| 2 | `fetchHlsVtt` | **Moves** from `adapters/fireos.tsx` to `src/player/hls.ts`, **body byte-identical**, same name, same signature, still exported from `./player`. Not an API change; no decision record needed. Two tests pin its behaviour during the move. |
| 3 | Parse vs fetch | `parseHlsMaster(text, baseUrl?) → HlsMaster` is pure (no I/O, no RN). `loadHlsTextTracks(url, { headers?, fetch? }) → Promise<TextTrack[]>` is the thin fetch layer, with an injectable `fetch` so it is tested in Node with no network. |
| 4 | What the parser handles | RFC 8216 §4.3.4.1 `EXT-X-MEDIA` (all four TYPEs; URI, GROUP-ID, LANGUAGE, NAME, DEFAULT, AUTOSELECT, FORCED, INSTREAM-ID, CHARACTERISTICS, CHANNELS; every other attribute kept raw), §4.3.4.2 `EXT-X-STREAM-INF` + its URI line, §4.2 attribute lists with quoted commas, RFC 3986 relative-reference resolution against the master's own URL (hand-written; see R1). CHARACTERISTICS → `AudioRole`/`TextKind` through the maps that already exist in `src/core/tracks.ts`. Out of scope in §4.4. |
| 5 | `x-kit-text-urls` | **Deprecated, still honoured for one release, warns once with a doc link** (`deprecateOnce`, new sibling of `warnOnce`). Manifest-derived tracks are the source of truth; header entries are an override/add by id. Removal is the next minor, after `described` has migrated — that migration is a kit ↔ app change and is **escalated** (§9 Q1). |

---

## 1. The five decisions, with reasoning

### 1.1 Where the module lives, and what is public

**Decision:** parser in `src/core/hls.ts`; fetch layer in `src/player/hls.ts`.

Why core, despite the public-surface cost that made KIT-009 put `selection.ts` in `src/player/`:

- `./player` cannot be imported in plain Node at all: `src/player/index.ts` → `KitPlayer.tsx` →
  `import { Platform } from 'react-native'` (`src/player/KitPlayer.tsx:2`). A media pipeline that wants to parse a
  master playlist (for example `described/packages/pipeline`, which already imports `serializeVtt` and `lintCues`
  from `@moizp/vega-media-kit/core` — `packages/pipeline/src/steps/08-text.ts:2`) can only reach it through
  `./core`. `CLAUDE.md`'s "runs in Node, used by media pipelines" is a literal description of this consumer.
- The precedent that fits is `src/core/tracks.ts`, not `selection.ts`: a pure transform over a platform's data
  shape (Shaka/ExoPlayer track objects there; playlist text here) into kit types. `selection.ts` is KitPlayer's
  wiring state, which no pipeline would ever call.
- `vitest.config.ts` collects coverage for `src/core/**` only; the parser is exactly the kind of code that
  should be under that umbrella.

Cost, and how it is contained: `./core` is `export *`, so every export in `src/core/hls.ts` is public. The
public surface is capped at what §3.1 lists (six functions, three interfaces, one union type). Nothing else in
the file is exported. Two small helpers are additionally exported from `src/core/tracks.ts`
(`textKindFromRoles`, `textKindFromLabel`) so the parser reuses the existing CHARACTERISTICS mapping instead of
duplicating it (`CLAUDE.md`: "do not write a second mapping"); they are extractions of code that already
exists, not new behaviour.

`src/player/hls.ts` exists because `fireos.tsx:51` and `vega.tsx:78` both point at it and because the fetch
layer needs `fetch`, which is a runtime concern that does not belong in core. It is re-exported from `./player`
only as `loadHlsTextTracks` and `fetchHlsVtt`; `fetchHlsMaster` and `deprecatedTextUrls` are exported from the
file (for tests and adapters) but not from the package entry.

### 1.2 `fetchHlsVtt`

**Decision:** moves to `src/player/hls.ts`; body byte-identical; `src/player/index.ts` re-export path changes
from `./adapters/fireos` to `./hls`; the public name, signature and entry point (`./player`) do not change.

Layering, top to bottom:

```
parseHlsMaster (core, pure)         master playlist text  →  HlsMaster
textTracksFromHls (core, pure)      HlsMaster             →  TextTrack[] (url populated, kind from CHARACTERISTICS/NAME)
loadHlsTextTracks (player, fetch)   master URL            →  TextTrack[]   (fetch + the two above)
fetchHlsVtt (player, fetch)         media playlist URL    →  concatenated WebVTT   (UNCHANGED)
```

`fetchHlsVtt` is the consumer of `TextTrack.url`; `loadHlsTextTracks` is the producer. They never call each
other. Naming: `parse*` is pure, `fetch*` returns raw/typed data from the network, `load*` returns kit types
from the network.

Not changed on purpose: `fetchHlsVtt` resolves segment URIs with `base + l`, which is wrong for `/absolute`
and `../` segment paths. Fixing it would change a public function's behaviour and needs its own decision; it is
logged as a follow-up (§9 Q5). The two new tests in `test/hls-load.test.ts` pin the current behaviour so the
move is provably behaviour-preserving.

### 1.3 Separate parsing from fetching

Signatures in §3. The split is enforced by tests: `test/hls.test.ts` imports only from `../src/core` and
reads fixtures from disk; `test/hls-load.test.ts` passes a stub `fetch` and never touches the network. A source
guard asserts `src/core/*.ts` imports nothing from `react` or `react-native`.

### 1.4 What the parser handles

§4 is the normative list, with RFC 8216 section numbers. The CHARACTERISTICS mapping is **not** new: `src/core/tracks.ts`
already maps `public.accessibility.describes-video` → `description` (audio, `roleMap`, line 29) and
`public.accessibility.describes-video` → `descriptions`, `public.accessibility.transcribes-spoken-dialog` →
`captions`, `public.accessibility.describes-music-and-sound` → `captions` (text, `textKindMap`, lines 78–80),
with the label heuristic `textKindFromLabel` as the fallback (line 84). The parser calls those. It adds no
string to either map.

### 1.5 Retiring `x-kit-text-urls`

**Decision:** deprecate with a one-time warning; honour it for one release; remove in the next minor once
`described` has migrated.

Why not "keep as an explicit override": it rides on `source.headers`, which react-native-video sends verbatim to
the CDN as a real HTTP header (`docs/spike-runbook.md:794`; RNV `source` prop docs
https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/). On the web adapter a custom
request header forces a CORS preflight, which a CDN without `Access-Control-Allow-Headers: x-kit-text-urls`
rejects. A legitimate override slot would be a dedicated field on `KitSource` — a `src/player/types.ts` change
this ticket may not make. So the header cannot be the long-term override.

Why not "remove outright": `described/packages/shared-ui/src/screens/Player.tsx:45` passes it today, and its
`TrackSheet` selects text with app-composed ids (`captions-en`, `sdh-en`, `descriptions-en`,
`TrackSheet.tsx:26-28`) that only work *because* the header map is keyed by those same app ids. Removing the
header before `described` switches to kit track ids breaks its explicit caption selection. ORCHESTRATOR §6
requires the kit ↔ app change to be escalated, and the human may want to land both sides together.

What "honoured" means precisely (same on Fire OS and web):

1. Text tracks come from the manifest (`loadHlsTextTracks`). If the fetch fails, the adapter reports a
   **non-fatal** `HLS_MASTER` error and falls back to today's track list (`fromRnvText` on Fire OS; nothing on
   web).
2. If `source.headers['x-kit-text-urls']` is present, `deprecatedTextUrls(headers)` emits one
   `console.warn` per process via `deprecateOnce` and returns the parsed map (`{}` on malformed JSON, with the
   same one-time warning; today malformed JSON throws inside `onLoad`).
3. Header entries are merged into the adapter's id → url map **after** the manifest entries, so an entry
   overrides a manifest URL for the same id and adds a fetchable id that the manifest did not produce. That is
   the one-release bridge for `described`'s app-keyed ids.
4. The kit's own master-playlist fetch never forwards `x-kit-text-urls` (it strips the key). What
   react-native-video sends to the CDN is untouched in this ticket; it disappears with the header.

Does `CLAUDE.md`'s "every no-op warns once with a doc link" apply? Not literally — the header is not a no-op
while deprecated — but the same mechanism is the right tool and the same convention (one line, once, with a
URL) is followed. `warnOnce` hard-codes "is a no-op on ${os}", so a sibling `deprecateOnce(what, doc)` is added
to `src/platform/log.ts` rather than bending the message.

What `described` must do: §9 Q1. Nothing in this plan edits `~/hackathon/described`.

---

## 2. Files

Created or changed by the **implementer**:

| File | Role |
|---|---|
| `src/core/hls.ts` | **New.** Pure HLS master-playlist parser and kit-type mappers. No imports beyond `./types` and `./tracks`. |
| `src/core/tracks.ts` | Export `textKindFromRoles` (extracted from the lookup inside `fromShakaText`) and `textKindFromLabel` (already a const; add `export`). `fromShakaText` calls `textKindFromRoles`; behaviour unchanged, existing tests are the guard. |
| `src/core/index.ts` | Add `export * from './hls'`. |
| `src/player/hls.ts` | **New.** Fetch layer: `fetchHlsMaster`, `loadHlsTextTracks`, `deprecatedTextUrls`, `DEPRECATED_TEXT_URLS_HEADER`, and `fetchHlsVtt` moved here verbatim. |
| `src/player/index.ts` | `export { fetchHlsVtt, loadHlsTextTracks } from './hls'` (replaces the `./adapters/fireos` re-export). |
| `src/player/adapters/fireos.tsx` | Text tracks from the manifest; header path via `deprecatedTextUrls`; `fetchHlsVtt` imported from `../hls`; delete the `TODO(spike KIT-001)` comment and the local `fetchHlsVtt`. |
| `src/player/adapters/web.tsx` | Text tracks from the manifest (this also closes KIT-013's hard-coded `kind: 'subtitles'` for manifest tracks); header path via `deprecatedTextUrls`. |
| `src/platform/log.ts` | Add `deprecateOnce(what, doc)`. |
| `test/hls.test.ts` | **New.** Parser, resolver, mappers, fixtures, core-is-RN-free guard. |
| `test/hls-load.test.ts` | **New.** Fetch layer with stub `fetch`; `fetchHlsVtt` behaviour pins; `deprecatedTextUrls`; adapter source guards. |
| `test/log.test.ts` | **New.** `deprecateOnce` warns once. |
| `test/tracks.test.ts` | Two `it`s for the newly exported helpers. |
| `test/fixtures/hls/apple-bipbop-adv-master.m3u8` | **New.** Verbatim Apple "bipbop advanced" fMP4 master (Appendix A). |
| `test/fixtures/hls/shaka-packager-master.m3u8` | **New.** Shaka Packager master: two audio renditions (main, description), three text tracks (Appendix B). |
| `test/fixtures/hls/angel-one-master.m3u8` | **New.** Verbatim Shaka Packager v2.3.0 output for the runbook's primary stream (Appendix C). |
| `docs/getting-started.md` | Step 3 rewritten; new `## Text tracks` section (the deprecation warning links to its anchor). |
| `README.md` | `core` row: add "HLS master-playlist parser (`parseHlsMaster`)". |
| `.changeset/hls-master-parsing.md` | `minor`. |

**Not** touched by the implementer: `src/player/adapters/vega.tsx` (KIT-010 owns the rewrite; the `TODO(spike)`
at line 77 is resolved by that ticket now that option (a) exists), `src/player/types.ts`, `src/core/types.ts`,
`docs/spike-runbook.md` (historical; its scratch-branch shim imports `fetchHlsVtt` from `./fireos`, which is
fine on that branch), `src/player/KitPlayer.tsx`, anything under `~/hackathon/described`.

For the **orchestrator/scribe** after the human answers §9 Q1: `docs/decisions/0004-hls-master-parsing.md`
(the deprecation and the `described` migration are the non-obvious decisions), `TASKS.md` (tick
KIT-002/003/004; note KIT-013 is closed for manifest tracks by this ticket), and a friction entry in
`described/docs/friction/` for "text-track URLs had to travel as an HTTP header because neither ExoPlayer nor
Shaka exposes them" — evidence in `docs/spike-runbook.md:794-795`.

---

## 3. Interfaces

### 3.1 `src/core/hls.ts` (public via `./core`)

```ts
import type { AudioTrack, TextTrack } from './types'

/** `TYPE` of an `#EXT-X-MEDIA` tag — RFC 8216 §4.3.4.1. */
export type HlsMediaType = 'AUDIO' | 'VIDEO' | 'SUBTITLES' | 'CLOSED-CAPTIONS'

/** One `#EXT-X-MEDIA` tag. Attribute semantics: RFC 8216 §4.3.4.1. */
export interface HlsRendition {
  type: HlsMediaType
  groupId: string
  /** NAME — required by the spec; '' if a broken playlist omits it. */
  name: string
  /** LANGUAGE (RFC 5646) as written, e.g. 'pt-BR'; undefined when absent. */
  language?: string
  /** URI resolved against `baseUrl` when one was given; undefined when absent (always for CLOSED-CAPTIONS). */
  uri?: string
  /** DEFAULT=YES. */
  default: boolean
  /** AUTOSELECT=YES. */
  autoselect: boolean
  /** FORCED=YES (SUBTITLES only). */
  forced: boolean
  /** CHARACTERISTICS split on ',', e.g. ['public.accessibility.describes-video']; [] when absent. */
  characteristics: string[]
  /** INSTREAM-ID (CLOSED-CAPTIONS only). */
  instreamId?: string
  /** CHANNELS as written, e.g. '6' or '16/JOC'. */
  channels?: string
  /** Every attribute as written (quotes stripped), including the ones mapped above. */
  attributes: Record<string, string>
}

/** One `#EXT-X-STREAM-INF` tag and the URI line that follows it — RFC 8216 §4.3.4.2. */
export interface HlsVariant {
  uri: string
  bandwidth?: number
  averageBandwidth?: number
  codecs: string[]
  resolution?: { width: number; height: number }
  /** GROUP-ID references into `HlsMaster.renditions`. */
  audio?: string
  subtitles?: string
  /** GROUP-ID, or 'NONE'. */
  closedCaptions?: string
  attributes: Record<string, string>
}

export interface HlsMaster {
  /** #EXT-X-VERSION, when present. */
  version?: number
  /** #EXT-X-INDEPENDENT-SEGMENTS present. */
  independentSegments: boolean
  /** In playlist order, all TYPEs. */
  renditions: HlsRendition[]
  /** In playlist order. I-frame variants are not included. */
  variants: HlsVariant[]
}

/** RFC 8216 §4.2 attribute list: `A=1,B="x,y",C=YES` → { A: '1', B: 'x,y', C: 'YES' }. Last duplicate wins. */
export function parseAttributeList(input: string): Record<string, string>

/**
 * RFC 3986 §5.2 reference resolution for the subset HLS needs: absolute, protocol-relative (`//`),
 * absolute-path (`/`), and relative-path references with `.`/`..` removal. The base's query and fragment
 * are dropped; the reference's query is kept. Never uses `new URL(ref, base)` — see the plan's risk R1.
 */
export function resolveUrl(base: string, reference: string): string

/** True for a master (multivariant) playlist: has #EXT-X-STREAM-INF or #EXT-X-MEDIA and no #EXTINF. */
export function isMasterPlaylist(text: string): boolean

/**
 * Parse a master playlist. Throws `Error` (message contains 'EXTM3U') when the first non-blank line
 * is not `#EXTM3U`. With `baseUrl`, every URI is made absolute; without it URIs are left as written.
 */
export function parseHlsMaster(text: string, baseUrl?: string): HlsMaster

/**
 * SUBTITLES renditions that carry a URI, in playlist order, de-duplicated by URI, as kit text tracks.
 * id = String(ordinal among the returned tracks); label = NAME; language = LANGUAGE ?? 'und';
 * kind = textKindFromRoles(characteristics) ?? textKindFromLabel(name) ?? 'subtitles';
 * active = false always (text stays off until asked — docs/decisions/0003); url = rendition.uri.
 * CLOSED-CAPTIONS renditions are excluded: they have no URI, so the scheduler cannot deliver them.
 */
export function textTracksFromHls(master: HlsMaster): TextTrack[]

/**
 * AUDIO renditions, in playlist order, as kit audio tracks. id = String(ordinal); label = NAME (or
 * labelFor(language, roles) when NAME is empty); language = LANGUAGE ?? 'und'; roles =
 * normalizeRoles(characteristics); active = rendition.default. No de-duplication: Apple's bipbop master
 * legitimately lists three "English" renditions (AAC, AC-3, EC-3).
 */
export function audioTracksFromHls(master: HlsMaster): AudioTrack[]
```

### 3.2 `src/core/tracks.ts` (two new exports; no behaviour change)

```ts
/** First CHARACTERISTICS / Shaka role that maps to a TextKind, else undefined. Extracted from fromShakaText. */
export function textKindFromRoles(roles: readonly string[] | null | undefined): TextKind | undefined
/** Title heuristic shared by fromRnvText / fromShakaText: /descri|deskri/ → descriptions, /caption|sdh/ → captions. */
export const textKindFromLabel: (label: string) => TextKind | undefined
```

`fromShakaText` becomes `const roleKind = textKindFromRoles(t.roles)` with the rest of the line unchanged.

### 3.3 `src/player/hls.ts` (public via `./player`: `loadHlsTextTracks`, `fetchHlsVtt`)

```ts
import type { HlsMaster, TextTrack } from '../core'

/** Structural subset of fetch so tests stub it without constructing Response objects. */
export type HlsFetch = (url: string, init?: { headers?: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; url: string; text(): Promise<string> }>

export interface HlsLoadOptions {
  /** Sent with the master-playlist request (auth, cookies-by-header). `x-kit-text-urls` is always stripped. */
  headers?: Record<string, string>
  /** Defaults to globalThis.fetch. */
  fetch?: HlsFetch
}

/**
 * GET the playlist at `url`. Returns null when the body is a media playlist (the app pointed the kit at a
 * rendition directly). Throws on a non-2xx response (`Error`, message contains the status) or a non-M3U8 body.
 * URIs are resolved against the final response URL (`res.url`), falling back to `url` when empty.
 */
export function fetchHlsMaster(url: string, opts?: HlsLoadOptions): Promise<HlsMaster | null>

/** fetchHlsMaster → textTracksFromHls; [] for a media playlist. Errors propagate. */
export function loadHlsTextTracks(url: string, opts?: HlsLoadOptions): Promise<TextTrack[]>

export const DEPRECATED_TEXT_URLS_HEADER = 'x-kit-text-urls'

/**
 * The one-release bridge for the retired header. {} when absent. When present: deprecateOnce(...) then
 * JSON.parse; a malformed value yields {} (and the same single warning) instead of throwing.
 */
export function deprecatedTextUrls(headers: Record<string, string> | undefined): Record<string, string>

/** Resolve an HLS subtitle media playlist to concatenated WebVTT (segments joined; headers de-duplicated). */
export async function fetchHlsVtt(url: string): Promise<string>   // body moved verbatim from adapters/fireos.tsx:84-92
```

### 3.4 `src/platform/log.ts`

```ts
/** Warn once per `what` that a feature is deprecated, with the doc that says what to do instead. console.warn, not debug. */
export function deprecateOnce(what: string, doc: string): void
export const DEPRECATION_DOCS = 'https://github.com/moiz-lakkadkutta/vega-media-kit/blob/main/docs/getting-started.md#text-tracks'
```

Message: `` `[vega-media-kit] ${what} is deprecated and will be removed in the next minor release. See ${doc}` ``.
Keyed by `what` in a module-level `Set`, like `warnOnce`.

### 3.5 Types that must not change

`src/player/types.ts` and `src/core/types.ts` are **not** modified. `TextTrack.url` already exists
(`src/core/types.ts:21`) and is exactly what this ticket populates. Two things this plan *wanted* and could not
have without a decision record are listed in §9 (Q6 `forced`, Q1 a `KitSource` override slot); the plan does
not assume either.

---

## 4. Behaviour specification

### 4.1 Playlist text (RFC 8216 §4.1)

- Lines split on `\n`; a trailing `\r` is stripped (CRLF playlists parse identically). A leading UTF-8 BOM is
  stripped (the RFC forbids one; be tolerant).
- The first non-blank line must be `#EXTM3U`, else throw.
- Blank lines are ignored anywhere (Apple's master has runs of two).
- A line starting with `#` but not `#EXT` is a comment and is ignored (Shaka Packager's
  `## Generated with …` line).
- Tags are `#EXT…` lines; a line not starting with `#` is a URI line and belongs to the preceding
  `#EXT-X-STREAM-INF`.

### 4.2 `#EXT-X-MEDIA` (RFC 8216 §4.3.4.1, https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.4.1)

| Attribute | Handling |
|---|---|
| `TYPE` | Required; one of the four `HlsMediaType`s. A tag with another or missing TYPE is skipped. |
| `URI` | Optional quoted-string. Resolved with `resolveUrl(baseUrl, uri)` when `baseUrl` was given. Absent for CLOSED-CAPTIONS ("MUST NOT" per spec). |
| `GROUP-ID` | Required quoted-string; `''` when missing. |
| `LANGUAGE` | Optional quoted-string, RFC 5646 tag, kept as written (case preserved: `pt-BR`). |
| `NAME` | Required quoted-string; `''` when missing. |
| `DEFAULT` | `YES`/`NO`, default `NO`. |
| `AUTOSELECT` | `YES`/`NO`, default `NO`. |
| `FORCED` | `YES`/`NO`, default `NO`; only meaningful for SUBTITLES. |
| `INSTREAM-ID` | Quoted-string; CLOSED-CAPTIONS only. |
| `CHARACTERISTICS` | Quoted-string, comma-separated UTIs → `string[]` (trimmed, empty entries dropped). This is the attribute whose quoted value contains commas. |
| `CHANNELS` | Quoted-string as written. |
| everything else (`ASSOC-LANGUAGE`, `STABLE-RENDITION-ID`, …) | Kept in `attributes` only. |

Tag order is not assumed: Apple lists `#EXT-X-MEDIA` **after** the `#EXT-X-STREAM-INF` block, Shaka Packager
before it. Both fixtures exercise this.

### 4.3 `#EXT-X-STREAM-INF` (RFC 8216 §4.3.4.2)

- The URI is the next non-blank, non-comment line. If a tag line (`#EXT…`) or EOF arrives first, the variant
  is dropped (no throw).
- `BANDWIDTH` → `bandwidth` (int), `AVERAGE-BANDWIDTH` → `averageBandwidth` (int), `CODECS` → split on `,`,
  `RESOLUTION` → `{ width, height }` from `WxH`, `AUDIO` / `SUBTITLES` / `CLOSED-CAPTIONS` → group ids
  (`CLOSED-CAPTIONS=NONE` is the unquoted enumerated value and is kept as `'NONE'`). Everything else raw.
- `#EXT-X-I-FRAME-STREAM-INF` is ignored entirely (it carries its own `URI` attribute and has no URI line, so
  it must not be confused with a STREAM-INF).

### 4.4 Out of scope (ignored without error; the implementer does not add handling)

DASH/MPD anything; `#EXT-X-SESSION-KEY` / `#EXT-X-KEY` / encryption; `#EXT-X-BYTERANGE` and any media-playlist
tag (`#EXTINF`, `#EXT-X-TARGETDURATION`, `#EXT-X-MAP`, `#EXT-X-PLAYLIST-TYPE:EVENT`, live refresh — `fetchHlsVtt`
keeps its own one-shot segment listing); `#EXT-X-I-FRAME-STREAM-INF`; `#EXT-X-SESSION-DATA`;
`#EXT-X-START`; `#EXT-X-DEFINE` variable substitution (a `{$name}` in a URI stays literal); content steering;
`#EXT-X-MEDIA` `TYPE=VIDEO` beyond storing it as a rendition; `ASSOC-LANGUAGE`; any de-duplication of audio
renditions across groups. `HlsRendition.attributes` retains the raw values so a later ticket can add any of
these without re-parsing.

### 4.5 Mapping to kit types

- Audio roles: `normalizeRoles(rendition.characteristics)` — already maps
  `public.accessibility.describes-video` → `description` and defaults to `['main']`
  (`src/core/tracks.ts:26-43`).
- Text kinds: `textKindFromRoles(characteristics)` first (`describes-video` → `descriptions`,
  `transcribes-spoken-dialog` → `captions`, `describes-music-and-sound` → `captions`), then
  `textKindFromLabel(NAME)`, then `'subtitles'`. The label fallback matters in practice: `described`'s own
  packager step (`packages/pipeline/src/steps/09-package.ts:24,32`) emits its "Captions" and "Description
  text" streams **without** `hls_characteristics`, so their kinds can only come from NAME today (see §9 Q1).
- `FORCED=YES` subtitles are returned as ordinary `subtitles` tracks; `TextTrack` has no field for it (§9 Q6).
- The UTI vocabulary is Apple's: HLS Authoring Specification for Apple Devices, §"Subtitles and closed captions"
  / "Accessibility", https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices.

### 4.6 `resolveUrl` (RFC 3986 §5.2, https://datatracker.ietf.org/doc/html/rfc3986#section-5.2)

| reference | result against base `https://h/a/b/master.m3u8?t=1` |
|---|---|
| `s1/en/prog_index.m3u8` | `https://h/a/b/s1/en/prog_index.m3u8` |
| `./x.m3u8` | `https://h/a/b/x.m3u8` |
| `../up/x.m3u8` | `https://h/a/up/x.m3u8` |
| `/abs/x.m3u8` | `https://h/abs/x.m3u8` |
| `//cdn.example/x.m3u8` | `https://cdn.example/x.m3u8` |
| `https://other/x.m3u8` | unchanged |
| `x.m3u8?k=v` | `https://h/a/b/x.m3u8?k=v` (base query dropped, reference query kept) |

Implementation: hand-written merge (§5.2.3) + `remove_dot_segments` (§5.2.4), ~25 lines. No `new URL()`.
The test cross-checks every row against Node's WHATWG `URL`, which is the reference implementation the RN
polyfill is not (R1).

### 4.7 Adapter wiring

**Fire OS (`src/player/adapters/fireos.tsx`)**

1. `const hlsText = useRef<Promise<TextTrack[]> | null>(null)`.
2. `onLoadStart`: when `props.source.type === 'hls'`, start
   `loadHlsTextTracks(props.source.uri, { headers: props.source.headers })` and store the promise, with
   `.catch(e => { props.onError?.({ code: 'HLS_MASTER', message: 'Could not read the master playlist', fatal: false, cause: e }); return [] })`.
   Then `props.onState?.('loading')` as today. Starting here overlaps the fetch with ExoPlayer's own load.
3. `onLoad` becomes `async`: `const manifestText = (await hlsText.current) ?? []`. Build
   `textUrls.current = new Map(manifestText.map(t => [t.id, t.url!]))`, then
   `for (const [id, url] of Object.entries(deprecatedTextUrls(props.source.headers))) textUrls.current.set(id, url)`.
   `t = { audio: fromRnvAudio(e.audioTracks ?? []), text: manifestText.length ? manifestText : fromRnvText(e.textTracks ?? []) }`.
   Then `tracks.current = t; props.onTracks?.(t); props.onState?.('ready')` — **one** `onTracks` call, after
   the await, because `KitPlayer.handleTracks` applies `preferredText` on the first call only
   (`KitPlayer.tsx:47-48`); an earlier text-less call would leave `preferredText` never applied.
4. `selectText` is unchanged except that `fetchHlsVtt` is imported from `../hls`.
5. Delete the `TODO(spike KIT-001)` comment and the local `fetchHlsVtt`.
6. Audio tracks stay ExoPlayer-indexed (`selectAudio` uses `{ type: 'index' }`); no manifest enrichment in
   this ticket (§9 Q4).

**Web (`src/player/adapters/web.tsx`)**

1. In the effect, start `loadHlsTextTracks(props.source.uri)` (no headers — matches today's bare
   `fetch(t.url)`), caught to `[]` with the same non-fatal `HLS_MASTER` error.
2. Header bridge: `deprecatedTextUrls(props.source.headers)`; entries whose id is not among manifest tracks are
   appended as today's `{ id, language: id.split('-')[0] ?? 'und', label: id, kind: 'subtitles', active: false, url }`
   so the KIT-005 harness keeps working with `.mp4` sources; entries whose id matches override that track's `url`.
3. Publish `onTracks` once, when **both** `loadedmetadata` has fired and the manifest promise has settled
   (`Promise.all`). `onState('ready')` stays on `loadedmetadata`.
4. `selectText` unchanged (fetches `t.url` directly; a web `.m3u8` subtitle URL would need `fetchHlsVtt`, which
   is out of scope here and noted in §9 Q7).

**Vega**: untouched. KIT-010 decides whether `Tracks.text` on Vega comes from `loadHlsTextTracks` (recommended in
§9 Q3 — it makes text ids identical on both platforms) or from Shaka.

---

## 5. Acceptance tests

All run in plain Node under `pnpm test` (vitest, globals on). No network, no new dependencies. Fixture reader:
`const fx = (n: string) => readFileSync(new URL(`./fixtures/hls/${n}`, import.meta.url).pathname, 'utf8')`
(same idiom as `test/vtt.test.ts:4`).

### `test/hls.test.ts` — imports only from `../src/core`

`describe('parseAttributeList')`
- `it('splits comma-separated pairs and strips quotes')` — `A=1,B="x",C=YES` → `{ A:'1', B:'x', C:'YES' }`.
- `it('keeps commas inside a quoted value')` — `CHARACTERISTICS="a,b",NAME="c"` → CHARACTERISTICS `'a,b'`, NAME `'c'`.
- `it('lets the last duplicate attribute win')`.
- `it('returns an empty object for an empty string')`.

`describe('resolveUrl')`
- `it('resolves relative, dot, dot-dot, absolute-path, protocol-relative and absolute references')` — the table in §4.6, each row asserted.
- `it('agrees with the WHATWG URL reference implementation for every row')` — for each row `expect(resolveUrl(base, ref)).toBe(new URL(ref, base).href)`. This is the guard against the RN polyfill trap (R1).
- `it('drops the base query and keeps the reference query')`.

`describe('isMasterPlaylist')`
- `it('is true for the Apple and Shaka Packager masters')`.
- `it('is false for a media playlist with #EXTINF')`.

`describe('parseHlsMaster — errors and tolerance')`
- `it('throws when the first line is not #EXTM3U')` — `toThrow(/EXTM3U/)`.
- `it('accepts CRLF line endings and a leading BOM')` — same result as LF.
- `it('ignores comments, blank lines, I-frame stream tags and unknown tags')` — inline playlist with `## comment`, `#EXT-X-SESSION-DATA`, `#EXT-X-I-FRAME-STREAM-INF:…,URI="i.m3u8"`; `variants` has only the real one, `renditions` unaffected.
- `it('drops a STREAM-INF with no URI line before the next tag or EOF')`.
- `it('parses FORCED=YES, AUTOSELECT=NO and TYPE=VIDEO renditions')` — inline; `forced: true`, `autoselect: false`, a `VIDEO` rendition present in `renditions`.
- `it('skips an EXT-X-MEDIA tag with an unknown or missing TYPE')`.
- `it('leaves URIs as written when no baseUrl is given and leaves {$var} literal')`.

`describe('parseHlsMaster — Apple bipbop advanced (fixture)')` — `parseHlsMaster(fx('apple-bipbop-adv-master.m3u8'), 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8')`
- `it('reads version 6 and independent segments')`.
- `it('finds 24 variants and no I-frame variants')` — 8 per audio group × 3.
- `it('reads the first variant's bandwidths, codecs, resolution and group references')` — `bandwidth 2177116`, `averageBandwidth 2168183`, `codecs ['avc1.640020','mp4a.40.2']`, `resolution {960,540}`, `audio 'aud1'`, `subtitles 'sub1'`, `closedCaptions 'cc1'`, `uri …/v5/prog_index.m3u8`.
- `it('finds renditions declared after the variants: 3 AUDIO, 1 CLOSED-CAPTIONS, 1 SUBTITLES')` — order-independence.
- `it('reads the audio renditions' group ids, channels and default flags')` — `aud1/'2'`, `aud2/'6'`, `aud3/'6'`, all `default && autoselect`, all `language 'en'`, `name 'English'`.
- `it('reads the closed-captions rendition with INSTREAM-ID and no URI')` — `instreamId 'CC1'`, `uri undefined`.
- `it('resolves the subtitles URI against the master URL')` — `…/img_bipbop_adv_example_fmp4/s1/en/prog_index.m3u8`; `forced false`, `default true`.

`describe('parseHlsMaster — Shaka Packager, two audio renditions and three text tracks (fixture)')` — base `https://cdn.example/spike/master.m3u8`
- `it('finds 2 AUDIO and 3 SUBTITLES renditions declared before the variants')`.
- `it('splits a quoted CHARACTERISTICS value containing a comma into two UTIs')` — the "Rich captions" rendition: `['public.accessibility.transcribes-spoken-dialog','public.accessibility.describes-music-and-sound']`.
- `it('reads DEFAULT=NO explicitly as false')` — packager writes `DEFAULT=NO`.
- `it('resolves every URI to a sibling of the master')` — `audio_main.m3u8` → `https://cdn.example/spike/audio_main.m3u8`, etc.

`describe('parseHlsMaster — Angel One, Shaka Packager v2.3.0 (fixture)')` — base `https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8`
- `it('ignores the "## Generated with" comment line')`.
- `it('finds 6 AUDIO renditions, 4 SUBTITLES renditions and 5 variants')`.
- `it('treats an absent DEFAULT as false and preserves pt-BR as written')`.

`describe('textTracksFromHls')`
- `it('Apple: yields one subtitles track with url, label English, language en, inactive, and excludes closed captions')` — `[{ id:'0', language:'en', label:'English', kind:'subtitles', active:false, url:'…/s1/en/prog_index.m3u8' }]`.
- `it('Shaka Packager: maps kinds from CHARACTERISTICS and falls back to NAME')` — ids `'0','1','2'`; kinds `['captions','captions','descriptions']` (Captions via label; Rich captions via `transcribes-spoken-dialog`; Description text via `describes-video`); every `url` defined; every `active` false.
- `it('Angel One: yields four tracks whose urls match the runbook's TEXT_URLS')` — `[0].url === '…/angel-one-hls/playlist_s-en.webvtt.m3u8'`, `[2].url === '…/playlist_s-fr.webvtt.m3u8'` (`docs/spike-runbook.md:451-452`).
- `it('never marks a text track active, even for DEFAULT=YES')` — decision 0003.
- `it('skips SUBTITLES renditions without a URI and de-duplicates identical URIs')` — inline.
- `it('defaults language to und and label to "<lang> – <kind>" when LANGUAGE and NAME are missing')`.

`describe('audioTracksFromHls')`
- `it('Shaka Packager: yields main and description roles from CHARACTERISTICS')` — `[{ id:'0', label:'Original', roles:['main'], active:true }, { id:'1', label:'Audio description', roles:['description'], active:false }]`, both `language 'en'`.
- `it('Apple: yields three English tracks, all main, all active, without de-duplicating')`.
- `it('Angel One: preserves playlist order and languages en,de,it,fr,es,en')`.

`describe('core stays free of React Native')`
- `it('src/core/*.ts imports nothing from react or react-native')` — `readdirSync` + regex `/from ['"]react(-native)?['"]/` over every file; guards `CLAUDE.md`'s invariant now that core has a second parser.

### `test/hls-load.test.ts` — stub fetch, no network

Stub: `const stub = (bodies: Record<string, string>, finalUrl?: (u: string) => string): HlsFetch & { calls: Array<{ url: string; headers?: Record<string,string> }> }`.

`describe('fetchHlsMaster / loadHlsTextTracks')`
- `it('fetches, parses and resolves URIs against the request URL')` — Apple fixture body served at `https://cdn.example/x/master.m3u8`; `loadHlsTextTracks` returns the one track with the resolved `url`.
- `it('resolves URIs against the final response URL after a redirect')` — stub returns `url: 'https://cdn.example/moved/master.m3u8'`; the track url is under `/moved/`.
- `it('falls back to the request URL when the response url is empty')`.
- `it('returns [] for a media playlist instead of throwing')` — body `#EXTM3U\n#EXTINF:4,\nseg.vtt`.
- `it('throws with the status on a non-2xx response')` — `toThrow(/404/)`.
- `it('forwards caller headers but never the deprecated x-kit-text-urls header')` — `calls[0].headers` has `authorization`, lacks `x-kit-text-urls`.
- `it('uses globalThis.fetch when no fetch is injected')` — `vi.stubGlobal('fetch', …)`; restored after.

`describe('deprecatedTextUrls')`
- `it('returns {} when the header is absent and warns nothing')` — `console.warn` spy not called.
- `it('parses the JSON map and warns exactly once across calls')` — two calls, one warning, message contains `x-kit-text-urls` and the getting-started URL.
- `it('returns {} for malformed JSON instead of throwing')`.

`describe('fetchHlsVtt (moved, behaviour pinned)')` — `vi.stubGlobal('fetch', …)`
- `it('returns a bare WebVTT body unchanged')` — body starts with `WEBVTT`, no `#EXTM3U`.
- `it('joins media-playlist segments with one WEBVTT header and drops per-segment X-TIMESTAMP-MAP lines')` — playlist `#EXTM3U\n#EXTINF:4,\n0.vtt\n#EXTINF:4,\n1.vtt`, segments each `WEBVTT\nX-TIMESTAMP-MAP=…\n\n<cue>`; result is `'WEBVTT\n\n' + cue0 + '\n' + cue1`; segment URLs are `base + name` (today's rule, unchanged).

`describe('adapter wiring (source guards, same spirit as test/selection.test.ts "KitPlayer wiring")')`
- `it('fireos and web derive text tracks through loadHlsTextTracks')` — both sources match `/loadHlsTextTracks\(/` exactly once.
- `it('fireos and web read the header only through deprecatedTextUrls')` — both match `/deprecatedTextUrls\(/`; neither contains the literal `'x-kit-text-urls'`.
- `it('fetchHlsVtt is defined in src/player/hls.ts and no longer in the Fire OS adapter')` — `fireos.tsx` does not match `/function fetchHlsVtt/`; `player/index.ts` matches `/from '\.\/hls'/`.
- `it('the Fire OS adapter publishes tracks only after the manifest promise is awaited')` — `fireos.tsx` matches `/await hlsText\.current/` and that index is less than the index of `props.onTracks?.(`. Crude, but it is the one ordering that `preferredText` depends on (§4.7 step 3).

### `test/log.test.ts`
- `it('deprecateOnce warns once per subject with the doc link')` — two calls with the same `what`, one `console.warn`; a different `what` warns again.

### `test/tracks.test.ts` (additions)
- `it('textKindFromRoles maps accessibility UTIs and returns undefined for unknown roles')`.
- `it('textKindFromLabel infers descriptions and captions from titles and undefined otherwise')`.

The existing `maps HLS accessibility CHARACTERISTICS roles to text kinds` and `falls back to the label…` tests
must stay green unchanged — they are the refactor guard for `fromShakaText`.

---

## 6. Fixtures

Directory: `test/fixtures/hls/` (new; `test/fixtures/` today holds `basic.vtt` and `overlap.vtt`).

| File | Content | Why |
|---|---|---|
| `apple-bipbop-adv-master.m3u8` | Appendix A, **verbatim** as served on 2026-09-18 from `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8` (76 lines, ASCII, LF). | EXT-X-MEDIA after STREAM-INF; three audio groups; CLOSED-CAPTIONS with INSTREAM-ID and no URI; FORCED=NO; I-frame tags; runs of blank lines; nested relative URI `s1/en/prog_index.m3u8`. |
| `shaka-packager-master.m3u8` | Appendix B. Hand-written to Shaka Packager's `BuildMediaTag` output order (`packager/hls/base/master_playlist.cc`: TYPE, URI, GROUP-ID, LANGUAGE, NAME, DEFAULT=YES/NO, AUTOSELECT, FORCED, CHARACTERISTICS, CHANNELS) for the streams `described`'s packager step and the runbook §3.1 command produce. | Two audio renditions (main; description via `describes-video`); three text tracks (Captions — kind from NAME; Rich captions — quoted CHARACTERISTICS with a comma; Description text — `describes-video`); explicit `DEFAULT=NO`; `## Generated with` comment. |
| `angel-one-master.m3u8` | Appendix C, **verbatim** from `https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8` (25 lines). | Real packager v2.3.0 output for the stream the runbook's tests 1–5 use; absent DEFAULT; `pt-BR`; URI before GROUP-ID; six audio languages. |

The implementer copies the appendices byte-for-byte (the verbatim ones may equally be re-downloaded once; the
appendix is canonical if they differ).

---

## 7. Risks (ranked)

| # | Risk | Mitigation |
|---|---|---|
| R1 | **React Native's `URL` does not resolve relative references.** `node_modules/react-native/Libraries/Blob/URL.js` (0.81) implements `new URL(ref, base)` as `base.replace(/\/$/, '') + '/' + ref` — no last-segment replacement, no `..`. `new URL('s1/en/prog_index.m3u8', '…/master.m3u8')` would yield `…/master.m3u8/s1/en/prog_index.m3u8`. Hermes ships no native `URL`. | `resolveUrl` is hand-written to RFC 3986 §5.2 and cross-checked in the test against Node's WHATWG `URL`; a source guard could be added that `src/core/hls.ts` contains no `new URL(` (recommended, one line). |
| R2 | **`preferredText` never applied** if the Fire OS adapter emits `onTracks` before the manifest resolves (`appliedPrefs` gate, `KitPlayer.tsx:47-48`). | §4.7 step 3 mandates one `onTracks` after the await; source-guard test pins the order; reviewer checks it by reading. |
| R3 | **Master fetch fails** (CORS on web, auth on CDN, offline) — text tracks vanish where the header used to work. | Non-fatal `HLS_MASTER` error; fall back to today's list; the deprecated header still merges in, so an app that keeps passing it during the deprecation window loses nothing. Fetch starts at `onLoadStart` so the extra round trip overlaps ExoPlayer's load. |
| R4 | **`described` breaks** when the header is finally removed, or sooner if its ids drift. | One-release deprecation; escalation §9 Q1 with the exact app-side steps; the override-by-id merge keeps `TrackSheet`'s `captions-en` ids fetchable meanwhile. |
| R5 | **Public surface growth on `./core`.** | Capped to §3.1; every export has a test; nothing else exported. Changeset says `minor`. |
| R6 | **Fire OS ExoPlayer text tracks and manifest tracks disagree** (ids, count) when both exist. | When the manifest parses, `Tracks.text` is manifest-only; ExoPlayer text is only the fallback. Native rendering is already disabled (`selectedTextTrack={{ type: 'disabled' }}`), so nothing selects by ExoPlayer text index. |
| R7 | **Web race** between `loadedmetadata` and the manifest promise. | `Promise.all`, single publish. |
| R8 | **`res.url` empty** on some RN fetch implementations. | Fall back to the request URL; tested. |
| R9 | **Hermes regex support.** | Use plain capture groups only (no lookbehind, no named groups) in `parseAttributeList`. |
| R10 | **Playlists using `#EXT-X-DEFINE`** produce literal `{$…}` URIs. | Documented out of scope; parser does not throw; fetch fails non-fatally. |
| R11 | `pnpm lint` is broken repo-wide (ESLint 9, no flat config). | Not fixed, not worked around; `pnpm typecheck && pnpm test && pnpm build` is the gate. |

---

## 8. Implementation order (tests before behaviour — ORCHESTRATOR §4)

Independent groups A and B may run in parallel; C depends on both.

**A — core (opus)**
1. Write the three fixtures (§6, appendices).
2. Write `test/hls.test.ts` and the two `test/tracks.test.ts` additions; run — red.
3. `src/core/tracks.ts` exports; `src/core/hls.ts`; `src/core/index.ts`; run — green.

**B — platform log (opus)**
4. `test/log.test.ts` red → `deprecateOnce` in `src/platform/log.ts` green.

**C — player + adapters + docs (opus, after A and B)**
5. Write `test/hls-load.test.ts` (including the two `fetchHlsVtt` pins **before** moving it); run — red.
6. `src/player/hls.ts` (move `fetchHlsVtt` verbatim; add the rest); `src/player/index.ts`; run the pins — green.
7. `fireos.tsx`, `web.tsx` per §4.7; source guards green.
8. `docs/getting-started.md` (step 3 + `## Text tracks` section with the deprecation note), `README.md` core row,
   `.changeset/hls-master-parsing.md` (`minor`).
9. `pnpm typecheck && pnpm test && pnpm build`. Report: what changed, test counts, anything not done.

Done when: every `it` in §5 exists and passes; `pnpm typecheck` and `pnpm build` pass; `git diff --stat`
touches no file outside §2; `src/core/types.ts` and `src/player/types.ts` are unchanged; no `TODO(spike KIT-001)`
remains in `fireos.tsx`; `vega.tsx` is unchanged.

Changeset text (draft — the deprecation sentence is final only after §9 Q1):

> The kit now reads text tracks from the HLS master playlist (`#EXT-X-MEDIA:TYPE=SUBTITLES`), so `TextTrack.url`
> is populated by the kit on Fire OS and web and `CHARACTERISTICS` decide the track kind. New in `./core`:
> `parseHlsMaster`, `textTracksFromHls`, `audioTracksFromHls`, `resolveUrl`, `isMasterPlaylist`,
> `parseAttributeList`; in `./player`: `loadHlsTextTracks`. `fetchHlsVtt` is unchanged. **Deprecated:**
> `source.headers['x-kit-text-urls']` — still honoured as an override for one release, warns once, removed in
> the next minor; select text tracks by the ids reported in `onTracks` instead. Multi-track text selection is
> unchanged.

---

## 9. Open questions

**Q1 — `described` migration (kit ↔ app; escalate under ORCHESTRATOR §6).** With this ticket, the kit's
text-track ids on Fire OS are manifest ordinals (`'0'`, `'1'`, …), and today they are ExoPlayer indexes;
`described` selects with app-composed ids (`captions-en`, `sdh-en`, `descriptions-en` —
`packages/shared-ui/src/screens/TrackSheet.tsx:26-28`, `Player.tsx:27`) that never matched kit ids on any
path except the header bridge. The human must decide the timing; the app-side work, whenever it happens, is:
1. `Player.tsx:45`: stop passing `x-kit-text-urls` (it also leaks to the CDN as a request header).
2. `TrackSheet` / `textIds()`: resolve ids from the kit's `onTracks` list by `(kind, language)` — `captions`
   for both "Captions" and "Rich captions" (distinguish by label), `descriptions` for "Description text" —
   instead of composing strings. Keep multi-select (`captions + descriptions` for extended mode).
3. `packages/pipeline/src/steps/09-package.ts:24,32`: add `hls_characteristics=public.accessibility.describes-video`
   to the descriptions text stream (today only `roles=description`, which is DASH-only) so its kind does not
   depend on the English label "Description text". Optional but recommended for the "Captions" stream:
   `hls_characteristics=public.accessibility.transcribes-spoken-dialog`.
4. Not this ticket, same class of bug: `Player.tsx:58` calls `selectAudio('audio_ad' | 'audio_main')`, but
   kit audio ids are ExoPlayer indexes on Fire OS and Shaka ids on Vega. `preferredAudio={{ role }}` on line 47
   is the path that works; the sheet's explicit call does not. Worth its own app ticket.
Until the human answers, the implementer proceeds with the deprecation as specified; only the *removal
release* wording in `docs/getting-started.md` may need editing.

**Q2 — Removal timing.** "Next minor" is this plan's proposal. Record the human's answer in
`docs/decisions/0004-hls-master-parsing.md` together with the deprecation itself.

**Q3 — KIT-010 (Vega).** Recommend that the rewritten Vega adapter also builds `Tracks.text` from
`loadHlsTextTracks` and feeds the scheduler through `fetchHlsVtt`, so text ids and kinds are identical on Fire OS
and Vega ("the app cannot tell which, by design", `KitPlayer.tsx:12`). Shaka-side matching by
`(language, label === NAME, roles === CHARACTERISTICS)` is the alternative if N4 in the runbook shows Shaka
can hand over segment URIs. Not decided here.

**Q4 — Fire OS audio roles from CHARACTERISTICS.** `fromRnvAudio` infers `description` from the ExoPlayer
title regex only (`docs/spike-runbook.md:755` predicts this gap for Test 6). `audioTracksFromHls` now gives
the roles; matching an ExoPlayer track to a rendition by `(language, title === NAME)` and merging roles is
~10 lines. Deliberately left out to keep this diff about text; suggest a follow-up ticket.

**Q5 — `fetchHlsVtt` segment resolution** uses `base + l` and mishandles `/absolute` and `../` segment
paths. It should call `resolveUrl`. That changes a public function's behaviour; suggest a follow-up ticket
with a decision line in its changeset.

**Q6 — `FORCED` subtitles.** The parser reads FORCED, but `TextTrack` cannot carry it without a
`src/core/types.ts` change (`forced?: boolean`). Forced narrative tracks therefore appear as ordinary
subtitles and would be auto-selected by `preferredText: { languages: ['en'] }`. Needs a decision before it
matters for a real stream; none of the three fixtures has one.

**Q7 — Web adapter and `.m3u8` subtitle URLs.** `web.tsx` fetches `t.url` and hands the body straight to the
scheduler, so a manifest-derived `.m3u8` subtitle playlist (Apple, Angel One) yields playlist text, not VTT,
on web. Routing web through `fetchHlsVtt` is a one-line change but touches the KIT-005 harness's
assumptions; recommend folding into KIT-005 or KIT-013 rather than here. Flagging so the reviewer does not read
"web derives tracks from the manifest" as "web plays manifest subtitles".

**Q8 — Should react-native-video stop receiving `x-kit-text-urls` now?** The kit's own fetch strips it; the
`<Video source={{ headers }}>` still forwards whatever the app passed. Stripping it there too would end the CDN
leak a release early but is a behaviour change to what the app's headers do; tie it to the removal.

---

## Appendix A — `test/fixtures/hls/apple-bipbop-adv-master.m3u8` (verbatim)

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS


#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2168183,BANDWIDTH=2177116,CODECS="avc1.640020,mp4a.40.2",RESOLUTION=960x540,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v5/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=7968416,BANDWIDTH=8001098,CODECS="avc1.64002a,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v9/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=6170000,BANDWIDTH=6312875,CODECS="avc1.64002a,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v8/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=4670769,BANDWIDTH=4943747,CODECS="avc1.64002a,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v7/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=3168702,BANDWIDTH=3216424,CODECS="avc1.640020,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v6/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1265132,BANDWIDTH=1268994,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=768x432,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v4/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=895755,BANDWIDTH=902298,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v3/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=530721,BANDWIDTH=541052,CODECS="avc1.640015,mp4a.40.2",RESOLUTION=480x270,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud1",SUBTITLES="sub1"
v2/prog_index.m3u8


#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2390686,BANDWIDTH=2399619,CODECS="avc1.640020,ac-3",RESOLUTION=960x540,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v5/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=8190919,BANDWIDTH=8223601,CODECS="avc1.64002a,ac-3",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v9/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=6392503,BANDWIDTH=6535378,CODECS="avc1.64002a,ac-3",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v8/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=4893272,BANDWIDTH=5166250,CODECS="avc1.64002a,ac-3",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v7/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=3391205,BANDWIDTH=3438927,CODECS="avc1.640020,ac-3",RESOLUTION=1280x720,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v6/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1487635,BANDWIDTH=1491497,CODECS="avc1.64001e,ac-3",RESOLUTION=768x432,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v4/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1118258,BANDWIDTH=1124801,CODECS="avc1.64001e,ac-3",RESOLUTION=640x360,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v3/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=753224,BANDWIDTH=763555,CODECS="avc1.640015,ac-3",RESOLUTION=480x270,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud2",SUBTITLES="sub1"
v2/prog_index.m3u8


#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=2198686,BANDWIDTH=2207619,CODECS="avc1.640020,ec-3",RESOLUTION=960x540,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v5/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=7998919,BANDWIDTH=8031601,CODECS="avc1.64002a,ec-3",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v9/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=6200503,BANDWIDTH=6343378,CODECS="avc1.64002a,ec-3",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v8/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=4701272,BANDWIDTH=4974250,CODECS="avc1.64002a,ec-3",RESOLUTION=1920x1080,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v7/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=3199205,BANDWIDTH=3246927,CODECS="avc1.640020,ec-3",RESOLUTION=1280x720,FRAME-RATE=60.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v6/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1295635,BANDWIDTH=1299497,CODECS="avc1.64001e,ec-3",RESOLUTION=768x432,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v4/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=926258,BANDWIDTH=932801,CODECS="avc1.64001e,ec-3",RESOLUTION=640x360,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v3/prog_index.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=561224,BANDWIDTH=571555,CODECS="avc1.640015,ec-3",RESOLUTION=480x270,FRAME-RATE=30.000,CLOSED-CAPTIONS="cc1",AUDIO="aud3",SUBTITLES="sub1"
v2/prog_index.m3u8


#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=183689,BANDWIDTH=187492,CODECS="avc1.64002a",RESOLUTION=1920x1080,URI="v7/iframe_index.m3u8"
#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=132672,BANDWIDTH=136398,CODECS="avc1.640020",RESOLUTION=1280x720,URI="v6/iframe_index.m3u8"
#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=97767,BANDWIDTH=101378,CODECS="avc1.640020",RESOLUTION=960x540,URI="v5/iframe_index.m3u8"
#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=75722,BANDWIDTH=77818,CODECS="avc1.64001e",RESOLUTION=768x432,URI="v4/iframe_index.m3u8"
#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=63522,BANDWIDTH=65091,CODECS="avc1.64001e",RESOLUTION=640x360,URI="v3/iframe_index.m3u8"
#EXT-X-I-FRAME-STREAM-INF:AVERAGE-BANDWIDTH=39678,BANDWIDTH=40282,CODECS="avc1.640015",RESOLUTION=480x270,URI="v2/iframe_index.m3u8"


#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="2",URI="a1/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud2",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="6",URI="a2/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud3",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="6",URI="a3/prog_index.m3u8"


#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc1",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,INSTREAM-ID="CC1"


#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub1",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,FORCED=NO,URI="s1/en/prog_index.m3u8"
```

## Appendix B — `test/fixtures/hls/shaka-packager-master.m3u8`

Attribute order follows `BuildMediaTag` in Shaka Packager `packager/hls/base/master_playlist.cc` (main branch,
fetched 2026-09-18): TYPE, URI, GROUP-ID, LANGUAGE, NAME, DEFAULT=YES|NO, AUTOSELECT=YES, [FORCED=YES],
[CHARACTERISTICS], [CHANNELS]. Streams mirror `described/packages/pipeline/src/steps/09-package.ts` with
`hls_characteristics` on the descriptions track (§9 Q1 step 3).

```
#EXTM3U
## Generated with https://github.com/shaka-project/shaka-packager version v3.4.2-release

#EXT-X-MEDIA:TYPE=AUDIO,URI="audio_main.m3u8",GROUP-ID="audio",LANGUAGE="en",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio_ad.m3u8",GROUP-ID="audio",LANGUAGE="en",NAME="Audio description",DEFAULT=NO,AUTOSELECT=YES,CHARACTERISTICS="public.accessibility.describes-video",CHANNELS="2"

#EXT-X-MEDIA:TYPE=SUBTITLES,URI="captions.m3u8",GROUP-ID="text",LANGUAGE="en",NAME="Captions",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="sdh.m3u8",GROUP-ID="text",LANGUAGE="en",NAME="Rich captions",DEFAULT=NO,AUTOSELECT=YES,CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound"
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="descriptions.m3u8",GROUP-ID="text",LANGUAGE="en",NAME="Description text",DEFAULT=NO,AUTOSELECT=YES,CHARACTERISTICS="public.accessibility.describes-video"

#EXT-X-STREAM-INF:BANDWIDTH=3200000,AVERAGE-BANDWIDTH=2400000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=25.000,AUDIO="audio",SUBTITLES="text"
video.m3u8
```

## Appendix C — `test/fixtures/hls/angel-one-master.m3u8` (verbatim)

```
#EXTM3U
## Generated with https://github.com/google/shaka-packager version v2.3.0-5bf8ad5-release

#EXT-X-MEDIA:TYPE=AUDIO,URI="playlist_a-eng-0128k-aac-2c.mp4.m3u8",GROUP-ID="default-audio-group",LANGUAGE="en",NAME="stream_5",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,URI="playlist_a-deu-0128k-aac-2c.mp4.m3u8",GROUP-ID="default-audio-group",LANGUAGE="de",NAME="stream_4",AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,URI="playlist_a-ita-0128k-aac-2c.mp4.m3u8",GROUP-ID="default-audio-group",LANGUAGE="it",NAME="stream_8",AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,URI="playlist_a-fra-0128k-aac-2c.mp4.m3u8",GROUP-ID="default-audio-group",LANGUAGE="fr",NAME="stream_7",AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,URI="playlist_a-spa-0128k-aac-2c.mp4.m3u8",GROUP-ID="default-audio-group",LANGUAGE="es",NAME="stream_9",AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,URI="playlist_a-eng-0384k-aac-6c.mp4.m3u8",GROUP-ID="default-audio-group",LANGUAGE="en",NAME="stream_6",CHANNELS="6"

#EXT-X-MEDIA:TYPE=SUBTITLES,URI="playlist_s-en.webvtt.m3u8",GROUP-ID="default-text-group",LANGUAGE="en",NAME="stream_0",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="playlist_s-el.webvtt.m3u8",GROUP-ID="default-text-group",LANGUAGE="el",NAME="stream_1",AUTOSELECT=YES
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="playlist_s-fr.webvtt.m3u8",GROUP-ID="default-text-group",LANGUAGE="fr",NAME="stream_2",AUTOSELECT=YES
#EXT-X-MEDIA:TYPE=SUBTITLES,URI="playlist_s-pt-BR.webvtt.m3u8",GROUP-ID="default-text-group",LANGUAGE="pt-BR",NAME="stream_3",AUTOSELECT=YES

#EXT-X-STREAM-INF:BANDWIDTH=8062646,AVERAGE-BANDWIDTH=1824731,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=768x576,AUDIO="default-audio-group",SUBTITLES="default-text-group"
playlist_v-0576p-1400k-libx264.mp4.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6096050,AVERAGE-BANDWIDTH=1410993,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=640x480,AUDIO="default-audio-group",SUBTITLES="default-text-group"
playlist_v-0480p-1000k-libx264.mp4.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4005148,AVERAGE-BANDWIDTH=1146764,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=480x360,AUDIO="default-audio-group",SUBTITLES="default-text-group"
playlist_v-0360p-0750k-libx264.mp4.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2190444,AVERAGE-BANDWIDTH=784019,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=320x240,AUDIO="default-audio-group",SUBTITLES="default-text-group"
playlist_v-0240p-0400k-libx264.mp4.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=827972,AVERAGE-BANDWIDTH=482170,CODECS="avc1.42c01e,mp4a.40.2",RESOLUTION=192x144,AUDIO="default-audio-group",SUBTITLES="default-text-group"
playlist_v-0144p-0100k-libx264.mp4.m3u8
```

## Sources

- RFC 8216, HTTP Live Streaming: §4.1 playlist file, §4.2 attribute lists, §4.3.4.1 `EXT-X-MEDIA`,
  §4.3.4.2 `EXT-X-STREAM-INF` — https://datatracker.ietf.org/doc/html/rfc8216
- RFC 3986 §5.2 reference resolution — https://datatracker.ietf.org/doc/html/rfc3986#section-5.2
- HLS Authoring Specification for Apple Devices (accessibility UTIs) —
  https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices
- Apple HLS examples index (bipbop advanced) — https://developer.apple.com/streaming/examples/
- Shaka Packager master playlist writer —
  https://github.com/shaka-project/shaka-packager/blob/main/packager/hls/base/master_playlist.cc
- Shaka Packager HLS tutorial / stream descriptor fields (`hls_characteristics`) —
  https://shaka-project.github.io/shaka-packager/html/tutorials/hls.html,
  https://shaka-project.github.io/shaka-packager/html/documentation.html
- react-native-video `source` prop (headers go to the HTTP client) —
  https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/
- React Native `URL` polyfill — `node_modules/react-native/Libraries/Blob/URL.js` (0.81.0, lines 80–119)
- In-repo: `docs/decisions/0002-vega-media-surface.md`, `docs/decisions/0003-text-selection-defaults.md`,
  `docs/spike-runbook.md` §3, §5 N4, §6; `TASKS.md` "KIT-002/003/004 detail"; `CLAUDE.md`.
