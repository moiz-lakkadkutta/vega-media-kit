# 0001 — Week-0 gates: Fire OS primary, Vega experimental

**Date:** 2026-09-26 (gate was due 2026-09-17; recorded late)
**Status:** accepted — Gate B decided by the human; Gate A recorded from `docs/device-matrix.md`; Gate C belongs to `described`
**Ticket:** KIT-001 · **Runbook:** `docs/spike-runbook.md` · **Gate definitions:** the hackathon runbook, §6

## Gates

| Gate | Question | Result |
|---|---|---|
| **A** — media pipeline | Spike tests 1–6 pass on both OSes | **Pass on Fire OS; not run on Vega.** Fire TV Stick `AFTSS`, Fire OS 7.7.1.6: playback, audio switch, two text tracks, seek / pause / 0.75×, and test 6 (Described's own `09-package` HLS from the `described-media-dev` CloudFront) all pass. The Angel One audio switch was borderline (0.96–1.25 s against the 1 s bar); the own-HLS switch to the description rendition took 0.59 s. Test 3 is n/a on Fire OS (scheduler over fetched VTT). Vega Virtual Device column not run — the SDK was never installed. |
| **B** — Vega itself | Does the VVD / RN for Vega block us for more than a day? | **Triggered by decision, not by a blockage.** Nine days past the gate with the Oct 8 kill date twelve days out, and the SDK install alone is ~20 GB plus an unknown day, the human chose not to spend it: **Fire OS primary, Vega experimental.** |
| **C** — AI quality | Nova Pro descriptions usable (≥ 70 % of a 20-shot sample)? | Not a kit gate. Recorded in `described/docs/decisions/0001-week0-gates.md` (DESC-001). |

## Decision

Both apps ship on **Fire OS**. The kit's Vega adapter and Vega platform bindings stay in the package and are
labelled **experimental**: they compile and are exported, but are not device-verified and carry no support
promise in 0.1.0. The hackathon rules accept "Fire OS *or* Vega OS", so eligibility is unaffected.

## Consequences for the kit

1. **KIT-010** (Vega adapter rewrite) and **KIT-007** (Vega platform bindings) are **deferred**, not merely
   blocked. They stay open for after the kill date; pick them up only if the VVD column is ever run.
2. **KIT-024** (Vega scaffold listener leak / stale publish) folds into KIT-010 and is deferred with it.
3. **KIT-018** gains priority: an experimental platform must say so. Every Vega no-op must warn once with a
   doc link, and the warning text should name "experimental".
4. README `## Status`, `docs/getting-started.md` (Vega section) and the 0.1.0 changeset must say
   "Vega: experimental, not device-verified" — a Scribe ticket (KIT-031).
5. Before 0.1.0 the Fire OS path is what must be right: KIT-026 (duplicate captions), KIT-027 (`exports`
   order), KIT-022 (kit-side `handleTracks` origin gate), then KIT-023 (Fire OS stale load, high) and
   KIT-028/029 (Fire OS state and active-audio reporting).
6. The web adapter and Playwright harness remain the CI guard of record; the Fire OS evidence is manual
   (`~/hackathon/spike-evidence/`, logcat `KIT-SPIKE` lines — `adb screencap` is black on this stick).

## Revisit when

Someone installs Vega SDK 0.24 and runs the Vega column of `docs/device-matrix.md` (runbook §1.2, §2.2–2.4,
§4). A clean run reopens Gate B and un-defers KIT-010 → KIT-007.
