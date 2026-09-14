# Contributing

- `pnpm i` · `pnpm test` · `pnpm typecheck` · `pnpm build`
- Core (`src/core`) has no React Native imports so it runs in Node and in media pipelines.
- Anything with a colour belongs in an app, not here. The kit ships behaviour and sane 10-foot defaults.
- Add a changeset (`pnpm changeset`) with every user-facing change.
- Manual device matrix (Fire OS stick, Vega Virtual Device) lives in `docs/device-matrix.md`; update it per release.
