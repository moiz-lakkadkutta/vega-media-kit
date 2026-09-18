# Tasks

Protocol: [docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md). Ticket list transcribed from
[docs/KICKOFF.md](docs/KICKOFF.md) on 2026-09-15 (week 0); there was no `TASKS.md` before that.

Gate column refers to `docs/decisions/0001-week0-gates.md`. **That file does not exist yet** — no gate has
been recorded, so no ticket is gate-blocked at time of writing. The Sept 17 gate decision is the human's.

| Ticket | Title | Role chain | Gate | Status |
|---|---|---|---|---|
| KIT-001 | Week-0 spike runbook (`docs/spike-runbook.md`) | Spike (fable) → Reviewer (fable) → Implementer (opus) | open | **done** (`8e93273`, CI green) |
| KIT-002/003/004 | HLS master-playlist parsing; deprecate the `x-kit-text-urls` header hack; fixture tests | Planner (fable) → Implementer (opus) ×3 | open | **done** |
| KIT-005 | Playwright harness for `CueOverlay` via the web adapter + CI job | Implementer (opus) → Reviewer (fable) | open | not started |
| KIT-008 | `docs/getting-started.md` + README updated to what the spike changed; changeset for 0.1.0 | Scribe (opus) | open | not started |
| KIT-009 | `preferredText` auto-selection never delivers cues (`KitPlayer.tsx:33` bypasses `api.selectText`) | Implementer (opus) → Reviewer (fable) → Implementer (opus) | open | **done** (`ad47f96`) |
| KIT-014 | `preferredText={{}}` / `{ languages: undefined }` selects every text track | Planner (fable) → Implementer (opus) | open | not started |
| KIT-011 | `selectedText` / `appliedPrefs` / scheduler tracks are never reset when `props.source` changes | Planner (fable) → Implementer (opus) | open | not started |
| KIT-012 | `CueScheduler` rebuilt whenever `props.onCue` identity changes; `api` rebuilt every position tick | Implementer (opus) | open | not started |
| KIT-013 | `web.tsx` labelled every text track `kind: 'subtitles'` | Implementer (opus) | open | **closed by KIT-002/003/004** for manifest tracks |
| KIT-007 | Vega platform bindings: Content Launcher, Personalization, Media Controls, Parental Controls | Spike (fable) → Planner (fable) → Implementer (opus) | open | not started (needs device evidence) |
| KIT-010 | Rewrite the Vega adapter onto `VideoPlayer` class + `KeplerVideoSurfaceView` (see `docs/decisions/0002`) | Planner (fable) → Implementer (opus) → Reviewer (fable) | open | not started |

`KIT-006` is not described in `docs/KICKOFF.md`. Left unlisted rather than invented. **`KIT-007` is the
Vega platform bindings ticket** — named by the `TODO(spike KIT-007)` markers in `src/platform/`, and gated
on device evidence the same way KIT-010 is.
`KIT-009`–`KIT-013` were opened by the orchestrator from the KIT-001 and KIT-009 review findings; renumber
if they collide with the human's own numbering.

## KIT-009 detail

Found by the KIT-001 reviewer, verified at source. `selectedText` (`KitPlayer.tsx:19`) gates cue delivery
in `handleTextTrackData` (`:59`), but is populated **only** by `api.selectText` (`:75-78`). The
`preferredText` auto-selection path calls `adapterRef.current.selectText(...)` directly (`:33`), bypassing
it — so an app that passes `preferredText` and nothing else gets tracks selected on the adapter while every
fetched VTT is silently dropped and `onCue` never fires. Affects the `web` and `fireos` scheduler paths
today, Vega too if the spike lands on scheduler-over-fetched-VTT, and both consuming apps: it is the
documented "ten minutes to a playing video" path in `README.md`. `preferredAudio` (`:31-32`) is unaffected.

## KIT-002/003/004 outcome

`src/core/hls.ts` (pure parser, public via `./core`) + `src/player/hls.ts` (fetch layer). 112 tests, up from
47 at the start of the day. Decisions in `docs/decisions/0004-hls-master-parsing.md`; plan and its eight open
questions in `docs/plans/KIT-002-hls.md`. Follow-ups not yet ticketed, from plan §9: Q4 (Fire OS audio-role
enrichment from CHARACTERISTICS), Q5 (`fetchHlsVtt`'s `/abs` and `../` segment resolution — **now pinned by a
test**, so a fix must change that pin deliberately), Q6 (`FORCED` subtitles need a `types.ts` change to
represent), Q7 (web hands `.m3u8` subtitle playlists straight to the scheduler — fold into KIT-005), Q8
(whether to strip the deprecated header from what react-native-video sends to the CDN now or at removal).

