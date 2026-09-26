# KIT-026 — Captions render twice: de-duplicate cues repeated across HLS segment boundaries

**Role chain:** Planner (fable, this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3.2 (plan contents), §4 (invariants), §6 (escalation).
**Status:** ready for an implementer. Nothing here needs the human; §9 has one non-blocking product question
that belongs to KIT-014.

Goal in one sentence: a cue that HLS segmentation writes into two or three consecutive WebVTT segments reaches
`onCue` once, on every platform that goes through `fetchHlsVtt`, with the guard of record in the Playwright
harness against the real `KitPlayer` + `WebAdapter`.

---

## 0. Decisions at a glance

| # | Question | Decision |
|---|---|---|
| 1 | Cause | One mechanism explains **every** observed duplicate: `fetchHlsVtt` concatenates segments verbatim, and RFC 8216 §3.5 requires a cue to be present in every segment whose period it overlaps. No second mechanism exists (§1.4). |
| 2 | Where the fix lives | A new **pure** function `joinVttSegments(segments)` in `src/core/vtt.ts` (public via `./core`); `fetchHlsVtt` (`src/player/hls.ts:88`) calls it instead of its inline `map/replace/join`. Not in `parseVtt`, not in the scheduler, not in `CueOverlay` (§2.2). |
| 3 | The key | Settings + payload text, with cue **identifiers ignored** and timestamps compared as **integer milliseconds**. A block from a later segment is dropped when an earlier segment contributed a block with the same key whose interval **contains** it. Verbatim repeats (equal intervals) are the common case; the clipped repeat Shaka Packager v2.3.0 writes (§1.2) is the other. |
| 4 | Scope of the rule | **Across segments only.** Two identical blocks inside one segment are both kept; a bare `.vtt` body is never touched (it takes the existing early return). Same text at adjacent-but-different times (a *split* cue) is **not merged** (§2.3). |
| 5 | Public surface | New core export; `fetchHlsVtt`'s signature is unchanged and its output becomes canonical (`WEBVTT\n\n` + blocks joined by one blank line + `\n`). No change to `src/core/types.ts` or `src/player/types.ts`, so no decision record is required by §3.2; a short 0006 is recommended in §9 because the "never merge, never touch `parseVtt`" rule is non-obvious. |
| 6 | `CueOverlay` | Unchanged. Its index-suffixed key (`CueOverlay.tsx:109`) is not why duplicates rendered — the array had duplicates — and a defensive de-dupe in the overlay would hide the kit bug the harness must catch. |

---

## 1. Root causes, with evidence

### 1.1 Class A — verbatim boundary repeat (the spike stream, and every photographed Angel One line)

**Where.** `src/player/hls.ts:86-88`: segments are fetched and joined with only the `WEBVTT` /
`X-TIMESTAMP-MAP` header lines stripped. `src/core/vtt.ts:141-153`: `parseVtt` gives each occurrence its own
auto id (`c3`, `c4`). `src/core/vtt.ts:155-160`: the sort-and-clamp pass leaves both because it only clamps
when `a.start !== b.start`. `src/core/scheduler.ts:42-48`: both are collected (they have distinct ids, so the
`activeIds` set sees two entries). `src/cues/CueOverlay.tsx:127-128`: both are rendered.

**Evidence (run against the real code, 2026-09-26, `fetchHlsVtt` → `parseVtt` → `CueScheduler.update`):**

| Stream | Cue blocks joined | Unique `(start,end,text)` | `update(p)` |
|---|---|---|---|
| CloudFront spike `captions.m3u8` (Shaka Packager v3.9.3, 4 s segments) | 24 | 15 | `update(8)` → `c3` and `c4`, both `7–9.5 "CAP 3 …"` — the logcat line `["0",7,9.5,…]×2` exactly |
| Angel One `playlist_s-en.webvtt.m3u8` (Shaka Packager v2.3.0) | 29 | 16 | `update(33)` → `c13`,`c14` "sparsely populated / with intelligent life."; `update(60)` → `c28`,`c29` "Receiving an audio signal / from Angel One."; `update(45)` → **three** copies of `43.794–49.174` (a 5.4 s cue spans two boundaries: segments 11, 12, 13) |
| Angel One `playlist_s-fr.webvtt.m3u8` | 29 | 17 | `update(33)` → `c13`,`c14` "Population éparse / et forme de vie intelligente."; `update(60)` → `c28`,`c29` "Signal audio provenant d'Angel One." |

Both fr lines in the photo (`fireos-test4-two-tracks-duplicated.jpg`) sit in two consecutive segments
(`s-fr-s8`/`s9`, `s-fr-s15`/`s16`), byte-identical. The earlier claim that fr *splits* boundary cues instead
of repeating them is wrong for every line the photo shows; it was an observation of the one clipped cue in §1.2.

This is spec-conformant packaging, not a packager bug. RFC 8216 §3.5: *"Each WebVTT Segment MUST contain all
subtitle cues that are intended to be displayed during the period indicated by the segment EXTINF duration.
The start time offset and end time offset of each cue MUST indicate the total display time for that cue, even
if part of the cue time range is outside the Segment period."* Every HLS packager does this; Described's own
`09-package` output does it (15 source cues → 24 segment cues per track). A client that concatenates segments
must undo it.

### 1.2 Class B — clipped repeat (Angel One fr, first cue only)

`s-fr-s1.vtt` has `00:00:03.837 --> 00:00:07.300`; `s-fr-s2.vtt` repeats the same text as
`00:00:04.000 --> 00:00:07.300` (start clipped to the segment start, violating the sentence quoted above;
`s-en-s2` does not do this — a v2.3.0 quirk). Today `parseVtt`'s clamp (`vtt.ts:159`) truncates the first copy to
`3.837–4.000` and the second shows `4.000–7.300`, so the line is **not** doubled on screen — it is one cue rendered
as two back-to-back cues with an `onCue` change at 4.0 s. The containment rule in §2.1 folds it into one cue
for free; it is not why anything rendered twice.

### 1.3 Class C — "unselected track '2' delivered" (evidence 4) is not a duplicate and not a kit bug

`preferredText={{ languages: ['fr', 'en'] }}` with `kinds` omitted: `autoSelectedTextIds`
(`src/player/selection.ts:65-68`) → `pickText` (`src/core/tracks.ts:133-142`) matches **every** `en` track,
and all three spike tracks (captions `'0'`, SDH `'1'`, descriptions `'2'`) are `en`. So the kit selected
`['0','1','2']` on the first `onTracks` — decision 0003's "an omitted key means any", by design. The harness HUD
seeded `selText` from the *first* track per language (`KitSpikeScreen.tsx:57`, `t.text.find(...)`), i.e. `['0']`,
so the checkboxes lied about what the kit had selected. That is the harness artefact.

After the user toggled to `['0','1']`, `KitPlayer.selectText` (`KitPlayer.tsx:47-58`) pruned `'2'` from the
scheduler and re-evaluated, and `acceptsTextTrackData` (`KitPlayer.tsx:107`, `selection.ts:38-45`) refuses any
in-flight VTT for `'2'` from the first fetch loop. From the code there is **no** path by which a `'2'` cue is
emitted after that `selectText` line. The orchestrator confirms the ordering from logcat (§7 step 4); if a
`cue` line containing `"2"` follows the `selectText ["0","1"]` line, that is a new ticket with the log attached.

The product footgun underneath — a languages-only preference turns on description tracks — is KIT-014's area
(§9).

### 1.4 Ruled out

- **Double `selectText` / `setTrack`.** `appliedPrefs` latches (`KitPlayer.tsx:65-66`), so `preferredText`
  selects once; an explicit `selectText` re-fetches, but `CueScheduler.setTrack` **replaces** the track
  (`scheduler.ts:17`, `Map.set`), so a second delivery for the same id cannot add cues.
- **Fire OS adapter delivering `onTextTrackData` twice.** One delivery per id per `selectText`
  (`fireos.tsx:39-48`); `onLoad` fires once per prepare and is latched anyway.
- **Scheduler not replacing a track.** Same point; `byTrack` is keyed by track id.
- **Cross-track.** Each duplicate pair in the logcat line shares one `trackId`; multi-track stacking is the
  feature working (`CLAUDE.md`).

---

## 2. The fix

### 2.1 `joinVttSegments` — `src/core/vtt.ts` (public via `./core`)

```ts
/**
 * One WebVTT body from the segments of an HLS subtitle media playlist (RFC 8216 §3.5), in playlist order.
 * Each segment's header block (`WEBVTT`, `X-TIMESTAMP-MAP`, any other header lines) is dropped and one header
 * is written. A cue that spans a segment boundary is, by that RFC, present in every segment it overlaps; a cue
 * block from a later segment is therefore dropped when an earlier segment already contributed a block with
 * the same settings and payload whose interval contains it (identifiers ignored; timestamps compared in whole
 * milliseconds). Nothing else changes: blocks inside one segment never suppress each other, non-cue blocks
 * (NOTE/STYLE/REGION, unparseable timings) pass through verbatim, and same-text cues at different times are
 * kept — the kit does not merge split cues.
 */
export function joinVttSegments(segments: readonly string[]): string
```

Algorithm (the implementer follows this verbatim; no other behaviour):

1. Per segment: strip a leading `﻿`, normalise `\r\n?` → `\n`, split into blocks on blank lines
   (`/\n[ \t]*\n+/`), trim each block, drop empty blocks. If the first block starts with `WEBVTT`, drop it (this
   is the whole header block, including `X-TIMESTAMP-MAP` and any further header metadata lines).
2. For each remaining block: `ti = lines.findIndex(l => l.includes('-->'))`. If `ti < 0` → non-cue block:
   keep. Otherwise `timing = lines[ti]`; `start = parseTimestamp(timing.split('-->')[0])`;
   `rest = timing.split('-->')[1].trim().split(/\s+/)`; `end = parseTimestamp(rest[0])`;
   `settings = rest.slice(1).join(' ')`; `payload = lines.slice(ti + 1).join('\n').trim()`. If `start` or `end`
   is `null` → keep, never de-duplicate. Lines before `ti` are the identifier and are **not** part of the key.
3. `key = settings + '\n' + payload`; `s = Math.round(start * 1000)`, `e = Math.round(end * 1000)`.
   Drop the block iff `seen.get(key)` has an interval `[S, E]` with `S <= s && e <= E`. `seen` holds only
   intervals from **earlier segments**: collect this segment's `(key, [s, e])` pairs in a local list and
   merge them into `seen` after the segment is processed.
4. Output: `'WEBVTT\n\n' + kept.join('\n\n') + '\n'`; with no blocks, `'WEBVTT\n'`. Kept blocks are emitted
   byte-for-byte (identifiers, settings, payload untouched).

Cost: one `Map<string, Array<[number, number]>>` per join; a few hundred blocks at most.

### 2.2 `fetchHlsVtt` — `src/player/hls.ts:81-89`

Line 88 becomes `return joinVttSegments(parts)`; import `joinVttSegments` from `'../core'`. The bare-VTT early
return (line 84), the media-playlist detection and the `base + l` segment resolution (KIT-002 §9 Q5, deliberately
unfixed) are untouched. Update the doc comment on line 80: "segments joined; headers de-duplicated; cues repeated
across segment boundaries dropped (RFC 8216 §3.5)".

Why here and not elsewhere:

- **Not `parseVtt`.** `parseVtt` is public and `described/packages/pipeline/work/dry-pack.mts:19` parses a
  *single* packaged segment with it. Changing what a parse of one file returns is a public behaviour change with
  no need behind it; the repetition is a segmentation artefact and is undone where segments are joined.
- **In `src/core`, not only in `src/player/hls.ts`.** `CLAUDE.md`: core runs in Node for media pipelines.
  Described's pipeline already imports core in four files and will want to read its own packaged output back
  (`dry-pack.mts` is that, one segment at a time today). A pure join is the reusable piece; the fetch is not.
- **Not the scheduler, not `CueOverlay`.** The scheduler keys on `trackId:id` and must keep emitting distinct
  cues with identical text at identical times when a *track* differs (two languages); the overlay renders what
  it is handed. A de-dupe in either would mask the data defect from the harness.

### 2.3 Rules the implementer must not "improve"

- **Do not merge split cues** (same text, adjacent times). Nothing we ship splits; deciding that "No." at 10–11
  and "No." at 11–12 are one cue is a content edit, not a transport fix. `parseVtt`'s `mergeGap`/clamp already
  keeps adjacent cues from stacking.
- **Do not de-duplicate within a segment** or in a bare `.vtt`. The kit undoes what segmentation added and
  nothing the author wrote.
- **Do not renumber identifiers or rewrite timing lines.** Blocks are kept verbatim; only dropped or not.

### 2.4 Interactions

- **KIT-030 (float timestamps).** The key uses `Math.round(t * 1000)` from `parseTimestamp`, never the raw
  float, so `00:07.000` and `00:00:07.000` compare equal and `3.8369999999999997` is a stable `3837`. When
  KIT-030 rounds inside `parseTimestamp`, this code is unaffected.
- **KIT-021 (scheduler same-id).** Unrelated mechanism, but note for its implementer: because this join keeps
  identifiers verbatim, a packager that restarts identifiers per segment yields repeated ids within one track,
  which is exactly the `trackId:id` collision KIT-021 has to survive. This plan does not touch `scheduler.ts`.
- **KIT-011/019 source reset, KIT-009 gate.** Untouched; the fix is upstream of `onTextTrackData`.
- **Vega.** Shaka delivers its own cues there; experimental per decision 0001; untouched.

---

## 3. Files

| File | Change |
|---|---|
| `src/core/vtt.ts` | **Add** `joinVttSegments` (§2.1). Nothing else in the file changes. |
| `src/player/hls.ts` | `fetchHlsVtt` line 88 → `joinVttSegments(parts)`; import; doc comment. |
| `test/vtt.test.ts` | **Add** `describe('joinVttSegments')` (§5.1). |
| `test/fixtures/hls/shaka-packager-3.9.3-captions/captions.m3u8`, `1.vtt` … `15.vtt` | **New**, verbatim from Described's own packaged spike stream (Appendix A — our synthetic "CAP n" text, no third-party content). |
| `test/hls-load.test.ts` | Update the pinned join expectation (§5.2); add one `fetchHlsVtt` de-dupe test. Leave the Q5 `base + l` pins alone. |
| `harness/fixtures/stream/master-c.m3u8`, `subs-c/en/{index.m3u8,seg-0.vtt,seg-1.vtt,seg-2.vtt}`, `subs-c/de/{…}` | **New** (§5.3, verbatim). |
| `harness/e2e/helpers.ts` | Lines 41, 61, 63: `master(-b)?` → `master(-[bc])?` (three occurrences), and the comment at line 40-41 gains "`master-c` repeats cues across segment boundaries (KIT-026)". |
| `harness/e2e/player.spec.ts` | **Add** the spec in §5.3; extend the file header comment with "spec 24 (KIT-026)". |
| `docs/getting-started.md:22-24` | Append one sentence: "Cues that a packager repeats across segment boundaries (RFC 8216 §3.5) are delivered once." |
| `.changeset/release-0-1-0.md` | Append the paragraph in §4.2 (the repo folds every 0.1.0 change into this one file since `d36b2bc`). |

Not touched: `src/core/types.ts`, `src/player/types.ts`, `src/core/scheduler.ts`, `src/cues/CueOverlay.tsx`,
the adapters, `package.json` (another agent owns KIT-027 there), `TASKS.md`.

---

## 4. Interfaces

### 4.1 Typed

```ts
// src/core/vtt.ts — new; exported through src/core/index.ts's existing `export * from './vtt'`
export function joinVttSegments(segments: readonly string[]): string
// src/player/hls.ts — unchanged signature
export async function fetchHlsVtt(url: string): Promise<string>
```

No type in `src/core/types.ts` or `src/player/types.ts` moves. `Cue` is unchanged.

### 4.2 Changeset paragraph (append to `.changeset/release-0-1-0.md`, bump stays as is)

> **Captions no longer render twice at segment boundaries.** HLS requires a WebVTT cue that spans a segment
> boundary to be written into every segment it overlaps (RFC 8216 §3.5); `fetchHlsVtt` concatenated the
> segments verbatim, so on Fire OS and web every such cue reached `onCue` twice — three times when it spanned two
> boundaries — and `CueOverlay` drew each line twice. Segments are now joined by the new core function
> `joinVttSegments`, which drops a cue block that an earlier segment already contributed (same settings and
> text, interval contained; identifiers ignored; timestamps compared in whole milliseconds). Nothing is merged:
> same-text cues at different times, identical blocks inside one segment, and bare `.vtt` bodies are unchanged.
> `fetchHlsVtt`'s output is now canonical (`WEBVTT`, one blank line between blocks, trailing newline).
> Multi-track text selection is unchanged.

---

## 5. Acceptance tests

Tests first (§6). Every new test must be run **red** against `HEAD` before the fix and the red output kept for
the reviewer; the repo has been fooled four times by tests that guard a copy of the logic.

### 5.1 `test/vtt.test.ts` — `describe('joinVttSegments')` (pure, Node)

Inline segments unless a fixture is named. `seg = (…blocks) => 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n' + blocks.join('\n\n')`.

- `it('writes one WEBVTT header and drops every per-segment header block, including X-TIMESTAMP-MAP and extra header lines')`
  — second segment's header is `WEBVTT\nKind: captions\nLanguage: en\nX-TIMESTAMP-MAP=…`; output matches
  `/^WEBVTT\n\n/`, contains neither `X-TIMESTAMP-MAP` nor `Kind:`, and `out.match(/WEBVTT/g)` has length 1.
- `it('drops a cue block repeated verbatim by the next segment (RFC 8216 §3.5 boundary repeat)')`
  — seg A: `00:00:04.000 --> 00:00:06.500\nTwo`, `00:00:07.000 --> 00:00:09.500\nThree`; seg B:
  `00:00:07.000 --> 00:00:09.500\nThree`, `00:00:10.000 --> 00:00:12.500\nFour`. Output is exactly
  `'WEBVTT\n\n' + [Two, Three, Four blocks].join('\n\n') + '\n'`; `parseVtt(out, …)` has 3 cues with ids `c1..c3`.
- `it('drops a cue repeated across three consecutive segments once per extra segment, keeping one')`
  — one 5.4 s cue in segments 1, 2 and 3 → exactly one block.
- `it('drops a repeat whose start was clipped to the segment boundary (same end and text, later start)')`
  — seg A `00:00:03.837 --> 00:00:07.300\nJournal`, seg B `00:00:04.000 --> 00:00:07.300\nJournal` → one block,
  the 3.837 one; `parseVtt` yields one cue `3.837–7.3`.
- `it('keeps a same-text cue whose interval is not contained (split cues are not merged)')`
  — seg A `00:00:03.500 --> 00:00:04.000\nSame`, seg B `00:00:04.000 --> 00:00:06.500\nSame` → two blocks.
- `it('never de-duplicates within a single segment')` — one segment with the same block twice → two blocks.
- `it('ignores cue identifiers when matching a repeat')` — seg A `1\n00:00:07.000 --> 00:00:09.500\nX`,
  seg B `1\n00:00:07.000 --> 00:00:09.500\nX` and, separately, seg B with identifier `7` → one block either way,
  and the kept block still carries its identifier line.
- `it('treats a cue with different settings or different text as a different cue')` — `align:center` vs
  `align:start`; `X` vs `X.` → two blocks each.
- `it('compares timestamps in whole milliseconds, so 00:07.000 and 00:00:07.000 are the same time')`.
- `it('passes NOTE, STYLE and unparseable blocks through verbatim, in order')` — a `NOTE x` block and a block
  whose timing is `garbage --> more` appear unchanged in the output (both in segment A and B: kept twice, never
  matched).
- `it('returns "WEBVTT\\n" for no segments and for segments with only headers')`.
- `it('Shaka Packager v3.9.3 fixture: 15 segments carry 24 cue blocks and join to the 15 source cues')`
  — read `captions.m3u8` from the fixture, take its 15 segment names in order, read them, join; assert
  `(out.match(/-->/g) ?? []).length === 15`, and `parseVtt(out, { trackId: '0' }).map(c => [c.start, c.end, c.text])`
  equals the 15 rows in Appendix A's table verbatim (numbers, not "some").
- `it('the fixture is what the packager wrote: the same 15 segments concatenated hold 24 cue blocks')` — pins
  the fixture itself, so a "fixed" fixture cannot make the previous test pass vacuously.

### 5.2 `test/hls-load.test.ts` — `describe('fetchHlsVtt (moved, behaviour pinned)')`

- Update `it('joins media-playlist segments with one WEBVTT header and drops per-segment X-TIMESTAMP-MAP lines')`:
  expected body becomes `` `WEBVTT\n\n${cue0}\n\n${cue1}\n` ``; replace the "Pinned, not endorsed" comment with
  "Canonical join since KIT-026". The `seen` URL assertion (Q5 `base + l`) stays exactly as it is.
- `it('returns a bare WebVTT body unchanged')` and `it('leaves an absolute segment URL alone …')` stay as they are.
- **Add** `it('delivers a cue repeated in two consecutive segments once (KIT-026)')` — three stubbed segments in
  the Class A shape; `fetchHlsVtt` output has three cue blocks, and `seen` shows all three segment URLs were
  fetched (the de-dupe happened after the fetch, not by skipping a segment).

### 5.3 `harness/e2e/player.spec.ts` — spec 24, the guard of record (real `KitPlayer` + `WebAdapter` + `CueOverlay` in Chromium)

Fixtures, verbatim. 4 s segments over the 15 s WebM; both tracks carry the same shape so the two-track photo
case is reproduced; `de` text differs so the overlay boxes are distinguishable.

`harness/fixtures/stream/master-c.m3u8`
```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Deutsch",LANGUAGE="de",DEFAULT=NO,AUTOSELECT=YES,URI="subs-c/de/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subs-c/en/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=200000,CODECS="vp09.00.10.08",RESOLUTION=64x36,SUBTITLES="subs"
video/index.m3u8
```

`harness/fixtures/stream/subs-c/en/index.m3u8` (and `subs-c/de/index.m3u8`, identical)
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:4.000,
seg-0.vtt
#EXTINF:4.000,
seg-1.vtt
#EXTINF:4.000,
seg-2.vtt
#EXT-X-ENDLIST
```

`subs-c/en/seg-0.vtt`
```
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

00:00:01.000 --> 00:00:03.000
One

00:00:03.500 --> 00:00:06.500
Spans first boundary
```
`subs-c/en/seg-1.vtt` — the clipped repeat (Class B), then a cue that spans the next boundary
```
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

00:00:04.000 --> 00:00:06.500
Spans first boundary

00:00:07.000 --> 00:00:09.500
Spans second boundary
```
`subs-c/en/seg-2.vtt` — the verbatim repeat (Class A)
```
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

00:00:07.000 --> 00:00:09.500
Spans second boundary

00:00:10.000 --> 00:00:12.500
Four
```
`subs-c/de/seg-{0,1,2}.vtt`: same timings, payloads `Eins`, `Über die erste Grenze`, `Über die zweite Grenze`,
`Vier`.

After the fix each track parses to `c1 1–3`, `c2 3.5–6.5`, `c3 7–9.5`, `c4 10–12.5`. Before the fix each track
parses to six cues (`c2`/`c3` both "Spans first boundary" — `c2` clamped to `3.5–4`, `c3` `4–6.5` — and `c4`/`c5`
both "Spans second boundary", `7–9.5`), so `seek(8)` returns two ids per track and the overlay draws each line
twice: that is the red run.

```ts
test('a cue repeated across segment boundaries reaches onCue once and the overlay draws it once (KIT-026)', async ({ page }) => {
  const hits = await routeStream(page)
  await page.goto('/player.html?src=/stream/master-c&primary=0')
  await waitForTracks(page)
  await selectText(page, ['0', '1'])
  // Class A: the verbatim repeat in seg-1/seg-2. One cue per track, one box per track, each text exactly once.
  await expect.poll(() => cueIds(page, 8).then((ids) => ids.sort())).toEqual(['0:c3', '1:c3'])
  const a = await page.evaluate(() => window.__kit.seekSnapshot(8))
  expect(a.ids.sort()).toEqual(['0:c3', '1:c3'])
  expect(a.boxes).toHaveLength(2)
  expect(a.boxes.map((b) => b.text)).toEqual(['Spans second boundary', 'Über die zweite Grenze']) // textContent: doubled text would read "…boundarySpans second boundary"
  // Class B: the clipped repeat in seg-0/seg-1 is one cue with the earlier start.
  const b = await page.evaluate(() => window.__kit.seekSnapshot(5))
  expect(b.ids.sort()).toEqual(['0:c2', '1:c2'])
  expect(b.boxes.map((x) => x.text)).toEqual(['Spans first boundary', 'Über die erste Grenze']) // before the fix: '0:c3'/'1:c3' here
  // Ids continue without gaps: the drop happened before parsing.
  expect((await cueIds(page, 11)).sort()).toEqual(['0:c4', '1:c4'])
  expect(await cueIds(page, 6.75)).toEqual([])
  // Every segment was fetched; the de-dupe is in the join, not in what was requested.
  for (const t of ['en', 'de']) for (const s of ['seg-0', 'seg-1', 'seg-2']) expect(hits).toContain(`fetch subs-c/${t}/${s}.vtt`)
})
```

`seekSnapshot` reads the bottom area's boxes in the same task as the seek (`harness/player.tsx:47-60`), so
`boxes[i].text` is the committed DOM text of each box; with `primary=0` the `en` (`'1'`) box is the secondary one
above and comes first in `boxes`, matching spec 13's ordering. If the implementer finds the order reversed on
the first green run, sort by `top` rather than weaken the equality.

Existing specs are unaffected: `master.m3u8`/`master-b.m3u8` and `MANIFEST_TRACKS` do not change.

### 5.4 Checks

`pnpm typecheck && pnpm test && pnpm lint && pnpm typecheck:harness && pnpm harness` all green; the harness
spec above and the §5.1/§5.2 tests shown red on `HEAD` first (paste the failing assertion lines into the
implementer's summary).

---

## 6. Order of work

1. Add the fixtures (§3, Appendix A, §5.3) and the `helpers.ts` regex change. Write §5.1, §5.2 (the new test
   and the updated pin) and §5.3. Run `pnpm test` and `pnpm harness` → the new tests and the updated pin are
   red; the old pin's failure message shows the doubled `c3`/`c4`. Keep the output.
2. Implement `joinVttSegments` in `src/core/vtt.ts` exactly per §2.1.
3. Wire `fetchHlsVtt` (§2.2). Run everything → green.
4. `docs/getting-started.md` sentence; changeset paragraph (§4.2).
5. Summary for the reviewer: red output from step 1, green output from step 3, the fixture provenance line
   (Appendix A), and anything not done.

---

## 7. How the orchestrator verifies on the Fire TV stick

Same rig as the spike (`docs/spike-runbook.md`; AFTSS, Fire OS 7.7.1.6; `adb logcat -s ReactNativeJS`, filter
`KIT-SPIKE`). The harness app is `react-native-multi-tv-app-sample`, screen `KitSpikeScreen.tsx`, consuming the
kit the way the spike did.

1. **Spike stream** (`URI` as committed: `…/spike/hls/master.m3u8`, `PREFERRED_TEXT = ['fr','en']`). Play from
   0 without touching the HUD. Expected `cue` lines at 7–9.5 s: `[["0",7,9.5,"CAP 3 …"],["1",7,9.5,"SDH …"],["2",7,9.5,"DESC 3 …"]]`
   — one entry per track. Mechanical check on the saved log:
   `grep 'KIT-SPIKE cue' log.txt | grep -c '"0",7,9.5.*"0",7,9.5'` → `0` (was ≥ 1). Repeat for `19,21.5` and
   `43,45.5`. Photo at ~8 s: three lines, none doubled.
2. **Angel One** (swap `URI`, set `SEEK_TARGET` back to `3.837`). Toggle so `sel` shows the en and fr ids, seek
   to 30 s, photo at ~33 s ("sparsely populated…" and "Population éparse…" once each) and at ~59 s ("Receiving
   an audio signal…" / "Signal audio provenant…" once each). `grep 'KIT-SPIKE cue' | grep -c '43.79.*43.79'` →
   `0` (was 3 copies per track at 45 s). At ~5 s the fr line shows once from 3.837 (no visible change at 4.0).
3. **Toggle path** (double `selectText`): with cues on screen, toggle a selected track off and on. Expected: no
   doubled line afterwards; each `cue` line still has one entry per selected track.
4. **Evidence 4 ordering**: in the spike-stream log, find the `selectText ["0","1"]` line. Every `cue` line
   *after* it must contain no `"2"` entries; `cue` lines *before* it contain `"2"` by decision 0003 (three `en`
   tracks match `languages: ['fr','en']`). If a `"2"` entry follows the `selectText` line, open a ticket with
   the log — that would be a kit bug this plan says cannot happen.
5. Re-tick the Fire OS row for test 4 / test 6 in `docs/device-matrix.md` with "single lines" noted, and file
   the photos under `~/hackathon/spike-evidence/` as before.

---

## 8. Risks

- **`fetchHlsVtt` output format changes** (public function). Only the two adapters consume it, and they hand
  it to `parseVtt`. The changeset says so; the old format was pinned "not endorsed".
- **A packager that re-wraps or re-encodes text between segments** (different payload bytes for the same cue)
  is not de-duplicated. Not observed in v2.3.0 or v3.9.3; the harness would show it as a doubled line, which is
  the right failure mode (loud, not silent).
- **Live/EVENT playlists.** `fetchHlsVtt` fetches once; unchanged, out of scope as in decision 0004.
- **Containment dropping a legitimate cue.** Requires a later *segment* to carry a same-settings, same-text cue
  strictly inside an earlier one's interval — identical text stacked twice on screen. No authoring use exists;
  cross-segment scoping keeps an author's in-file duplicates intact regardless.
- **Harness regex widening** (`master(-[bc])?`) touches the routing of every player spec. It is a superset;
  run the whole `pnpm harness`, not just the new spec.
- **Timing of `seekSnapshot` at 3.8 s** in §5.3: the assertion uses `cueIds` (scheduler truth), not the DOM, to
  avoid a flaky repaint dependency; keep it that way.

---

## 9. Open questions

**For the human — not blocking KIT-026; belongs with the KIT-014 decision.** Should a `preferredText` that
names only `languages` include `descriptions` tracks? Today it does (decision 0003: omitted `kinds` means any),
which is why the spike screen's `{ languages: ['fr','en'] }` switched on captions, SDH *and* descriptions at
once on a stream where all three are `en`. Television convention is that audio-description text is opt-in.
`described` is unaffected (it always passes `kinds`, `Player.tsx:48`). One line of guidance decides whether
KIT-014's fix adds "`kinds` defaults to every kind except `descriptions` when omitted" or leaves the rule as is.

**For the orchestrator (no human needed).** Record a short `docs/decisions/0006-segment-cue-dedupe.md` when
ticking the ticket: *the kit undoes RFC 8216 §3.5 cue repetition in `joinVttSegments` at the segment join, keyed
on settings + payload with identifiers ignored and timestamps in whole ms, cross-segment only, containment not
just equality; it never merges split cues, never de-duplicates inside one segment or a bare `.vtt`, and
`parseVtt`, the scheduler and `CueOverlay` stay as they are.* Reason it is worth a record: the next person who
sees a "split" cue will be tempted to add merging, and the next duplicate report will be tempted to key the
overlay — both are wrong for reasons that are only written here.

---

## Appendix A — `test/fixtures/hls/shaka-packager-3.9.3-captions/` (verbatim)

Provenance: Described's `09-package` (Shaka Packager v3.9.3-0a8ba4f-release, 4 s segments) over its own
synthetic caption file, published at `https://dco7qa0c4m1pw.cloudfront.net/spike/hls/captions.m3u8` on
2026-09-26. The text is ours; no third-party content. `sdh/` and `descriptions/` have the same 24-in-15 shape
and are not needed as fixtures.

Expected 15 source cues after the join, as `[start, end, text]` (the §5.1 fixture test asserts this list):

| # | start | end | text |
|---|---|---|---|
| 1 | 1 | 3.5 | `CAP 1 (1.0–3.5s)` |
| 2 | 4 | 6.5 | `CAP 2 (4.0–6.5s)` |
| 3 | 7 | 9.5 | `CAP 3 (7.0–9.5s) ⟂ boundary` |
| 4 | 10 | 12.5 | `CAP 4 (10.0–12.5s)` |
| 5 | 13 | 15.5 | `CAP 5 (13.0–15.5s)` |
| 6 | 19 | 21.5 | `CAP 6 (19.0–21.5s) ⟂ boundary` |
| 7 | 22 | 24.5 | `CAP 7 (22.0–24.5s)` |
| 8 | 25 | 27.5 | `CAP 8 (25.0–27.5s)` |
| 9 | 31 | 33.5 | `CAP 9 (31.0–33.5s) ⟂ boundary` |
| 10 | 34 | 36.5 | `CAP 10 (34.0–36.5s)` |
| 11 | 37 | 39.5 | `CAP 11 (37.0–39.5s)` |
| 12 | 43 | 45.5 | `CAP 12 (43.0–45.5s) ⟂ boundary` |
| 13 | 46 | 48.5 | `CAP 13 (46.0–48.5s)` |
| 14 | 49 | 51.5 | `CAP 14 (49.0–51.5s)` |
| 15 | 55 | 57.5 | `CAP 15 (55.0–57.5s) ⟂ boundary` |

(Verified against the files below on 2026-09-26: the 15 unique `(timing, text)` rows across the 15 segments
are exactly this table; every timing line also carries `align:center`, which `parseVtt` drops and the §2.1 key
keeps.)

Files follow, one fenced block each.

`captions.m3u8`
```
#EXTM3U
#EXT-X-VERSION:6
## Generated with https://github.com/shaka-project/shaka-packager version v3.9.3-0a8ba4f-release
#EXT-X-TARGETDURATION:5
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:4.000,
captions/1.vtt
#EXTINF:4.000,
captions/2.vtt
#EXTINF:4.000,
captions/3.vtt
#EXTINF:4.000,
captions/4.vtt
#EXTINF:4.000,
captions/5.vtt
#EXTINF:4.000,
captions/6.vtt
#EXTINF:4.000,
captions/7.vtt
#EXTINF:4.000,
captions/8.vtt
#EXTINF:4.000,
captions/9.vtt
#EXTINF:4.000,
captions/10.vtt
#EXTINF:4.000,
captions/11.vtt
#EXTINF:4.000,
captions/12.vtt
#EXTINF:4.000,
captions/13.vtt
#EXTINF:4.000,
captions/14.vtt
#EXTINF:4.000,
captions/15.vtt
#EXT-X-ENDLIST
```

`1.vtt`
```
WEBVTT

00:00:01.000 --> 00:00:03.500 align:center
CAP 1 (1.0–3.5s)

```

`2.vtt`
```
WEBVTT

00:00:04.000 --> 00:00:06.500 align:center
CAP 2 (4.0–6.5s)

00:00:07.000 --> 00:00:09.500 align:center
CAP 3 (7.0–9.5s) ⟂ boundary

```

`3.vtt`
```
WEBVTT

00:00:07.000 --> 00:00:09.500 align:center
CAP 3 (7.0–9.5s) ⟂ boundary

00:00:10.000 --> 00:00:12.500 align:center
CAP 4 (10.0–12.5s)

```

`4.vtt`
```
WEBVTT

00:00:10.000 --> 00:00:12.500 align:center
CAP 4 (10.0–12.5s)

00:00:13.000 --> 00:00:15.500 align:center
CAP 5 (13.0–15.5s)

```

`5.vtt`
```
WEBVTT

00:00:19.000 --> 00:00:21.500 align:center
CAP 6 (19.0–21.5s) ⟂ boundary

```

`6.vtt`
```
WEBVTT

00:00:19.000 --> 00:00:21.500 align:center
CAP 6 (19.0–21.5s) ⟂ boundary

00:00:22.000 --> 00:00:24.500 align:center
CAP 7 (22.0–24.5s)

```

`7.vtt`
```
WEBVTT

00:00:22.000 --> 00:00:24.500 align:center
CAP 7 (22.0–24.5s)

00:00:25.000 --> 00:00:27.500 align:center
CAP 8 (25.0–27.5s)

```

`8.vtt`
```
WEBVTT

00:00:31.000 --> 00:00:33.500 align:center
CAP 9 (31.0–33.5s) ⟂ boundary

```

`9.vtt`
```
WEBVTT

00:00:31.000 --> 00:00:33.500 align:center
CAP 9 (31.0–33.5s) ⟂ boundary

00:00:34.000 --> 00:00:36.500 align:center
CAP 10 (34.0–36.5s)

```

`10.vtt`
```
WEBVTT

00:00:34.000 --> 00:00:36.500 align:center
CAP 10 (34.0–36.5s)

00:00:37.000 --> 00:00:39.500 align:center
CAP 11 (37.0–39.5s)

```

`11.vtt`
```
WEBVTT

00:00:43.000 --> 00:00:45.500 align:center
CAP 12 (43.0–45.5s) ⟂ boundary

```

`12.vtt`
```
WEBVTT

00:00:43.000 --> 00:00:45.500 align:center
CAP 12 (43.0–45.5s) ⟂ boundary

00:00:46.000 --> 00:00:48.500 align:center
CAP 13 (46.0–48.5s)

```

`13.vtt`
```
WEBVTT

00:00:46.000 --> 00:00:48.500 align:center
CAP 13 (46.0–48.5s)

00:00:49.000 --> 00:00:51.500 align:center
CAP 14 (49.0–51.5s)

```

`14.vtt`
```
WEBVTT

00:00:55.000 --> 00:00:57.500 align:center
CAP 15 (55.0–57.5s) ⟂ boundary

```

`15.vtt`
```
WEBVTT

00:00:55.000 --> 00:00:57.500 align:center
CAP 15 (55.0–57.5s) ⟂ boundary

```
