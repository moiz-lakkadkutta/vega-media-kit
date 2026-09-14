# vega-media-kit — notes for coding agents

- Library, not UI kit: no colours, no theme beyond CueOverlay defaults. If it has a colour, it belongs in an app.
- `src/core` must stay free of React Native imports (runs in Node, used by media pipelines). Tests: `pnpm test`.
- Adapters: `fireos` (react-native-video), `vega` (@amazon-devices/react-native-w3cmedia + Shaka), `web` (harness). `TODO(spike)` marks names to confirm on the Vega Virtual Device — confirm before renaming, then delete the TODO.
- Multi text-track selection is a feature, not a bug. Never disable it to "simplify".
- Every user-facing change gets a changeset. Conventional commits.
- When you hit platform friction, write it up in the consuming app's `docs/friction/` in the hackathon's format (task, steps, expected, actual, severity, workaround, suggestion).
