# 0006 — Cues repeated across HLS segment boundaries are de-duplicated at the join, and nowhere else

**Date:** 2026-09-26
**Status:** accepted — orchestrator, under `docs/ORCHESTRATOR.md` §3.2; one new public function (`joinVttSegments` in `./core`), no type changes
**Ticket:** KIT-026 · **Plan:** `docs/plans/KIT-026-duplicate-cues.md`

## Context

On a Fire TV Stick every caption line near a segment boundary rendered twice, in every track, on both Shaka's
Angel One stream and Described's own `09-package` output. RFC 8216 §3.5 *requires* a WebVTT cue to appear in
every segment whose period it overlaps; Shaka Packager v3.9.3 with 4 s segments turned 15 source cues into 24
segment cues. `fetchHlsVtt` concatenated segments verbatim, `parseVtt` gave each copy its own id, the scheduler
emitted both and `CueOverlay` drew both. No second mechanism exists (plan §1.4).

## Decision

1. The kit undoes segmentation's repetition in one place: `joinVttSegments(segments)` in `src/core/vtt.ts`,
   called by `fetchHlsVtt`. It is pure and public via `./core` so Described's Node pipeline can use the same join.
2. **Key:** cue settings + payload text. Cue identifiers are ignored; timestamps are compared as whole
   milliseconds (immune to KIT-030's float sums).
3. **Rule:** a block from a later segment is dropped when an earlier segment kept a block with the same key whose
   interval **contains** it — equality covers verbatim repeats, containment covers the clipped repeat older
   packagers write.
4. **Across segments only.** Identical blocks inside one segment, and a bare `.vtt` body, are left alone: the
   kit removes what segmentation added, never what the author wrote.
5. **Never merge split cues** (same text at adjacent times). That is a content edit, not a transport fix.
6. `parseVtt`, `CueScheduler` and `CueOverlay` are unchanged. A defensive de-dupe in the overlay would hide a
   transport bug from the harness, which is the guard of record (spec 24).

## Consequences

- `fetchHlsVtt`'s output is canonical (`WEBVTT\n\n` + blocks joined by one blank line + `\n`); the old
  "pinned, not endorsed" join expectation in `test/hls-load.test.ts` was changed deliberately.
- The next duplicate report should be traced to the join first. Adding merging, or keying the overlay, is the
  wrong fix for the reasons above.
- A segment whose `WEBVTT` header runs straight into a cue (no blank line) keeps that cue; only the header lines
  above the first timing line are dropped (review follow-up).

## Known limits (from the review, not regressions)

- Containment is one-directional: a packager that clips the *end* in the earlier segment and writes the full
  cue later would still show the line twice for the clipped span. No observed packager does this.
- `X-TIMESTAMP-MAP` offsets are ignored, as before; a stream with a non-zero `MPEGTS` origin would be mistimed.
- STYLE/REGION blocks repeated per segment pass through verbatim and can land after cues; `parseVtt` skips them,
  a strict WebVTT consumer of `joinVttSegments` might not.