The five `adapter wiring` tests are **structural guards**, not behavioural tests: with no DOM or React Native
test environment they pin the shape of correct code. They catch the reverts known to be dangerous (both
`appliedPrefs` latch routes, the header merge order, header-only ids). A refactor that changes the shape
while keeping the behaviour will also fail them — read the comments and update the guard deliberately rather
than deleting it. If KIT-005's Playwright harness can assert `onTracks` ordering against a real `<video>`,
the web half becomes a real behavioural test and that guard can retire.

## KIT-014 detail

A *present but empty* preference object selects **every** text track, descriptions included, because
"omitted key means any" (`docs/decisions/0003`). An app building the object dynamically —
`preferredText={{ languages: userLangs }}` where `userLangs` is `undefined` — therefore turns on every
language at once: the same footgun class as the KIT-009 bug, one level up. The behaviour is **pinned by a
test, not endorsed** (`test/selection.test.ts`, `pins that a present-but-empty preference selects every
track`). Deciding `{}` means "nothing" is a semantic change the human has not made; raise it before
implementing.

## KIT-011/012/013 detail

All three are **pre-existing** defects found by the KIT-009 reviewer and deliberately excluded from that
ticket to keep its diff reviewable.

- **KIT-011** — `KitPlayer.tsx:20-21,44`: a second `source` inherits the previous source's selected ids and
  its stale cues (fireos/Shaka ids are small integers, so they collide), and `preferredText` is never
  re-applied because `appliedPrefs` stays `true`.
- **KIT-012** — `KitPlayer.tsx:23`: an inline `onCue` rebuilds the scheduler every render, dropping every
  loaded track. `README.md` and both apps pass a stable `setCues`, so it is latent, not live. Separately,
  `api` is rebuilt on every position tick because `getPosition` closes over `position` state, churning
  `useImperativeHandle` and `renderControls` at ≤ 4 Hz.
- **KIT-013** — **closed for manifest-derived tracks** by KIT-002/003/004: the web adapter now builds its
  text tracks from the master playlist, so `CHARACTERISTICS` decide the kind. Tracks that exist *only*
  because of the deprecated `x-kit-text-urls` header are still labelled `subtitles`, which is correct —
  the header carries no kind information — and that path disappears when the header is removed.

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

1. **The spike TODO markers, corrected.** An earlier note here claimed there were only two, both in
   `vega.tsx`. That was wrong — it came from grepping the literal string `TODO(spike)`, which does not
   match the `TODO(spike KIT-NNN)` form. The full set is:

   | Location | Marker | Ticket |
   |---|---|---|
   | `src/player/adapters/vega.tsx:12` | `TODO(spike)` (prose, false — see `docs/decisions/0002`) | KIT-010 |
   | `src/player/adapters/vega.tsx:77` | `TODO(spike)` — how to obtain a text stream URI | KIT-010 |
   | `src/player/adapters/fireos.tsx:50` | `TODO(spike KIT-001)` — the `x-kit-text-urls` hack | KIT-002/003/004 |
   | `src/platform/contentLauncher.ts:29` | `TODO(spike KIT-007)` — confirm import + API | KIT-007 |
   | `src/platform/personalization.ts:9` | `TODO(spike KIT-007)` — Content Personalization API | KIT-007 |
   | `src/platform/mediaControls.ts:15` | `TODO(spike KIT-007)` — `VegaMediaControl` | KIT-007 |
   | `src/platform/parentalControls.ts:8` | plain `TODO:` — Vega Parental Controls (VVD ≥ 0.24) | KIT-007 |

   Separately, the genuinely unconfirmed Vega names are **unmarked** by any TODO: the
   `@amazon-devices/react-native-w3cmedia` → `VideoPlayer` shape, the assumption that a `ref` on it yields
   an `HTMLMediaElement` Shaka can `attach()` to, and the Shaka dependency form. See `docs/decisions/0002`.
2. **`Platform.OS` on Vega.** `src/player/adapters/index.ts:15` and `src/platform/os.ts:5` already accept
   `'kepler'`, but `docs/getting-started.md:13` still tells readers `'vega'` is expected, and
   `adapters/index.ts:10` hedges toward `'android'`. Folds into KIT-008.
3. **`pnpm lint` is broken.** ESLint 9 is installed with no flat `eslint.config.*`, so `pnpm lint` exits 2
   and the `// eslint-disable-next-line` comments in the adapters are inert. Not in CI, so CI stays green.
   Unticketed.
4. **`pnpm lint:words` and `pnpm friction`** (ORCHESTRATOR §4) do not exist in this repo — they are
   app-side scripts. Not required of kit sub-agents.
