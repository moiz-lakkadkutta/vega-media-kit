# KIT-032 — `CueOverlay` selectable path: keys, inline tags, top-line cues, `onFocusWord`, clipped focus

**Role chain:** Planner (opus, this document) → Implementer (opus) → Reviewer.
**Protocol:** `docs/ORCHESTRATOR.md` §3. **Origin:** KIT-017 plan §9 Q3 + KIT-017 review. **Base:** `main` `efefa95`.
**Status:** ready for an implementer. Nothing in §9 blocks.

Ticket text (`TASKS.md`): "`CueOverlay` selectable path (`src/cues/CueOverlay.tsx:93`): key lacks the `-${i}` index
suffix (duplicate keys for duplicate ids); `<i>`/`<b>` stripped, breaking the `docs/cue-overlay.md` promise when
`selectable`; `line: 'top'` cues become word-selectable (share `primaryStyle`); `onFocusWord` declared but never
called; a focused word past the 2-line clamp has no visible underline".

---

## 0. Verdict at a glance

| # | Item | Decision | One-line reason |
|---|---|---|---|
| 1 | Selectable cue key `${trackId}:${id}` (:93) | **Fix** | Same key as the plain path (`-${i}`). Duplicate ids are legal input (KIT-026 dedupes HLS segments only; an app can pass anything); React logs "two children with the same key" today — verified red. |
| 2 | `<i>`/`<b>` stripped when `selectable` (:90) | **Fix** | `docs/cue-overlay.md` promises "`<i>`/`<b>` preserved" with no exception. Words keep their tag styling; `aria-label` and word index stay tag-free (unchanged values). |
| 3 | `line: 'top'` cues word-selectable (:89 `style === primaryStyle`) | **Fix** | Top-line cues are positional text (burnt-in-text avoidance), not the learning line; they also *steal* word indices from the bottom primary cue. Selectability becomes an explicit flag, not style identity. |
| 3b | (found while planning) word index restarts at 0 in every primary cue (`let wi = -1` per cue) | **Fix** (same code) | With two active primary cues, `focusedIndex: 0` underlines two words today. Index runs across the primary box in render order. Needed anyway so `onFocusWord` resolves to one word. |
| 4 | `onFocusWord` declared, never called | **Fix — the overlay calls it** (not removed, not deprecated) | The JSDoc already says "Emits the word under focus" and the harness already wires a recorder (`window.__focusCalls`). The overlay owns tokenisation (whitespace split, tags removed, punctuation kept, cross-cue index); without the callback an app must re-implement it to know *which* word it focused, or whether its index is past the end. No type change. §2 R8–R12. |
| 5 | Focused word past the 2-line clamp shows no underline | **Document** (already in `docs/cue-overlay.md` since KIT-017; add to the prop JSDoc) — no render change | KIT-017 R3 decided the clamp is visual only; RN on Android cannot report per-span layout, so the overlay cannot know which words are clipped (soft wraps clip too, not only `\n`). Un-clamping on focus would reintroduce the third line KIT-017 removed. `onFocusWord` still reports the clipped word so the app can show it elsewhere. |

No public type changes: `CueOverlayProps`, `CueTheme`, `defaultCueTheme` and the `./cues` exports are untouched.
No colours (the focus style stays `textDecorationLine: 'underline'`). Changeset **patch** (§7).

