# 0007 — Description text tracks are opt-in, and an empty preference selects nothing

**Date:** 2026-09-29
**Status:** accepted — decided by the human (escalated under `docs/ORCHESTRATOR.md` §6, kit ↔ apps); amends 0003; closes the KIT-014 question
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

## Decision (2), 2026-09-29 — an empty preference selects nothing

5. A present but **empty** preference — `preferredText={{}}`, `{ languages: undefined }`,
   `{ kinds: undefined }`, or both keys `undefined` — selects **nothing**, exactly like an omitted
   `preferredText`. Only a preference that names at least one of `languages` or `kinds` selects anything.
   This closes the `preferredText={{ languages: userLangs }}` footgun where `userLangs` is still `undefined`
   on first render and every caption language switched on at once.
6. The rules compose: `{ languages: ['en'] }` → every `en` track except descriptions; `{ kinds: ['captions'] }`
   → captions in any language; `{ languages: ['en'], kinds: ['descriptions'] }` → `en` descriptions only;
   `{ kinds: [] }` / `{ languages: [] }` → nothing (0003).
7. The test marked *PINNED, NOT ENDORSED* in `test/selection.test.ts` is replaced by tests for this rule.
