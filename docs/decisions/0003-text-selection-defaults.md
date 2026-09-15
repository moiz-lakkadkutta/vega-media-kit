# 0003 — `preferredText` selects nothing by default; an empty array means "none"

**Date:** 2026-09-15 (week 0)
**Status:** accepted — decided by the human, escalated under `docs/ORCHESTRATOR.md` §6 (kit ↔ apps)
**Ticket:** KIT-009

## Context

KIT-009 fixed a bug where the `preferredText` auto-selection path bypassed the kit's selected-track set,
so every WebVTT pushed through `onTextTrackData` was silently dropped and `onCue` never fired.

Reviewing that fix surfaced a second, latent defect it would have **unmasked**. `pickText`
(`src/core/tracks.ts`) guards its filters with `if (pref?.kinds?.length)` and
`if (pref?.languages?.length)`. An empty array is falsy in JavaScript, so `kinds: []` skipped the filter
and returned **every** track — as did an omitted `preferredText`.

While the gate was broken this was invisible: all those tracks were selected on the adapter, but their
cues were thrown away. With KIT-009 in place they reach `onCue`.

`described` depends on the broken-looking case. `packages/shared-ui/src/screens/Player.tsx:48`:

```tsx
preferredText={{ kinds: prefs.captionKind === 'off' ? [] : [/* … */] }}
```

So shipping KIT-009 alone would have made **captions-off display every caption and description track at
once**. `lingo` and `spot` do not use `preferredText` yet, so `described` was the only app exposed.

## Decision

1. **An explicit empty array means "match nothing".** `preferredText: { kinds: [] }` and
   `{ languages: [] }` select no track. `described`'s captions-off idiom is therefore correct as written
   and needs no app-side change.
2. **Omitting `preferredText` entirely selects nothing.** Not "every track", not "the first track".
   Captions stay off until an app asks for them, which is the television convention, and the kit never
   stacks every language in the overlay by accident. "First track" was rejected because manifest order is
   arbitrary and choosing one track quietly undercuts the multi-track selection the kit exists for.
3. **The fix lives in both `pickText` and `KitPlayer`.** `pickText` is exported publicly from `./core`, so
   fixing it closes the footgun for direct callers; guarding `KitPlayer`'s auto-selection as well means the
   player does not depend solely on `pickText`'s semantics.

An omitted `kinds` alongside a given `languages` still means "any kind", and vice versa — only an
**explicit** empty array means none.

## Consequences

- `pickText`'s behaviour changes publicly. It carries a changeset line of its own; the signature is
  unchanged, and no type in `src/player/types.ts` or `src/core/types.ts` moves.
- `described` needs no change. Its captions-off path starts working as it always read.
- `selectText([])` is unaffected — it already cleared the set and pruned every scheduler track, and
  retains its multi-track semantics (`CLAUDE.md`).
- Apps that relied on "omit `preferredText` to get all tracks" would break. None do, and the behaviour was
  unreachable in practice before KIT-009.