**Consumers (grep of `/Users/moizp/hackathon/*`, excluding worktrees):** nobody passes `selectable`.
`described/packages/shared-ui/src/screens/Player.tsx:395` renders `CueOverlay` without it. Lingo dropped the kit
overlay for word focus (Lingo `docs/decisions/0006-word-focus.md`, option B: `DualCue` with native-focus
`Pressable`s) and lists exactly items 2 and 4 among the reasons; option D there ("`renderWord` render-prop and
view-based rows") is a separate future kit ticket, **not** this one. So every change here is safe for both apps.

**Prototype:** everything in §2–§6 was implemented in a scratch copy of `efefa95` (not committed):
`pnpm typecheck`, `pnpm typecheck:harness`, `pnpm test` (307) and `pnpm harness overlay.spec.ts` (12) green;
the key, top-line, cross-cue and callback tests red on HEAD.

---

## 1. Files

| File | Change |
|---|---|
| `src/cues/CueOverlay.tsx` | §3 — tokeniser, explicit `selectable` flag in `renderCue`, cross-cue word index, `onFocusWord` effect, key suffix, JSDoc |
| `test/cue-overlay.test.tsx` | append the §5.1 `describe` block (KIT-017's six tests untouched; keep KIT-017's "keep last" pointer-events test last in *its* block — see §5.1 note) |
| `harness/e2e/overlay.spec.ts` | edit spec 7's `__focusCalls` assertion (it pinned the bug); append spec 12, §5.2 |
| `docs/cue-overlay.md` | rewrite the `selectable` bullet (§4) |
| `.changeset/kit-032-cue-overlay-selectable.md` | **new**, patch, §7 |

Not touched: `harness/overlay.tsx` (already records `onFocusWord` into `window.__focusCalls`), `src/core`,
adapters, `src/cues/index.ts`, `vitest.config.ts`, `README.md`.

---

## 2. Behaviour rules

**Which cues are selectable**

R1. With `selectable` set, **only bottom primary cues** (the `primary` list: primary track, `line !== 'top'`) render
    word-by-word. Top-line cues and secondary cues always use the plain path. Decided by an explicit argument to
    `renderCue`, never by `style === primaryStyle`.

R2. **Word index is global across the primary box**: words of `primary[0]` are 0…n₀−1, `primary[1]` continues at
    n₀, and so on, in render order. Speaker labels (`[Name] `) are never words (unchanged). Sound cues keep their
    brackets inside words (`[door`, `slams]`, unchanged).

**Tokenising a selectable cue (internal, not exported)**

R3. Input is the display text (sound-bracketed as today). First remove every tag other than `<i>`, `</i>`, `<b>`,
    `</b>` (regex `/<(?!\/?[ib]>)[^>]*>/g`) — the parser already guarantees only these survive, and the selectable
    path stripped everything before, so non-parser input does not regress. Then walk `text.split(INLINE_TAG)` with
    the same italic/bold state machine as `renderInline` (open sets, close clears, no nesting count).

R4. Split each text run on `/(\s+)/`. **A token is a maximal run of non-whitespace (a word) or whitespace,
    regardless of tag boundaries**: `wo<i>rld</i>` is one word `world` made of two runs (`wo`, `rld` italic);
    `<i>brave new</i>` is two italic words. The word string (= `aria-label`, = `onFocusWord` arg) is the
    concatenation of its runs — tag-free, punctuation kept. Word count and every label are therefore identical to
    HEAD for any input (HEAD stripped tags, then split on `/(\s+)/`).

R5. **Rendering a word**: one `<Text aria-label={word}>` per word (the unit spec 7, KIT-017 tests 3–4 and the
    focus underline address). If the word is a single run, its italic/bold style goes on that word `<Text>` and the
    text is its direct child (no extra nesting). If it spans several runs, the word `<Text>` has one child `<Text>`
    per run carrying that run's style. The focus style (`styles.focusedWord`) always goes on the **word** `<Text>`
    (so a mixed word underlines whole). Whitespace tokens render as unlabeled `<Text>` (as today; no style needed).
    Style values are exactly `renderInline`'s: `{ fontStyle: 'italic' }`, `{ fontWeight: '700' }`.

**Keys**

R6. Every cue root `<Text>` is keyed `${trackId}:${id}-${i}` (i = index within its list), selectable or not.
    Inner keys stay local indices.

**Clamp (unchanged, documented)**

R7. `numberOfLines={2}` stays on every cue root `<Text>` (KIT-017 R1). A focused word past line 2 is not visible and
    shows no underline; it still has its label, still counts for `focusedIndex`, and is still reported by
    `onFocusWord`. The overlay does not report clipping (cannot on Android).

**`onFocusWord(word, index)`**

R8. Called when the **focused word** resolves to an existing word: `focusedIndex` is an integer in
    `[0, totalWords)` of the primary box (R2). `word` per R4, `index === focusedIndex`.

R9. Called **once per change of focused word**, after commit (`useEffect`), keyed on
    `(cueKey of the owning cue, index, word)`. Fires on mount if focus already resolves; fires again when
    `focusedIndex` changes, or when the cues change so that the same index now names a different word/cue.
    Does **not** fire on a re-render with the same focus, nor when only the `onFocusWord` function identity changes
    (read through a ref — inline arrows are the common call site, cf. KIT `onCue` ref fix in 0.1.0).

R10. **Not called** for `focusedIndex: null`, a negative or past-the-end index, when `selectable` is unset, or when
     the primary box is empty. No "blur" call: the app owns `focusedIndex`, so it knows when it cleared it.

R11. The overlay never changes focus itself; `focusedIndex` stays fully controlled. If an app sets the same
     `focusedIndex` from inside `onFocusWord`, R9 guarantees no loop.

R12. No colour, no new style. `styles.focusedWord` unchanged.

---

## 3. Typed interfaces (internal to `src/cues/CueOverlay.tsx`; public types unchanged)

```ts
// Public — unchanged shape, JSDoc rewritten:
selectable?: {
  /** Index of the focused word across the bottom primary cues, in render order (top-line and secondary cues are
   *  never selectable). Words are whitespace-separated, tags removed, punctuation kept. A word past the 2-line
   *  clamp is not visible and shows no underline but still counts. `null` = no focus. */
  focusedIndex: number | null
  /** Called after render when the focused word changes and `focusedIndex` names an existing word; not for `null`
   *  or an index past the last word. `word` is the word as rendered (tags removed, punctuation kept). */
  onFocusWord?(word: string, index: number): void
}

// Internal:
interface Run { text: string; italic: boolean; bold: boolean }
interface Token { word: string | null /* null = whitespace */; runs: Run[] }
function selectableTokens(text: string): Token[]              // R3–R4; pure, not exported
const runStyle = (r: Run) => [r.italic && { fontStyle: 'italic' as const }, r.bold && { fontWeight: '700' as const }]
renderCue(c: Cue, style: object, i: number, selectable: boolean) // R1: true only from the primary map
```

Implementation shape (prototype, ~45 changed lines): compute `primaryTokens = primary.map(c => selectableTokens(cueText(c)))`
once per render when `selectable` is set; derive per-cue word offsets and the focused `{ word, cueKey }` from it
(R2, R8); render primary cues from those tokens; a `useEffect(() => { if (focused) cbRef.current?.(word, index) }, [focusKey])`
with `focusKey = focused ? \`${cueKey}|${index}|${word}\` : null` and `cbRef.current = selectable?.onFocusWord`
assigned each render. Hooks are unconditional (called even when `selectable` is unset). Do **not** use a
render-scoped mutable counter shared across cues as the source of truth for the callback.

---

## 4. Docs (`docs/cue-overlay.md`)

Replace the `selectable` bullet with:

> - `selectable={{ focusedIndex, onFocusWord }}`: word-level focus for D-pad navigation while paused. Only the bottom primary cues are selectable (never `line: 'top'` or secondary cues); `focusedIndex` counts their words in render order (whitespace-separated, tags removed, punctuation kept). The app owns `focusedIndex`; the overlay underlines that word and calls `onFocusWord(word, index)` once each time the focused word changes and exists — not for `null` or an index past the last word. `<i>`/`<b>` keep their style on words.

Keep the existing clamp bullet (it already states item 5). Keep "`<i>`/`<b>` preserved" (now true for `selectable`).

---

## 5. Acceptance tests

### 5.1 `test/cue-overlay.test.tsx` — append `describe('CueOverlay selectable (KIT-032)', …)`

Same file, same RNW alias/`render` helper. **Placement:** KIT-017's last test reads every `console.warn` so far;
appending a block *after* it is safe (it only reads warnings from earlier renders). Add a module-level
`const error = vi.spyOn(console, 'error')` and `error.mockClear()` in this block's `beforeEach`.
Focus is read with `getComputedStyle(span).textDecoration` (`'underline'` / `'none'` — verified in jsdom;
`.textDecorationLine` reads `''` there). Italic/bold with `getComputedStyle(span).fontStyle` / `.fontWeight`
(inline styles; verified). Words = `span[aria-label]`.

| # | `it(...)` | HEAD | fix |
|---|---|---|---|
| 1 | `selectable cues with the same id render without a duplicate-key warning` — `[cue('x','One two'), cue('x','Three four')]`, `selectable:{focusedIndex:null}` → no `console.error` call matching `/same key/`; labels `['One','two','Three','four']` | **red** | green |
| 2 | `selectable words keep <i> and <b>; labels stay tag-free` — `'Hello <i>brave</i> <b>new</b> wo<i>rld</i>.'`: labels `['Hello','brave','new','world.']`; word fontStyle `['', 'italic', '', '']`, fontWeight `['', '', '700', '']`; word 3 has 2 child spans, 2nd italic; cue root `textContent` `'Hello brave new world.'` | **red** | green |
| 3 | `a tag spanning several words styles each of them` — `'<i>brave new</i> world'` → fontStyle `['italic','italic','']` | **red** | green |
| 4 | `a focused word made of several runs is underlined as a whole` — the #2 cue, `focusedIndex: 3` → word 3 `textDecoration` `'underline'`, others `'none'` | green (pin) | green |
| 5 | `line:top cues are never selectable and take no word index` — `[TOP('Up here'), DE('Hallo Welt')]`, `focusedIndex: 0` → labels `['Hallo','Welt']`, only `Hallo` underlined, top cue has no `span[aria-label]` | **red** | green |
| 6 | `the word index runs across primary cues in render order` — `[cue('a','One two'), cue('b','Three four')]`, `focusedIndex: 2` → only `Three` underlined | **red** | green |
| 7 | `onFocusWord reports the focused word once per change` — `'Hallo Welt'`: render `focusedIndex 1` (stable fn), re-render same props with a *new inline* fn wrapping the spy, render `focusedIndex 0` → calls `[['Welt',1],['Hallo',0]]` | **red** | green |
| 8 | `onFocusWord is not called for null, a negative or past-the-end index, or without primary cues` — `null`, `-1`, `5` on `'Hallo Welt'`; `focusedIndex 0` with only a `line:'top'` cue → 0 calls | green (pin) | green |
| 9 | `onFocusWord reports a word across cues and a word past the clamp` — two primary cues `focusedIndex 2` → `['Three',2]`; `CUE3L` `focusedIndex 11` → `['clipped',11]` | **red** | green |
| 10 | `onFocusWord fires again when the same index names a new cue` — `focusedIndex 0` on `cue('a','Eins')` then on `cue('b','Zwei')` → `[['Eins',0],['Zwei',0]]`; then `cue('b','Zwei')` re-rendered → still 2 calls | **red** | green |

### 5.2 `harness/e2e/overlay.spec.ts`

- **Spec 7 edit** (`selectable underlines the focused word and labels every word`): replace the comment + `toEqual([])`
  with `expect(await page.evaluate(() => window.__focusCalls)).toEqual([['brave', 1]])`; after the
  `focusedIndex: null` step add the same assertion again (no extra call). Rest unchanged.
- **Spec 12 (new):** `test('selectable keeps italic and bold on words, top-line cues are not selectable, and onFocusWord reports the word')` —
  `setCues([cue('ib','Hello <i>brave</i> <b>new</b> wo<i>rld</i>.'), TOP], { selectable: { focusedIndex: 3 } })`:
  labels `['Hello','brave','new','world.']`; computed `fontStyle` `['normal','italic','normal','normal']`;
  `fontWeight` `['400','400','700','400']`; `words.nth(3).locator('span').nth(1)` fontStyle `'italic'`;
  `words.nth(3)` computed `textDecorationLine` `'underline'`; `topArea(page).locator('span[aria-label]')` count 0;
  `__focusCalls` `[['world.', 3]]`. (Prototype: green on the fix.)

Existing specs 1–6, 8–11 untouched and green.

### 5.3 Commands

`pnpm typecheck && pnpm typecheck:harness && pnpm test && pnpm harness overlay.spec.ts`. (`pnpm lint` is broken
repo-wide — KIT-037 — do not gate on it.)

---

## 6. Mutation table (reviewer runs each in scratch)

| Mutant | Killed by |
|---|---|
| selectable root key without `-${i}` (= HEAD) | vitest 1 |
| selectable path strips all tags again (= HEAD :90) | vitest 2, 3; harness 12 |
| italic/bold only on multi-run children, single-run words unstyled | vitest 2, 3; harness 12 |
| tags left in labels / `onFocusWord` word (`wo<i>rld</i>.`) | vitest 2, 9-style label check; harness 12 |
| splitting words at tag boundaries (`wo` + `rld` = two words) | vitest 2 (labels), 4; harness 12 |
| underline on run children instead of the word span | vitest 4; harness 12 (`textDecorationLine` of word) |
| selectability by `style === primaryStyle` (= HEAD) | vitest 5; harness 12 |
| word index reset per cue (= HEAD) | vitest 6, 9 |
| speaker label counted as a word | KIT-017 vitest 4 (labels) |
| `onFocusWord` never called (= HEAD) | vitest 7, 9, 10; harness 7, 12 |
| effect without deps / callback in deps (fires every render or on new fn identity) | vitest 7, 10 |
| effect keyed on `focusedIndex` only (misses a cue change) | vitest 10 |
| called for `null` / out-of-range / top-only | vitest 8 |
| `numberOfLines` dropped from the selectable root | KIT-017 vitest 1; harness 10 |
| `focusedIndex === wi + 1` | harness 7; vitest 4, 6 |

---

## 7. Changeset — patch

`.changeset/kit-032-cue-overlay-selectable.md`:

```md
---
'@moizp/vega-media-kit': patch
---

**`CueOverlay` `selectable` fixes.** `onFocusWord(word, index)` is now called, as documented: once each time the focused word changes and `focusedIndex` names an existing word (not for `null` or an index past the last word); `word` is the word as rendered, tags removed and punctuation kept. Only the bottom primary cues are selectable: `line: 'top'` cues no longer render word-by-word or take word indices, and `focusedIndex` counts words across all active primary cues in order instead of restarting in each cue (two words could be underlined at once). `<i>` and `<b>` keep their style in selectable cues, as they do elsewhere; word labels are unchanged. Selectable cues with duplicate ids no longer trigger React duplicate-key warnings. A focused word past the two-line clamp is still not visible; this is documented. No prop changes.
```

Level reasoning: no type or export changes; every behaviour change brings the component in line with its own
docs/JSDoc; no consumer passes `selectable` today. Pre-1.0, the kit has used `patch` for such fixes (KIT-017).

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | An app that passed `onFocusWord` and relied on it never firing. | None exist (grep, §0). Changeset says it. |
| R2 | Android: extra nested `<Text>` for multi-run words inside a `numberOfLines={2}` root. | Same mechanism the plain path already uses for `<i>`/`<b>` (device-verified on Fire OS); multi-run words are rare (tag mid-word). Note for the next device run (KIT-017's pending ellipsis check covers it). |
| R3 | Callback-from-effect timing: fires after paint, not synchronously with the prop change. | Documented ("after render"). An app needing the word synchronously can't get it from the overlay anyway; acceptable. |
| R4 | `focusedIndex` semantics change for multi-cue primary boxes (global instead of per-cue). | HEAD's behaviour underlined N words for one index — a bug, not a contract; no consumer. Called out in the changeset. |
| R5 | Vega: not verified (decision 0001). | Pure JS/RN `Text` changes; nothing Vega-specific. |
| R6 | Ticket creep toward Lingo's option D (`renderWord`, view rows, focusable words). | Out of scope; separate ticket if an app asks (§9 Q3). |

---

## 9. Open questions

- **Q1 (not blocking).** `onFocusWord`: this plan *implements* it (R8–R11). The alternative — `@deprecated`
  no-op, removed in 0.2, plus documenting focus as controlled-only — is smaller but leaves apps to duplicate the
  tokeniser. Both are public-API behaviour decisions with no current consumer; the orchestrator may pick either
  without the human. If deprecate is chosen: drop R8–R11, vitest 7–10 and the harness `__focusCalls` edits; keep
  spec 7's `[]` assertion; add `@deprecated` JSDoc; still patch.
- **Q2 (not blocking).** Changeset `patch` vs `minor`: `onFocusWord` starting to fire is arguably new behaviour.
  Recommend patch (docs already promised it). Orchestrator's call.
- **Q3 (not blocking, out of scope).** Lingo decision 0006 option D (`renderWord` render-prop / view-row
  selectable renderer so words can be focusable `Pressable`s with an outline) — file only if an app asks; it is a
  cross-repo interface change (ORCHESTRATOR §6 escalation).
- **Q4 (not blocking, out of scope).** The plain path still renders non-`<i>`/`<b>` tags literally for non-parser
  input, while the selectable path strips them (R3). Harmless given `Cue.text`'s documented contract
  (`src/core/types.ts:31`); left as is.
