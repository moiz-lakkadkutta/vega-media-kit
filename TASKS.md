# Tasks

Protocol: [docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md). Ticket list transcribed from
[docs/KICKOFF.md](docs/KICKOFF.md) on 2026-09-15 (week 0); there was no `TASKS.md` before that.

Gate column refers to `docs/decisions/0001-week0-gates.md`. **That file does not exist yet** — no gate has
been recorded, so no ticket is gate-blocked at time of writing. The Sept 17 gate decision is the human's.

| Ticket | Title | Role chain | Gate | Status |
|---|---|---|---|---|
| KIT-001 | Week-0 spike runbook (`docs/spike-runbook.md`) | Spike (fable) → Reviewer (fable) → Implementer (opus) | open | applying review findings |
| KIT-002/003/004 | HLS master-playlist parsing (`src/player/hls.ts`); retire the `x-kit-text-urls` header hack; fixture tests | Planner (fable) → Implementer (opus) | open | not started |
| KIT-005 | Playwright harness for `CueOverlay` via the web adapter + CI job | Implementer (opus) → Reviewer (fable) | open | not started |
| KIT-008 | `docs/getting-started.md` + README updated to what the spike changed; changeset for 0.1.0 | Scribe (opus) | open | not started |
| KIT-009 | `preferredText` auto-selection never delivers cues (`KitPlayer.tsx:33` bypasses `api.selectText`) | Implementer (opus) → Reviewer (fable) | open | in progress |
| KIT-010 | Rewrite the Vega adapter onto `VideoPlayer` class + `KeplerVideoSurfaceView` (see `docs/decisions/0002`) | Planner (fable) → Implementer (opus) → Reviewer (fable) | open | not started |

`KIT-006` and `KIT-007` are not described in `docs/KICKOFF.md`. Left unlisted rather than invented.
`KIT-009` and `KIT-010` were opened by the orchestrator from KIT-001's findings; renumber if they collide
with the human's own numbering.

## KIT-009 detail

Found by the KIT-001 reviewer, verified at source. `selectedText` (`KitPlayer.tsx:19`) gates cue delivery
in `handleTextTrackData` (`:59`), but is populated **only** by `api.selectText` (`:75-78`). The
`preferredText` auto-selection path calls `adapterRef.current.selectText(...)` directly (`:33`), bypassing
it — so an app that passes `preferredText` and nothing else gets tracks selected on the adapter while every
fetched VTT is silently dropped and `onCue` never fires. Affects the `web` and `fireos` scheduler paths
today, Vega too if the spike lands on scheduler-over-fetched-VTT, and both consuming apps: it is the
documented "ten minutes to a playing video" path in `README.md`. `preferredAudio` (`:31-32`) is unaffected.

## KIT-010 detail

`docs/decisions/0002-vega-media-surface.md`. The scaffold's premise that the `TODO(spike)` markers would
"change in name only" (`vega.tsx:12`) is false: `VideoPlayer` is a TypeScript class, not a React component,
so `vega.tsx:88` cannot work. Public interfaces are unaffected — no app-side escalation needed.

## KIT-001 detail

Deliverable `docs/spike-runbook.md` is written and under cold review. The human runs the runbook on the
Vega Virtual Device and a Fire OS stick; results are transcribed into
[docs/device-matrix.md](docs/device-matrix.md), and every rough edge becomes a friction log in the
consuming app's `docs/friction/` (`CLAUDE.md`).

## KIT-002/003/004 detail

`src/player/hls.ts` is referenced by comments in `src/player/adapters/vega.tsx` and
`src/player/adapters/fireos.tsx` but **does not exist**. Text-track URLs currently arrive through
`source.headers['x-kit-text-urls']` (`fireos.tsx:51`, `web.tsx:16`, `docs/getting-started.md:3`);
this ticket replaces that. Fixtures: Apple bipbop advanced master, and a Shaka Packager master with two
audio renditions and three text tracks.

Interfaces in `src/player/types.ts` and `src/core/types.ts` must not change without a decision record.

## Scope corrections found while loading week-0 state

1. **`TODO(spike)` markers are not the real scope of the "resolve the TODOs" ticket.** The repo contains
   exactly two occurrences, both in `src/player/adapters/vega.tsx` — line 12 is prose, so the only real
   marker is **`vega.tsx:77`** (how to obtain a text stream URI). There are **no** `TODO(spike)` markers in
   `src/platform/*.ts`. The genuinely unconfirmed Vega names are unmarked: the
   `@amazon-devices/react-native-w3cmedia` → `VideoPlayer` shape, the assumption that a `ref` on it yields
   an `HTMLMediaElement` Shaka can `attach()` to, and the Shaka dependency form.
2. **`Platform.OS` on Vega.** `src/player/adapters/index.ts:15` and `src/platform/os.ts:5` already accept
   `'kepler'`, but `docs/getting-started.md:13` still tells readers `'vega'` is expected, and
   `adapters/index.ts:10` hedges toward `'android'`. Folds into KIT-008.
3. **`pnpm lint` is broken.** ESLint 9 is installed with no flat `eslint.config.*`, so `pnpm lint` exits 2
   and the `// eslint-disable-next-line` comments in the adapters are inert. Not in CI, so CI stays green.
   Unticketed.
4. **`pnpm lint:words` and `pnpm friction`** (ORCHESTRATOR §4) do not exist in this repo — they are
   app-side scripts. Not required of kit sub-agents.
