# Kickoff prompt for the orchestrator

Paste this into a fresh Claude Code session at the repo root. Protocol: docs/ORCHESTRATOR.md.
The week-0 kickoff (KIT-001 first) is in git history at `c347753`; this is the **week-1 wave**.

Before pasting, answer the four items under "Waiting on the human" in `TASKS.md` if you can — the
orchestrator will otherwise ask for them again. At minimum say whether the device runbook has been run.

```
You are the ORCHESTRATOR for ~/hackathon/vega-media-kit. Read docs/ORCHESTRATOR.md first and follow it exactly: you do not write code, plans or docs yourself — you dispatch sub-agents, verify through other sub-agents, and record outcomes in TASKS.md and docs/decisions/.

State to load, in this order: TASKS.md (the progress log and ticket table are the authoritative state — read "Waiting on the human" and "Follow-ups not yet ticketed"), docs/decisions/0002–0004, docs/plans/KIT-002-hls.md §9, CLAUDE.md, README.md, docs/getting-started.md, src/player/KitPlayer.tsx, src/player/adapters/web.tsx, src/cues/CueOverlay.tsx, test/hls-load.test.ts (the `adapter wiring` describe — those are structural guards you may get to retire). Then `git fetch && git status -sb` — I work in this same tree from a parallel session and commit there, so re-baseline before quoting anything: `pnpm i && pnpm typecheck && pnpm test && pnpm build` (expect 112 tests at da33bb7; if higher, read the new commits before proceeding).

This wave, in order:

1. KIT-005 (Implementer: opus → Reviewer: fable). Playwright harness for CueOverlay via the web adapter: line count, 42-char wrap, safe-zone insets, two-track stacking, selectable words. A CI job that runs it. Fold in plan Q7 — the web adapter currently hands `.m3u8` subtitle playlists straight to the scheduler and must go through `fetchHlsVtt`. If the harness can assert `onTracks` ordering against a real `<video>`, retire the web half of the structural guard in test/hls-load.test.ts and say so in the commit. No colours in the harness fixtures beyond CueOverlay's defaults.

2. KIT-008 (Scribe: opus). docs/getting-started.md and README.md brought up to what shipped: `Platform.OS` on Vega is `'kepler'` (getting-started Vega step 4 still says `'vega'`; adapters/index.ts:10 hedges toward `'android'`), the Vega adapter is a rewrite not a rename (decision 0002 — README "Status" still says names change "in name only"), text tracks come from the manifest (the `## Text tracks` section exists; check it reads as the primary path, not a footnote), and the three pending changesets consolidated into a 0.1.0 changeset. Do not hand-edit CHANGELOG.md.

3. KIT-011 and KIT-012 (Implementer: opus, one ticket each, Reviewer: fable once for both) if the human has not said otherwise. Both are small and Node-testable through the src/player/selection.ts pattern. KIT-011 needs a decision on what "source changed" resets; write it as a decision record before implementing.

4. KIT-014 only if the human has answered it. Do not decide `{}` semantics yourself.

KIT-007 and KIT-010 stay blocked until docs/device-matrix.md has entries. If it does, stop after step 1 and report — KIT-010 is the priority and needs a Planner (fable) reading the matrix and docs/spike-runbook.md N1–N8 before anything else.

Invariants: core stays free of React Native imports; `selectText([])` keeps multi-track semantics; anything with a colour belongs in an app; every no-op warns once with a doc link; public types in src/player/types.ts and src/core/types.ts do not change without a decision record. Model routing per ORCHESTRATOR §2. Every implementer must show its new tests red before green; you re-run at least one mutation per ticket yourself — three guards in two sessions passed against broken code until someone did. Grep `TODO(spike` without the closing paren. Commit after each ticket with the attribution trailer used in git log; push; check CI (`gh run list`). Escalate only for gate decisions or interface changes that affect described/lingo. Start with the baseline report.
```
