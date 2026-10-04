# KIT-017 — `CueOverlay`: selectable cues respect the 2-line limit; ARIA-style prop migration

**Role chain:** Planner (opus, this document — fable unavailable) → Implementer (opus) → Reviewer (fable if available).
**Protocol:** `docs/ORCHESTRATOR.md` §3. **Decisions:** 0001 (Vega experimental). **Origin:** KIT-005 review.
**Status:** ready for an implementer. Nothing in §9 blocks.

Ticket text (`TASKS.md`): "`CueOverlay`: selectable primary cue skips `numberOfLines={2}`; migrate
`accessibilityLabel`/`accessibilityRole`/`pointerEvents` to `aria-label`/`role`/`style.pointerEvents`".

---

## 0. Verdict at a glance

1. **Line references (verified on `acb682d`, `src/cues/CueOverlay.tsx`).** Selectable root `<Text>` without
   `numberOfLines`, with `accessibilityRole="text"`: **:93**. Per-word `accessibilityLabel={w}`: **:100**.
   Non-selectable `<Text numberOfLines={2} accessibilityRole="text">`: **:109**. Root
   `<View pointerEvents="none">`: **:124**. `styles.root`: **:135**.
2. **Line limit: clamp the selectable cue exactly like the non-selectable one** — `numberOfLines={2}` on the
   cue's own root `<Text>` (:93), not on the box container (§2). On HEAD a three-line selectable cue renders
   171 px tall in the harness; after the fix 114 px (2 × 57) — measured, §6.
