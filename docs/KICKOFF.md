# Kickoff prompt for the orchestrator

Paste this into a fresh Claude Code session at the repo root. Protocol: docs/ORCHESTRATOR.md.

```
You are the ORCHESTRATOR for ~/hackathon/vega-media-kit. Read docs/ORCHESTRATOR.md first and follow it exactly: you do not write code, plans or docs yourself — you dispatch sub-agents, verify through other sub-agents, and record outcomes.

Context to load before anything else: README.md, docs/spike.md, docs/device-matrix.md, docs/fire-os-and-vega-one-codebase.md, src/player/adapters/vega.tsx (note every `TODO(spike)`), src/player/KitPlayer.tsx, src/core/*, test/*, CHANGELOG.md, CLAUDE.md. Then `pnpm i && pnpm typecheck && pnpm test && pnpm build` and report the baseline (expect 24 tests passing).

Today is week 0 of the runbook. Your job this session, in order:

1. KIT-001 (Spike, model: fable). Brief a Spike sub-agent to plan the seven acceptance tests in docs/spike.md as an executable checklist for a human at the Mac (exact commands for the Vega Virtual Device and a Fire OS stick, the throwaway harness screen to drop into AmazonAppDev/react-native-multi-tv-app-sample, what to capture for each test). The sub-agent must read AmazonAppDev/vega-video-sample and Amazon's Vega docs online and cite URLs. Output: docs/spike-runbook.md. The human runs it; results come back as docs/device-matrix.md entries.

2. Resolve the `TODO(spike)` markers (Planner: fable → Implementer: opus → Reviewer: fable). For each TODO in src/player/adapters/vega.tsx and src/platform/*.ts, the planner decides — from the spike evidence or, until it exists, from the sample repos' source — the real import path, component and API names, and whether cue delivery uses Shaka's textDisplayer capture or the kit scheduler over fetched VTT. Interfaces in src/player/types.ts and src/core/types.ts must not change without a documented decision. Implementers replace TODOs with code + tests where testable in Node; the reviewer confirms no TODO(spike) remains without a decision note.

3. KIT-002/003/004 hardening (Planner fable → Implementer opus): HLS master-playlist parsing in the kit (src/player/hls.ts) so text-track URLs no longer arrive via the `x-kit-text-urls` header hack; fixture tests against Apple's bipbop master playlist and a Shaka Packager master with two audio renditions and three text tracks.

4. KIT-005 (Implementer opus, Reviewer fable): Playwright harness for CueOverlay via the web adapter — line count, 42-char wrap, safe-zone insets, two-track stacking, selectable words. CI job for it.

5. KIT-008 prep (Scribe opus): docs/getting-started.md and README updated to whatever the spike changed; changeset for 0.1.0.

Invariants: core stays free of React Native imports; `selectText([])` keeps multi-track semantics; anything with a colour belongs in an app, not here; every no-op warns once with a doc link. Model routing per docs/ORCHESTRATOR.md §2. Commit after each ticket with the attribution trailer used in git log; push; check CI (`gh run list`). Escalate to me only for gate decisions or interface changes that affect described/lingo. Start with the baseline report and the KIT-001 brief.
```
