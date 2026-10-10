# KIT-036 — VTT timestamps: anchored, range-checked, round-trip past 99 h

**Role chain:** Planner (opus, this document) → Implementer (opus) → Reviewer.
**Protocol:** `docs/ORCHESTRATOR.md` §3 (loop), §4 (invariants).
**Status:** ready for an implementer. No blocking questions (§9). No public type or signature changes, so no decision
record is needed. The grammar rule in §2 is worth one line in the changeset.

Goal in one sentence: `parseTimestamp` accepts exactly what a conforming WebVTT parser accepts, plus SRT's `,`, and
returns `null` for everything else. `formatTimestamp` → `parseTimestamp` is then the identity on whole milliseconds
at any hour count, and `parseVtt` drops a cue whose timing does not parse, as it already does for other junk.

---

## 0. Decisions at a glance

| # | Question | Decision |
|---|---|---|
| 1 | Which grammar? | The **parser** algorithm, W3C WebVTT 1 §6.3 *collect a WebVTT timestamp* (https://www.w3.org/TR/webvtt1/#collect-a-webvtt-timestamp), not the stricter authoring syntax in §4.1 (https://www.w3.org/TR/webvtt1/#webvtt-timestamp). The difference: §6.3 accepts a one-digit hours field (`5:00:00.000`), and §4.1 requires hours to be two or more digits. We follow what browsers accept, so the overlay agrees with a native renderer. |
| 2 | SRT `,` separator | **Keep the leniency.** `parseVtt` deliberately tolerates headerless "SRT-ish" files (`vtt.ts:107`), and an existing test pins `01:02,500`. Lingo's `prepare --cues` reads hand-edited files, and the Internet Archive ships `.srt` files for the Lingo clips (`lingo/docs/content.md`, `LING-008`). A `,` never changes the value it reads, so keeping it is safe. |
| 3 | What becomes strict | Anchoring (`^…$` after `trim()`), a fraction of exactly 3 digits, minutes and seconds of exactly 2 digits each and each ≤ 59, no sign, no trailing junk, and a millisecond total that is a safe integer. In each of these cases the current code returns a **wrong number** (`100:00:00.000` → 0, `-00:00:01.000` → 1, `00:00:01.0005` → 1, `60:00.000` → 3600). Being strict fixes wrong values. It does not police style. |
| 4 | Malformed timestamp in `parseVtt` | **That cue is dropped**, and the file is not rejected. This matches the spec: §6.1 says "Collect WebVTT cue timings and settings … If that fails, let cue be null". It is also what `parseVtt` already does when `parseTimestampMs` returns `null`, so the control flow does not change. No throw, no partial file. |
| 5 | Diagnostics (`lintCues` warning?) | **None in this ticket.** `lintCues` takes `Cue[]`, and a dropped cue never reaches it. Reporting one would need a new channel (a return-type change or a `ParseOptions.onInvalid` callback). That is an interface change, so it is out of scope. Non-blocking question Q2. |
| 6 | `joinVttSegments` | No code change. It shares `parseTimestampMs`, so a block whose timing is malformed now passes through verbatim, as decision 0006 already says unparseable blocks do, and `parseVtt` then drops it. Blocks past 99 h are now keyed on their real time and no longer collide at hour 0. |
| 7 | Changeset | **patch** (§7). |

---

## 1. Current behaviour (main `efefa95`)

`src/core/vtt.ts:17`:
```ts
const TIME_RE = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{3})/
```
Because `exec` is unanchored, it matches the first substring that fits anywhere in the trimmed input:

| Input | Today | Why |
|---|---|---|
| `100:00:00.000` | `0` | Matches the substring `00:00.000` starting at index 1 |
| `123:45:06.000` | `23*3600+45*60+6` | Leading digit dropped |
| `-00:00:01.000` | `1` | Sign ignored |
| `00:00:01.0005` | `1` | Fourth fraction digit ignored |
| `00:00:01.000x`, `x00:00:01.000` | `1` | Junk ignored |
| `00:60:00.000`, `00:00:60.000` | `3600`, `60` | No range check |
| `60:00.000` (no hours) | `3600` | No range check (§6.3: a first field > 59 is hours, so a third field is required → error) |
| `1:02.500` | `62.5` | One-digit minutes (§6.3: a one-character first field is hours → error) |

`formatTimestamp` prints `100:00:00.000` for 360000 s, so `parseTimestamp(formatTimestamp(t))` is wrong for every
`t ≥ 360000` (≥ 100 h).

Other `TIME_RE`/`parseTimestampMs` users: only `parseVtt` (`:132`, `:134`) and `joinVttSegments` (`:222`, `:224`).
`cleanText`'s inline-timestamp strip (`:70`) has its own regex and is a non-goal (§8).

---

## 2. Accepted / rejected grammar

After `s.trim()` (unchanged; note that `trim()` also strips U+FEFF, so a BOM before a headerless first cue still
parses), the **whole** string must match:

```
^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$
```
and then: `minutes ≤ 59`, `seconds ≤ 59`, `Number.isSafeInteger(totalMs)`. Hours are unbounded in digit count,
can be a single digit, and may have leading zeros.

This regex is equivalent to §6.3 for every input §6.3 accepts. Here is why `5:00.000` and `100:00.000` are
rejected. The optional hours group needs two more fields after it, so the regex backtracks to the two-field form.
That form requires exactly two minute digits, which those strings do not have, so neither matches. §6.3 rejects
them the same way, by promoting the first field to hours.

| Input | Result | Rule |
|---|---|---|
| `00:01:02.500` | 62.5 | canonical |
| `01:02.500` | 62.5 | two-field form (§6.3) |
| `01:02,500`, `00:01:02,500` | 62.5 | **lenient**: SRT `,` |
| `5:00:00.000` | 18000 | one-digit hours (§6.3 accepts, §4.1 does not) |
| `99:59:59.999` | 359999.999 | |
| `100:00:00.000` | 360000 | **fixed** (was 0) |
| `999:59:59.999` | 3599999.999 | |
| `0100:00:00.000` | 360000 | hours with a leading zero |
| `  00:00:01.000  `, `﻿00:00:01.000` | 1 | `trim()` (unchanged) |
| `-00:00:01.000`, `+00:00:01.000` | null | sign |
| `00:00:01.0005`, `00:00:01.00`, `00:00:01` | null | fraction must be exactly 3 digits |
| `00:60:00.000`, `00:00:60.000`, `60:00.000` | null | minutes/seconds ≤ 59 |
| `1:02.500`, `00:1:02.500`, `00:01:2.500` | null | minutes and seconds are exactly 2 digits |
| `100:00.000` | null | 3-digit first field = hours (§6.3) → seconds missing |
| `00:00:01.000x`, `x00:00:01.000`, `00:00:01.000 00:00:02.000` | null | anchored |
| `00:00:01:000`, `00.00.01.000` | null | separators |
| `99999999999999:00:00.000` | null | total not a safe integer |
| `''`, `garbage` | null | unchanged |

---

## 3. Behaviour rules

1. **R1** `parseTimestamp(s)` returns `ms / 1000` exactly (KIT-030 contract) for every input in §2's accepted
   rows, and `null` for every rejected row. It never throws.
2. **R2** For every integer `ms` with `0 ≤ ms ≤ 999 h` (and beyond, up to the safe-integer limit),
   `parseTimestamp(formatTimestamp(ms / 1000)) === ms / 1000`. For every canonical string `s` that `formatTimestamp`
   can produce, `formatTimestamp(parseTimestamp(s)!) === s`.
3. **R3** `parseVtt` drops a cue whose start or end timestamp is rejected. The cues before and after it parse
   unchanged, `autoId` is not consumed for the dropped cue (unchanged), and nothing is thrown. The control flow
   (`vtt.ts:135-138`) does not change. Only the predicate does.
4. **R4** `joinVttSegments` passes a block with a rejected timing through verbatim (decision 0006 rule,
   unchanged code).
5. **R5** `parseVtt(serializeVtt(cues))` keeps `start`/`end` for cues at or past 100 h.
6. **R6** The timing line is still split leniently: `-->` with or without surrounding spaces, and settings after
   the end timestamp. Only the timestamp tokens themselves become strict.

---

## 4. Files

| File | Change |
|---|---|
| `src/core/vtt.ts` | `TIME_RE` → `/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/`. `parseTimestampMs`: after the match, return `null` if `min > 59 \|\| sec > 59` or if the total is not `Number.isSafeInteger`. Keep `.trim()` and integer arithmetic. Update the file doc comment (`:4-8`) to say: timestamps per WebVTT §6.3 plus `,` for SRT, malformed timings drop the cue. `ParseOptions.mergeGap` doc (`:13`) → `Merge a gap strictly smaller than this (seconds, compared in whole milliseconds) into the previous cue's end. Default 0.04 (1 frame at 25fps).` Optionally, for symmetry, give `minDuration` the "(rounded to whole ms)" wording. |
| `test/vtt.test.ts` | Move `expect(cues[1]!.end).toBeLessThanOrEqual(cues[2]!.start)` from "merges a gap below mergeGap…" (`:102`) into "extends too-short cues to the minimum duration without overlapping the next" (`:79`), where it belongs (the non-overlap half of that test's name). Add the tests in §5. |
| `.changeset/kit-036-vtt-timestamp-strictness.md` | New, patch (§7). |

Nothing in `src/player`, `src/adapters`, `src/cues`, the harness, or any app.

---

## 5. Tests (`test/vtt.test.ts`, vitest)

`describe('timestamps')`:
- `it('accepts the WebVTT §6.3 timestamp forms, and SRT commas')`: every accepted row of §2, asserting `toBe(value)`.
- `it('rejects malformed timestamps: sign, fraction not 3 digits, minutes or seconds ≥ 60, wrong field widths, junk around')`: every rejected row of §2 → `toBeNull()`. Collect failures into an array and `toEqual([])` so one run lists them all.
- `it('parses 100 h and more instead of reading the trailing digits (100:00:00.000 → 360000)')`: `100:00:00.000`, `123:45:06.789`, `999:59:59.999`, `1000:00:00.000`.
- `it('rejects a timestamp whose millisecond total is not a safe integer')`
- `it('formatTimestamp → parseTimestamp round-trips every sampled millisecond up to 999 h')`: a **property test without a new dependency** (no fast-check in devDeps). Samples:
  - `±2000 ms` around every hour boundary `h ∈ {0, 1, 9, 10, 99, 100, 101, 998, 999}`, plus around `h:59:59.999`.
  - 20 000 values from a seeded LCG (a fixed seed in the test) over `[0, 1000 · 3_600_000)`.

  Assert `parseTimestamp(formatTimestamp(ms / 1000)) === ms / 1000` and `formatTimestamp(parseTimestamp(s)!) === s`
  with `s = formatTimestamp(ms / 1000)`. Collect the bad values and `toEqual([])`.
- `it('parseTimestamp → formatTimestamp reproduces canonical strings, including 3-digit hours')`: a short explicit list (`00:00:00.000`, `99:59:59.999`, `100:00:00.000`, `999:59:59.999`).

`describe('parseVtt')`:
- `it('extends too-short cues to the minimum duration without overlapping the next')`: existing test plus the moved assertion.
- `it('merges a gap below mergeGap and never one of exactly mergeGap, by whole milliseconds')`: existing test minus the moved assertion.
- `it('drops a cue with a malformed timestamp and keeps its neighbours')`: three cues where the middle one uses each of `-00:00:02.000`, `00:00:02.0000`, `00:00:60.000`, `60:00.000` in turn (one `parseVtt` per variant). Expect texts `['A', 'C']`, ids `['c1', 'c2']`, and start/end of A and C unchanged.
- `it('keeps the time of a cue at or past 100 h (was parsed as hour 0)')`: `100:00:01.000 --> 100:00:03.000` → `[360001, 360003]`.
- `it('still parses a headerless first cue after a BOM')`: `'﻿00:00:01.000 --> 00:00:02.000\nHi'` → one cue, start 1. Guards the `trim()`/BOM interaction that anchoring would otherwise break.
- Keep `it('tolerates missing header and junk blocks')` unchanged.

`describe('serializeVtt')`:
- `it('serializeVtt → parseVtt keeps start and end past 99 h')`: cues at 359999.999, 360000, 3599999.999 with `minDuration: 0, mergeGap: 0`.

`describe('joinVttSegments')`:
- `it('passes a block with a malformed timestamp through verbatim and does not use it as a de-dupe key')`: segment 1 has `-00:00:01.000 --> 00:00:02.000\nX`, and segment 2 has a valid `00:00:01.000 --> 00:00:02.000\nX`. Both are kept. Today the malformed block parses as `[1000, 2000]` and wrongly suppresses the valid one.

Existing tests that must still pass unchanged: everything in `test/vtt.test.ts` and `test/hls-load.test.ts`
(canonical timestamps only), and the `fmt(ms, hours)` helpers (two-digit fields).

---

## 6. Mutation table (implementer applies each by hand, confirms a named test fails, then reverts)

| # | Mutation in `src/core/vtt.ts` | Killed by |
|---|---|---|
| M1 | Drop `^` | rejects malformed… (`x00:00:01.000`, `-00:00:01.000`); parses 100 h…; round-trip ≥ 100 h |
| M2 | Drop `$` | rejects malformed… (`00:00:01.0005`, `00:00:01.000x`) |
| M3 | Hours `\d+` → `\d{1,2}` | parses 100 h…; round-trip; keeps the time of a cue at or past 100 h; serializeVtt → parseVtt past 99 h |
| M4 | Drop `min > 59` | rejects… (`00:60:00.000`, `60:00.000`); drops a cue with a malformed timestamp (60:00.000 variant) |
| M5 | Drop `sec > 59` | rejects… (`00:00:60.000`); drops a cue … (00:00:60.000 variant) |
| M6 | Minutes `\d{2}` → `\d{1,2}` | rejects… (`1:02.500`, `00:1:02.500`) |
| M7 | `[.,]` → `\.` | accepts … SRT commas; existing "parses HH:MM:SS.mmm and MM:SS.mmm" |
| M8 | Drop the safe-integer guard | rejects a timestamp whose millisecond total is not a safe integer |
| M9 | Drop `.trim()` | still parses a headerless first cue after a BOM; accepts… (padded row) |
| M10 | `parseVtt`: on null timing, `throw` / `return []` instead of `continue` | drops a cue with a malformed timestamp and keeps its neighbours |
| M11 | `joinVttSegments`: treat a null timing as `[0,0]` instead of verbatim | passes a block with a malformed timestamp through verbatim… |

---

## 7. Changeset

`.changeset/kit-036-vtt-timestamp-strictness.md`, **patch**:

> **WebVTT timestamps are parsed strictly, and times past 99 h round-trip.** `parseTimestamp`, `parseVtt` and
> `joinVttSegments` read a timestamp only when the whole token is a WebVTT timestamp (W3C WebVTT §6.3), with `,`
> still accepted as the fraction separator for SRT-style files. Previously the first plausible substring was read,
> so `100:00:00.000` parsed as `0` and serialized cues past 99 h came back at the wrong time. Malformed timestamps
> also gave wrong values: a leading `-` was ignored, a fourth fraction digit was dropped, and minutes or seconds of
> 60 or more were accepted. They are now rejected. `parseTimestamp` returns `null`, and `parseVtt` drops that cue
> and keeps the rest, as it already did for other unparseable timings. `MM:SS.mmm` needs two-digit minutes ≤ 59.

Patch rather than minor: there are no API or type changes, and every input whose behaviour changes was previously
turned into a wrong time. Pre-1.0, so a minor would also be defensible (Q1).

---

## 8. Risks and non-goals

- **Consumer inputs (checked on 2026-10-10).** Described: every VTT it parses is either `serializeVtt` output
  (`pipeline/src/cues.ts`, `apps/api/src/routes/titles.ts`, `steps/08-text.ts`) or Shaka Packager output
  (`pipeline/src/validate.ts`), and both use canonical `HH:MM:SS.mmm`. Lingo: `cuesToVtt` is `serializeVtt`. The
  only external input is `loadCuesVtt` (`prepare --cues`), a hand-edited file from a subtitle editor or an `.srt`.
  Both use two-digit fields, and `,` stays accepted. A scan of every `.vtt`/`.ts`/`.tsx`/`.mts` under
  `described/{packages,apps}`, `lingo/{packages,content}` and the kit's `test`/`src`/`harness` found no timing
  token that the new grammar rejects. **No known consumer breaks.**
- **Hand-written MM:SS files with minutes ≥ 60 or one-digit minutes** (`75:00.000`, `1:02.500`) now drop those cues
  where they used to parse. Browsers drop them too (§6.3), so the overlay and native rendering now agree. The only
  place this could surface is Lingo `--cues`, and `loadCuesVtt` throws on zero cues, so a wholly malformed file
  fails loudly. A partly malformed one loses cues silently (see Q2).
- **Silent drops.** The same as today for other junk. Q2 asks whether to surface them.
- **BOM.** A file starting `﻿` + timing still parses because `String.prototype.trim` removes U+FEFF. This is
  pinned by a test, because an anchored regex without `trim()` would lose that first cue.
- **Non-goals:** `end ≤ start` (the spec parser does not reject it, and `minDuration` already extends it); validating
  cue settings; `cleanText`'s inline `<hh:mm:ss.ttt>` strip (`vtt.ts:70`, `\d{1,2}` hours, no `MM:SS` form), which
  is a candidate follow-up ticket for the orchestrator; `formatTimestamp(NaN | Infinity)` prints `NaN:…`, which is a
  separate low-severity follow-up and not a timestamp-parsing bug; and Lingo's stale comment about float noise in
  `lingo/packages/pipeline/test/vtt.test.ts:25`, which predates KIT-030 and belongs to Lingo.

---

## 9. Open questions

**Blocking:** none.

**Non-blocking:**
- **Q1** Patch or minor? The plan says patch (wrong values fixed, no API change). The orchestrator may override.
- **Q2** Should `parseVtt` report dropped cues, for example through `ParseOptions.onInvalid?(line: string, lineNo: number)`?
  Lingo `--cues` would benefit, because an editor typo currently loses a cue silently. This is an interface addition,
  so it needs its own ticket and plan. It is not part of KIT-036.
- **Q3** Should we be stricter than §6.3 and reject one-digit hours (`5:00:00.000`), as §4.1 authoring syntax does?
  The plan says no: browsers accept it and the value is unambiguous.
