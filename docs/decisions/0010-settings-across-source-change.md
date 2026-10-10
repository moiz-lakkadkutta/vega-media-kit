# 0010 — Playback rate and volume survive a source change

**Date:** 2026-10-10
**Status:** accepted — decided by the human 2026-10-10 ("go with recommendation": KIT-039 option A); amends 0005 §3
**Tickets:** KIT-039 · **Plan:** `docs/plans/KIT-039-rate-across-switch.md` (the plan calls this decision "0009"; the number went to `reload()`)

## Context

When an app changed `source` on the same `KitPlayer`, the rate behaved differently per platform: web reset to 1×
(the HTML load algorithm resets `playbackRate` to `defaultPlaybackRate`), Fire OS kept it. Volume was kept on both
(DESC-006 already documents that). Vega is unverified. No app relies on either behaviour today: `lingo` is the only
`setRate` user and remounts per clip; `described` is the only `setVolume` user and remounts per attempt.

## Decision

**A source change keeps the rate and the volume the app last set.** One rule for both settings, on every adapter.

- Web: `setRate` also sets `defaultPlaybackRate`, so the browser restores the rate itself on the new `src` — no
  moment at 1×.
- Fire OS: already compliant; pinned by a test.
- Vega: deferred to the KIT-010 checklist.
- An app that wants 1× (or full volume) for each new source calls `setRate(1)` / `setVolume(1)` when it switches.

Amends 0005 §3: rate and volume are not part of the source-change reset.

## Consequences

- No change in `KitPlayer`; JSDoc + an `AdapterProps` contract line in `types.ts`; a "Rate and volume" section in
  `docs/getting-started.md`. Changeset: **patch**.
- Fire OS also keeps `paused` and ignores `autoplay` across a switch, where web does not — a separate question,
  KIT-040, not decided here.