3. **`accessibilityRole="text"` is deleted, not migrated.** `role` has no `'text'` value in RN 0.81 (nor in
   Vega's RN 0.72 docs); `role="text"` does not typecheck (TS2769, verified). Deleting it changes nothing an
   assistive technology sees on any platform we can check (§3.2). `role="none"`/`"presentation"` would be a
   *change* (web emits `role="presentation"`; Android sets class `android.view.View` instead of
   `TextView`) and is forbidden.
4. **`accessibilityLabel={w}` → `aria-label={w}`** (RN `Text.js:79`: `ariaLabel ?? accessibilityLabel`;
   react-native-web resolves both to the same `aria-label` attribute). **`pointerEvents="none"` prop →
   `pointerEvents: 'none'` in `styles.root`** (RN `ReactNativeStyleAttributes.js:187`; react-native-web
   0.21.2 warns `props.pointerEvents is deprecated. Use style.pointerEvents` today — observed in vitest).
5. **No public prop changes.** `CueOverlayProps`, `CueTheme`, `defaultCueTheme` untouched. No colours added.
6. **Accessibility tree before/after is byte-identical in Chromium** (`ariaSnapshot`, §3.3). The only
   user-visible change is the clamp. Changeset: **patch**.

---

## 1. Versions in play

| Surface | Version | Source |
|---|---|---|
| react-native (dev, types) | **0.81.0** | `package.json` devDependencies, `node_modules/react-native/package.json` |
| peer floor | `react-native >= 0.72` | `package.json` peerDependencies |
| react-native-web (harness + new vitest file) | **0.21.2** | `node_modules/react-native-web/package.json` |
| Vega | "React Native for Vega" **0.72** docs | https://developer.amazon.com/docs/react-native-vega/0.72/accessibility.html |

ARIA-style props (`aria-label`, `role`) landed in RN 0.71; `style.pointerEvents` in 0.71. The peer floor
(0.72) is above both, so the migration needs no peer bump.

- **Fire OS (react-native 0.81):** `Text.js:51,79` reads `'aria-label'` with precedence over
  `accessibilityLabel`; `TextProps.js:246` `role?: ?Role`; `Role` (`ViewAccessibility.d.ts:354-418`) has no
  `'text'`. `pointerEvents` is a style attribute (`ReactNativeStyleAttributes.js:187`,
  `BaseViewConfig.android.js:338`) and goes to the same `ReactViewManager.setPointerEvents` as the prop.
- **react-native-web 0.21.2:** `createDOMProps` maps `aria-label ?? accessibilityLabel` → `aria-label`
  (:421); `propsToAriaRole` maps `text → null` (no attribute) for both `role` and `accessibilityRole`;
  `pointerEvents` prop is merged into style with a `warnOnce` deprecation (:804-807).
- **Vega (experimental, decision 0001) — documented, not device-verified.** Vega's accessibility page:
  "ARIA-style props were introduced in React Native 0.71 … Each 'aria-*' prop has precedence over any existing
  equivalents … accessibilityLabel — use aria-label instead … accessibilityRole — use role instead"
  (https://developer.amazon.com/docs/react-native-vega/0.72/accessibility.html). `role` and `aria-label` are
  listed on View (https://developer.amazon.com/docs/react-native-vega/0.72/view.html); `pointerEvents` is a
  View style prop (https://developer.amazon.com/docs/react-native-vega/0.72/view-style-props.html). Vega's
  `accessibilityRole` list includes `text` ("treated as static text"); its `role` (RN 0.72 `Role`) does not.
  Whether Vega's screen reader (VoiceView on Vega) announces a `<Text>` without a role identically has **not**
  been verified; it is low-risk because `Text` is static text by default, and it goes on the spike runbook,
  not this ticket.

---

## 2. Behaviour rules

R1. **Every cue's root `<Text>` carries `numberOfLines={2}`**, selectable or not, top or bottom, primary or
    secondary. Two lines is the Netflix Timed Text limit the overlay documents (`docs/cue-overlay.md`:
    "≤ 2 lines") and `lintCues` enforces (`lineLength`/2 lines × 42).

R2. **The clamp goes on the cue's `<Text>`, not on the box.** Reasons: (a) the box holds several cues
    (`box(primary.map(...))`); a container `maxHeight` would clip the second cue whole, while the
    non-selectable path clamps per cue; (b) a `View` has no line-clamp — only a height cap with no ellipsis,
    which on Android would cut a line in half at non-integer dp; (c) the nested word `<Text>`s are inline spans
    (web) / spans of one `TextView` (Android), so a clamp on the parent `<Text>` clamps them — verified on web
    (height 171 → 114 px, `-webkit-line-clamp: 2`).

R3. **Selectable cues lose no words to assistive tech or to the app.** The clamp is visual: every word past
    line 2 is still rendered, still has its `aria-label`, and `focusedIndex` still indexes it. The overlay
    does not and cannot tell the app which words are clipped (no `onLayout` per span on Android). Trade-off,
    accepted: a cue longer than two lines is a content defect `lintCues` already reports; showing a third
    line in learning mode would break the safe-zone/stacking layout every other mode keeps. Documented in
    `docs/cue-overlay.md` (§4). Revisit only if an app asks (§9 Q1).

R4. **No ARIA role on any cue element**, before or after. `accessibilityRole="text"` is removed from both
    `<Text>`s. Not replaced by `role` of any value.

R5. **Per-word labels keep their exact value** (`w`, the word itself; whitespace spans and the speaker
    prefix have none), now via `aria-label`.

R6. **The overlay subtree never receives pointer/touch events** — the root's `pointerEvents: 'none'` moves into
    `styles.root`; not `'box-none'` (which would make the word spans hit-targets over the video).

R7. **No live region.** The overlay is not, and does not become, `aria-live`/`accessibilityLiveRegion`:
    screen readers announcing every caption over programme audio is not what a caption overlay should do,
    and the original has none. Out of scope to add.

---

## 3. Prop mapping table

### 3.1 Old → new

| Where (HEAD line) | Old | New | Why equivalent |
|---|---|---|---|
| selectable root `<Text>` (:93) | `accessibilityRole="text"` (no `numberOfLines`) | *(removed)* + `numberOfLines={2}` | role: §3.2. clamp: R1 |
| per-word `<Text>` (:100) | `accessibilityLabel={w}` | `aria-label={w}` | RN `Text.js:79` `ariaLabel ?? accessibilityLabel`; RNW `createDOMProps:421` same attribute |
| non-selectable `<Text>` (:109) | `accessibilityRole="text"` | *(removed)* | §3.2 |
| root `<View>` (:124) | `pointerEvents="none"` prop | removed from JSX | — |
| `styles.root` (:135) | — | `pointerEvents: 'none'` | RN style attribute → same native setter; RNW: same atomic class, no deprecation warning |

Whitespace `<Text key={k}>{w}</Text>` (:96) is unchanged. Nothing else in the file changes.

### 3.2 Why `accessibilityRole="text"` maps to *nothing*

| Platform | `accessibilityRole="text"` today | after removal |
|---|---|---|
| Fire OS (RN 0.81 Android) | `AccessibilityRole.TEXT` → node class `android.widget.TextView` (`ReactAccessibilityDelegate.java:887`). Its only other effect, a synthesized content description (:244-251), applies only when the node has neither text nor description — a cue always has text. | `ReactTextView extends AppCompatTextView` → class `android.widget.TextView` by default. Same announcement. |
| web (RNW 0.21.2) | `propsToAriaRole`: `text: null` → no `role` attribute | no `role` attribute |
| Vega | documented `text` role; not verified on device | `Text` default; not verified on device (§1) |
| `role="text"` (rejected) | TS2769 "`"text"` is not assignable to `Role`"; Android `Role.fromValue("text")` → `null` | — |
| `role="none"` (rejected) | web `role="presentation"`; Android `NONE` → `android.view.View` | changes semantics |

### 3.3 Evidence (scratch copy of `acb682d`, fix applied, not committed)

Chromium `ariaSnapshot()` of the overlay, HEAD and fix identical:
`- text: "[Maria] Hello brave new world"` (selectable) and `- text: Hello brave new world` (plain, with `<i>`).
Per-word `aria-label`s are in the DOM (harness spec 7 selects on them) but do not appear in Chromium's tree
(ARIA 1.2 prohibits naming the `generic` role) — true before and after; see §9 Q2.

---

## 4. Files

| File | Change |
|---|---|
| `src/cues/CueOverlay.tsx` | exactly §3.1 (five edits, ~5 lines) |
| `test/cue-overlay.test.tsx` | **new**, §5.1 |
| `harness/e2e/overlay.spec.ts` | two new specs appended, §5.2; existing specs 1–9 untouched |
| `docs/cue-overlay.md` | one bullet: "Every cue, `selectable` included, is clamped to 2 lines; in `selectable` mode words past line 2 are not visible but still count for `focusedIndex` and keep their label — fix the cue (see `lintCues`)." |
| `.changeset/kit-017-cue-overlay.md` | **new**, patch, §7 |

Not touched: `CueOverlayProps`, `CueTheme`, `defaultCueTheme`, `src/core`, every adapter, `harness/overlay.tsx`,
`vitest.config.ts`.

---

## 5. Acceptance tests

All verified in a scratch copy: red/green as stated, `pnpm typecheck`, `pnpm typecheck:harness`, full
`pnpm test` (232 tests) and `pnpm harness overlay.spec.ts` (11 specs) green on the fix.

### 5.1 `test/cue-overlay.test.tsx` (vitest, jsdom, real `CueOverlay` through react-native-web)

Setup — the same alias the harness uses, per file (no `vitest.config.ts` change):

```tsx
// @vitest-environment jsdom
import { CueOverlay, type CueOverlayProps } from '../src/cues'
// @ts-expect-error -- react-native-web ships no type declarations; the harness aliases it the same way
vi.mock('react-native', () => import('react-native-web'))
```

Render with `createRoot` + `act` (as `test/web-adapter.test.tsx`), `scale={1}`, `testID="overlay"`. Use
`Array.from(querySelectorAll(...))`, not spread — the root `tsconfig` has no `DOM.Iterable` (TS2488).
Install `const warn = vi.spyOn(console, 'warn')` at module level and **never clear it**: RNW's `warnOnce`
fires once per module instance, so only the first render in the file can show the deprecation.
Cue root = `div[dir="auto"]`; clamp = its inline `style.webkitLineClamp`.

| # | `it(...)` | HEAD | fix |
|---|---|---|---|
| 1 | `a selectable primary cue is clamped to two lines, like a non-selectable one` — 3-line cue, `selectable: { focusedIndex: null }` → `['2']`; same cue without `selectable` → `['2']` | **red** | green |
| 2 | `a selectable top-line cue is clamped to two lines` — `line: 'top'`, `'a\nb\nc'` | **red** | green |
| 3 | `clamping is visual only: every word of a clamped selectable cue keeps its aria-label` — 3-line cue, `focusedIndex: 11`, labels = all 12 words in order | green (pin) | green |
| 4 | `words carry aria-label; whitespace and speaker label do not` — `WORDS` + `speaker: 'Maria'`: direct `span` children' labels `['Hello', null, 'brave', null, 'new', null, 'world']`; root `textContent` `'[Maria] Hello brave new world'` | green (pin) | green |
| 5 | `no cue element exposes a role (the old accessibilityRole="text" had no web role)` — primary+secondary, then selectable: `[role]` count 0 | green (pin) | green |
| 6 | `the root is pointer-events none through style, with no deprecation warning` — computed `pointerEvents` `'none'`; every `console.warn` call so far in the file has no `/deprecated/`. **Keep it last in the file.** | **red** | green |

### 5.2 `harness/e2e/overlay.spec.ts` (Playwright, Chromium, real component via `harness/overlay.tsx`)

The harness already renders `CueOverlay` (`/overlay.html`, `window.__setCues`); reuse its `CUE3L`, `WORDS`,
`TOP`, `DE`, `EN`, `rect`, `computed`, `overlay`, `text` helpers.

10. `test('a selectable cue is clamped to two lines like any other, and every word keeps its label')` —
    `setCues([CUE3L], { selectable: { focusedIndex: 11 } })`: cue `height` ≈ **114** (HEAD: **171**),
    computed `-webkit-line-clamp` `'2'`, `span[aria-label]` count **12**, `nth(11)` has `aria-label="clipped"`.
    Control: `setCues([WORDS], { selectable: { focusedIndex: 0 } })` → height ≈ **57**.
11. `test('cue text exposes no ARIA role and the overlay never takes pointer events')` — `[TOP, DE, EN]` with
    `primaryTrackId: 'de'` → `overlay.locator('[role]')` count 0; `[WORDS]` selectable → count 0; computed
    root `pointer-events` `'none'`; **hit test**: `document.elementFromPoint` at the centre of the first word
    span is not inside `[data-testid="overlay"]` (this, not the root computed style, is what catches
    `'box-none'`); `expect(overlay).toMatchAriaSnapshot('- text: Hello brave new world')`.
    Green on HEAD by design — it pins that the migration preserved semantics.

### 5.3 Static check for the reviewer

`grep -nE 'accessibility[A-Z]|pointerEvents=' src/cues/CueOverlay.tsx` → no output. (Leaving
`accessibilityLabel` or `accessibilityRole="text"` in place is an equivalent mutant at runtime — RNW renders
the same DOM and its warnings for those two are commented out — so only this grep catches it.)

---

## 6. Mutations for the reviewer (each run in scratch; result → killer)

| Mutant | Killed by |
|---|---|
| no `numberOfLines` on the selectable `<Text>` (= HEAD) | vitest 1, 2; harness 10 (171 ≠ 114) |
| `numberOfLines={3}` on the selectable `<Text>` | vitest 1, 2 |
| `role="none"` on a cue `<Text>` | vitest 5 (`role="presentation"` in DOM); harness 11 |
| `role="text"` | `pnpm typecheck` (TS2769) |
| `aria-label` dropped from words | vitest 3, 4; harness 7, 10 |
| `pointerEvents: 'box-none'` in `styles.root` | harness 11 hit test only (root computed style is still `none`; vitest survives) |
| `pointerEvents="none"` prop kept alongside the style | vitest 6 |
| `accessibilityLabel` / `accessibilityRole="text"` kept | §5.3 grep only (runtime-equivalent) |
| clamp moved to box `maxHeight` | harness 10 fails `-webkit-line-clamp` `'2'`; vitest 1 |

---

## 7. Changeset — patch

```md
---
'@moizp/vega-media-kit': patch
---

**`CueOverlay`: selectable cues are clamped to two lines.** With `selectable` set, the primary (and top-line) cue was rendered without the two-line limit every other cue has, so an over-long cue grew a third line and pushed the box out of the layout. It is now clamped like the rest. Words past the second line are not visible but still count for `focusedIndex` and keep their accessibility label. `CueOverlay` also uses `aria-label` and `style.pointerEvents` instead of the deprecated `accessibilityLabel` and `pointerEvents` props, and drops `accessibilityRole="text"`, which had no `role` equivalent and no effect beyond a `Text`'s default; what screen readers announce is unchanged, and react-native-web no longer logs a `pointerEvents` deprecation warning. No prop changes.
```

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Lingo's word navigation lands on a clipped word (invisible focus). | R3 + doc bullet; `lintCues` flags the cue. §9 Q1. |
| R2 | Android: `numberOfLines` on a `<Text>` with many nested `<Text>` children ellipsizes mid-span. | Same mechanism as the non-selectable path, which already nests `<i>`/`<b>` `<Text>`s under `numberOfLines={2}` and is device-verified on Fire OS (`docs/device-matrix.md`). Note for the next device run, not blocking. |
| R3 | Vega's screen reader treats a role-less `Text` differently from `accessibilityRole="text"`. | Not verifiable without the Vega Virtual Device; Vega is experimental (0001). Add a line to `docs/spike-runbook.md` only if the orchestrator wants it — not in this ticket's file list. |
| R4 | `vi.mock('react-native', () => import('react-native-web'))` is new in `test/`. | Isolated to the new file; other tests keep their own `vi.mock('react-native', …)` doubles. Works under jsdom (verified). |
| R5 | RNW drift (0.22) changes `numberOfLines` DOM. | Existing KIT-005 R6 covers it; specs fail loudly. |

---

## 9. Open questions

- **Q1 (not blocking).** Should `selectable` cues ever be unclamped, e.g. for Lingo's paused word-study mode?
  Plan says no (R3). If an app wants it, it is a new opt-in prop — a public API change, separate ticket.
- **Q2 (not blocking).** The per-word `aria-label` duplicates the visible word and Chromium drops it (naming a
  `generic` span is prohibited in ARIA 1.2); on Android nested `<Text>` are spans, not views, so the label is
  likely ignored there too. It is kept 1:1 because the ticket is a migration, harness spec 7 depends on it,
  and an app may read it. Whether word focus should instead be exposed to AT (e.g. via the app announcing the
  focused word) is a product question for Lingo.
- **Q3 (not blocking, out of scope, do not fix here).** Noticed while reading: the selectable path keys cues by
  `${trackId}:${id}` without the index suffix the plain path has (:93 vs :109), and it strips `<i>`/`<b>`
  instead of rendering them; `selectable` also applies to `line: 'top'` cues because they share
  `primaryStyle`. Candidate low tickets for the orchestrator.
