# 0007 — Description text tracks are opt-in: an omitted `kinds` means every kind except `descriptions`

**Date:** 2026-09-29
**Status:** accepted — decided by the human (escalated under `docs/ORCHESTRATOR.md` §6, kit ↔ apps); amends 0003
**Ticket:** KIT-014 (partly) · raised by the KIT-026 plan §9

## Context

Decision 0003 made an omitted `kinds` in `preferredText` mean "any kind". On the Fire TV spike the harness
passed `preferredText={{ languages: ['fr', 'en'] }}` against Described's own stream, where Captions, Rich
captions and Description text are all `en`. All three switched on at once, so the audio-description script
appeared on screen next to the captions. Television convention is that audio-description text is something
a viewer asks for, never a side effect of choosing a caption language.

## Decision

1. When `preferredText` names **no `kinds`**, `pickText` matches every text kind **except `descriptions`**.
2. A `descriptions` track is selected only when the app names it: `kinds: ['descriptions', …]`.
3. Everything else in 0003 stands: an explicit empty array (`kinds: []`, `languages: []`) matches nothing; an
   omitted `preferredText` selects nothing; an omitted `languages` means any language.
4. `selectText([...ids])` is unaffected — explicit ids are always honoured, descriptions included, and
   multi-track selection is unchanged (`CLAUDE.md`).

## Consequences

- `pickText` (public via `./core`) changes behaviour; it needs a changeset line and a test that pins the
  default. No type changes.
- `described` is unaffected: it always passes `kinds` (`packages/shared-ui/src/screens/Player.tsx:48`).
  `lingo` and `spot` do not use `preferredText` yet.
- **Still open for KIT-014:** whether a present-but-empty preference — `preferredText={{}}` or
  `{ languages: undefined }` — should select nothing (like an omitted prop) or, under this rule, every
  non-description track in every language. The test marked *PINNED, NOT ENDORSED* in
  `test/selection.test.ts` stays until that is decided.
