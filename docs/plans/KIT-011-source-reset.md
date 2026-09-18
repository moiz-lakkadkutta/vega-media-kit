# KIT-011 — Reset `selectedText` / `appliedPrefs` / scheduler when `source.uri` changes

**Role chain:** Planner (opus standing in for fable, this document) → Implementer (opus).
**Protocol:** `docs/ORCHESTRATOR.md` §3.2, §4. **Decision:** `docs/decisions/0005-source-change-reset.md`.
**Status:** ready for an implementer. Nothing in §7 blocks.

Goal in one sentence: a change of `props.source.uri` clears the kit's per-source state — selected text ids,
the `preferredAudio`/`preferredText` latch, the scheduler's tracks (emitting `onCue([])` when cues were on
screen), `tracks` and `position` state — *before* the adapter starts loading the new source, and VTT fetched
for the previous source can never land in the scheduler, even when the new source selects the same id.

Ticket text (`TASKS.md`): "`KitPlayer.tsx`: `appliedPrefs`, `selectedText` and the scheduler's tracks are never
reset when `props.source` changes. A second source inherits the previous ids and stale cues (fireos/Shaka ids
are small integers and collide), and `preferredText` is never re-applied."

---

## 0. Decisions at a glance (from 0005)

1. **Identity:** `source.uri` only. `type`, `headers`, object identity do not count. Lives in `sourceChanged`.
2. **Reset, in order:** `selectedText` → `∅`; `appliedPrefs` → `false`; prune every scheduler track, then
   `scheduler.update(startAt ?? 0)` (emits `onCue([])` iff cues were active); `setTracks({ audio: [], text: [] })`;
   `setPosition(startAt ?? 0)`. No adapter call.
3. **Not reset:** `state`; the scheduler instance; the adapter; no synthetic `onTracks`/`onState`/`onPosition`.
4. **Race:** `acceptsTextTrackData` gains `requestedFor`/`live` (both the source uri); `handleTextTrackData` is
   re-created per `source.uri`, so old fetches arrive through the old handler and are refused.
5. **Compare by value** (`uri`) against a `liveUri` ref, every commit.
6. **Mechanism:** `useLayoutEffect` keyed on `props.source.uri`. Layout effects of the whole tree run before any
   passive effect, so the reset precedes the adapters' own `useEffect` on `source.uri`.
7. **KIT-012:** `KitPlayer.tsx:23` and `:87-102` are not touched; the new code goes between `handleTextTrackData`
   and `api`.
8. **Public surface unchanged:** no edit to `src/player/types.ts`, `src/core/**`, any `index.ts`. Changeset: a
   paragraph in `.changeset/release-0-1-0.md` (§6).

---

## 1. Files

| File | Action | Purpose |
|---|---|---|
| `docs/plans/KIT-011-source-reset.md` | exists | this plan |
| `src/player/selection.ts` | edit | `sourceChanged`; `acceptsTextTrackData` gains `requestedFor`, `live` |
| `src/player/KitPlayer.tsx` | edit | `liveUri` ref, per-source `handleTextTrackData`, the layout effect (§2) |
| `test/selection.test.ts` | edit | harness gains `changeSource`; new `it(...)`s (§3); one source guard |
| `.changeset/release-0-1-0.md` | edit | one paragraph (§6) |

Not touched: `src/core/**`, `src/player/types.ts`, `src/player/index.ts`, `src/index.ts`, `src/player/hls.ts`,
`src/player/adapters/*.tsx` (follow-ups in 0005 Consequences), `harness/**`, `test/hls-load.test.ts`,
`test/scheduler.test.ts`, `docs/getting-started.md`, `README.md`.

### `src/player/selection.ts` — exact signatures

```ts
/**
 * Whether a `source` prop change is a source change. Matches what makes every adapter reload — `uri`, and
 * only `uri` (web.tsx / vega.tsx key their load effect on it; fireos passes it to <Video>). `headers` must
 * not count: a refreshing auth header would clear captions on every refresh. Structural parameter, not
 * `KitSource`, so this module stays independent of the React prop types (same reason as `TextPreference`).
 */
export function sourceChanged(prev: { uri: string }, next: { uri: string }): boolean

/**
 * The gate on fetched VTT. Cues reach the scheduler only when the track is selected AND the VTT was
 * requested for the source that is live now. Selection alone is not enough: text ids are ordinals, so
 * the next source selects '0' again before the previous source's fetch for '0' resolves.
 */
export function acceptsTextTrackData(selected: ReadonlySet<string>, trackId: string, requestedFor: string, live: string): boolean
// = requestedFor === live && selected.has(trackId)
```

No `resetForSource`: the reset's pure half is `applyTextSelection([], schedulerTracks)` exactly, and an alias
adds surface without behaviour. `TextSelection`, `applyTextSelection`, `autoSelectedTextIds`, `TextPreference`
are unchanged. Nothing new is exported from an `index.ts`: `selection.ts` is KitPlayer wiring (KIT-009,
0004 §1), and apps have no use for `sourceChanged`.

---

## 2. The mechanism in `KitPlayer.tsx`

Three edits, top to bottom. Line numbers are pre-KIT-011 (`d36b2bc`).

**(a) Imports (lines 1, 7).** Add `useLayoutEffect` to the React import; add `sourceChanged` to the
`./selection` import.

**(b) After `appliedPrefs` (line 21).** One ref and one alias:

```tsx
/** The source the kit's per-source state (selection, latch, scheduler tracks) currently belongs to. */
const liveUri = useRef(props.source.uri)
const sourceUri = props.source.uri
```

Initialising the ref with the first uri makes the first mount a non-change with no special case.

**(c) Replace `handleTextTrackData` (lines 79–85) and insert the effect directly after it, before `api`
(line 87):**

```tsx
/**
 * Adapters that cannot emit cues push raw VTT here; adapters that can call onCue directly and never call this.
 * Re-created per `source.uri` on purpose: an adapter's `selectText` calls the `onTextTrackData` it captured when
 * it was invoked, so VTT fetched for a previous source arrives through a previous handler and `sourceUri` is
 * that source — not the live one — and the VTT is refused even when the new source selected the same id.
 * Adapter contract: call the `onTextTrackData` you were handed at `selectText` time; never read it through a
 * latest-props ref.
 */
const handleTextTrackData = useCallback(
  (trackId: string, vtt: string) => {
    if (!acceptsTextTrackData(selectedText.current, trackId, sourceUri, liveUri.current)) return
    scheduler.setTrack(trackId, parseVtt(vtt, { trackId }))
  },
  [scheduler, sourceUri],
)

/**
 * A source change resets what the kit owns for a source, before the adapter reloads (docs/decisions/0005).
 * Layout effect, not passive: React runs every layout effect of a commit before any passive effect of that
 * commit, so this precedes the adapters' own `useEffect` on `source.uri` regardless of how they emit. A
 * passive effect would run after the adapter's (children first) and could wipe a `preferredText` the new
 * source had already applied. Compares against `liveUri` rather than trusting "the effect ran", so it is a
 * no-op on first mount and under StrictMode's double invocation.
 */
useLayoutEffect(() => {
  if (!sourceChanged({ uri: liveUri.current }, props.source)) return
  liveUri.current = props.source.uri
  const start = props.startAt ?? 0
  selectedText.current = applyTextSelection([], scheduler.tracks).selected // refuse VTT first
  appliedPrefs.current = false // the new source's first onTracks re-applies preferredAudio/preferredText
  for (const t of scheduler.tracks) scheduler.removeTrack(t)
  scheduler.update(start) // removeTrack never notifies; this emits onCue([]) iff cues were on screen
  setTracks({ audio: [], text: [] }) // renderControls must not show the previous source's tracks
  setPosition(start)
  // The adapter is not told selectText([]): it is reloading, and the deselect would race the load.
}, [sourceUri]) // eslint-disable-line react-hooks/exhaustive-deps
```

Note `applyTextSelection([], scheduler.tracks).prune` equals `scheduler.tracks`; the loop reads
`scheduler.tracks` once (the getter copies) so removing while iterating is safe — or iterate `prune`; either
is fine, the implementer picks one and does not add a second copy of the pruning logic.

**Why the ordering holds, spelled out.** In one commit: React mutates the host tree (`<Video source>` /
`v.src` are *not* set here — web and vega set `src` in their passive effects; fireos's `<Video>` prop update
goes to native at commit and its `onLoad` comes back as a later bridge event), then runs layout effects
(KitPlayer's reset — the only layout effect in the tree; no adapter uses one), then paints, then runs passive
effects (web's/vega's load effect). `selectText`'s `await`s and `onLoad`'s `await hlsText.current` are
microtasks/events that cannot interleave with a synchronous effect flush. So by the time any `onTracks` or
`onTextTrackData` for the new source can run, `selectedText` is empty, `appliedPrefs` is `false`, and
`liveUri` is the new uri.

**Nothing else in `KitPlayer.tsx` changes.** `selectText` (30–41), `handleTracks` (43–59), `handlePosition`,
`handleState`, the scheduler memo (23), the `api` memo and `useImperativeHandle` (87–103), and the JSX are
byte-identical. **KIT-012 will touch line 23 (scheduler memo → stable instance with an `onCue` ref) and lines
87–102 (`api` memo → drop `position`/`tracks` from deps via refs)**; KIT-011 leaves both regions untouched and
inserts its block between them, so KIT-012's plan can be written against post-KIT-011 line numbers with no
overlap. If KIT-012 makes `scheduler` a stable `useRef`, the `[scheduler, sourceUri]` deps here stay valid.

---

## 3. Acceptance tests

All in `test/selection.test.ts`, Node only, following KIT-009's mirror pattern. **Nothing about `KitPlayer` itself
can be asserted in Node**: rendering it drags React Native into the vitest run (the file's NOTE says so). The
component is covered by (i) the mirror, (ii) one source-level guard, and (iii) a future harness spec:

> `harness/e2e/player.spec.ts` — `test('switching source clears the cues and re-applies preferredText to the
> new source')`: needs `window.__kit.setSource(uri)` in `harness/player.tsx` (a `useState` for the uri) and a
> second fixture `harness/fixtures/stream-b/master.m3u8` with the same ids `'0'`/`'1'` and different cue text;
> assert a `cue: []` event on the switch, exactly one more `tracks` event, and `cueIds(page, 2)` from stream B
> only. Note the page's `onCue` calls `flushSync`, which warns when invoked from a layout effect; the page must
> guard that (`if (!isInsideEffect) …` or just `setCuesState` without `flushSync` for the `[]` case). **Follow-up
> ticket, not KIT-011.**

### Harness changes (the mirror in `harness()`)

- `let liveUri = 'A'`; `const changeSource = (uri: string, startAt = 0) => { … }` mirroring §2(c) verbatim
  (`sourceChanged`, `applyTextSelection([], …)`, prune, `scheduler.update(startAt)`, `position = startAt`,
  `appliedPrefs = false`); it must **not** push to `adapterCalls`.
- `let appliedPrefs = false`; `handleTracks` gains the latch exactly as the component has it (`if (appliedPrefs)
  return; appliedPrefs = true; …`). Existing tests call `handleTracks` once each, so they are unaffected.
- `handleTextTrackData(trackId, text, requestedFor = liveUri)` — the third parameter models the closure a real
  adapter captured; existing two-argument calls default to the live source and stay green. Also expose
  `deliverLater(trackId, text)`: returns a thunk bound to the *current* `liveUri`, to be invoked after a
  `changeSource` — this is the old-fetch-resolves-late case.

### New `it(...)`s

`describe('sourceChanged')`:
1. `it('is a change only when uri differs')` — `{uri:'A'}` → `{uri:'B'}` true; `{uri:'A'}` → `{uri:'A'}` false.
2. `it('ignores type and headers: a headers-only or type-only change is not a source change')` — same uri with
   different `type`/`headers` fields present on the objects → false (structural typing accepts extra fields).

`describe('text selection state')` additions:
3. `it('a source change clears the selected set and every scheduler track without calling the adapter')` —
   select `['0','1']`, deliver both, `changeSource('B')`; `selectedIds()` is `[]`, `scheduler.tracks` is `[]`,
   `adapterCalls` unchanged in length.
4. `it('a source change emits onCue([]) once when cues were on screen, and nothing when none were')` —
   with cues active at `tick(2)`: `emitted.length` grows by exactly 1 and `emitted.at(-1)` is `[]`; a second
   harness with tracks loaded but position 0 (nothing active): `changeSource` adds no emission.
5. `it('a source change re-applies preferredText on the next onTracks even when the ids collide')` —
   `handleTracks([track('0','de')], {languages:['de']})`, `changeSource('B')`,
   `handleTracks([track('0','en'), track('1','de')], {languages:['de']})`; `selectedIds()` is `['1']` and
   `adapterCalls` is `[['0'],['1']]`. Red if `appliedPrefs` is not reset (second call is a no-op).
6. `it('VTT requested for the previous source is dropped, even when the new source selected the same id')` —
   select `['0']` on A, `const late = deliverLater('0','Alt')`, `changeSource('B')`,
   `handleTracks([track('0','de')], {languages:['de']})` (selects `'0'` again), `late()` returns `false` and
   `scheduler.tracks` is `[]`; then `handleTextTrackData('0','Neu')` (live) returns `true`.
7. `it('a same-uri re-render is not a source change: selection and cues survive')` — select, deliver, tick,
   `changeSource('A')` (same uri); `selectedIds()`, `scheduler.tracks`, `emitted.length` unchanged.
8. `it('a source change moves the kit position to startAt, or 0, until the adapter reports')` — `tick(40)`,
   `changeSource('B', 12)` → harness `position` is 12; `changeSource('C')` → 0. (Pins the `startAt ?? 0` choice
   that the real code passes to both `scheduler.update` and `setPosition`.)

`describe('acceptsTextTrackData')` (new, direct):
9. `it('accepts only a selected track requested for the live source')` — four combinations; only
   `(selected, same source)` is `true`.

`describe('KitPlayer wiring')` addition (source-level guard, same style as the two existing ones):
10. `it('resets per-source state in a layout effect keyed on source.uri, not a passive effect')` — `src` matches
    `/useLayoutEffect\(/g` exactly once, `/sourceChanged\(/g` exactly once, and does **not** match
    `/\buseEffect\(/`. Comment in the test: a passive effect runs after the adapters' load effects and can wipe
    a `preferredText` the new source already applied (0005 §6).

The two existing wiring guards (`adapterRef.current?.selectText(` count 1; `autoSelectedTextIds(` count 1, no
`pickText`) must still pass — the reset does not call the adapter.

---

## 4. Mutations each new test must be shown red against

Run one at a time, revert after each, never commit a mutant. Tests 1, 2, 9 mutate `selection.ts`; 3–8 mutate
the mirror's `changeSource` / `handleTracks` (the mirror *is* the wiring under test in this pattern, and the
component copy is pinned by test 10 plus the future harness spec); 10 mutates `KitPlayer.tsx`.

| Test | Mutation | Expected red |
|---|---|---|
| 1 | `sourceChanged` returns `true` unconditionally | same-uri case |
| 2 | `return JSON.stringify(prev) !== JSON.stringify(next)` | headers-only case |
| 3 | drop `selected = applyTextSelection([], …).selected` (keep prune) → `selectedIds()` non-empty; separately drop the prune loop → `scheduler.tracks` non-empty; separately `adapterCalls.push([])` → length assertion | each |
| 4 | remove `scheduler.update(startAt)` from `changeSource` | no `[]` emission |
| 5 | remove `appliedPrefs = false` from `changeSource` | `selectedIds()` stays `['0']`, one adapter call |
| 6 | `acceptsTextTrackData` ignores `requestedFor`/`live` (`return selected.has(trackId)`) | `late()` returns `true` |
| 7 | `changeSource` skips the `sourceChanged` check | cues/selection wiped on same uri |
| 8 | `position = 0` unconditionally | `startAt` case |
| 9 | as 6 | the `(selected, other source)` combination |
| 10 | `useLayoutEffect` → `useEffect` in `KitPlayer.tsx` | guard |

Also run `pnpm typecheck`: the call in `KitPlayer.tsx` with two arguments must fail to compile once the new
parameters are required — that is the compile-time proof the component was updated, and why they are not
optional.

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | An adapter reads `props.onTextTrackData` through a latest-props ref (none does today; KIT-010's Vega rewrite might) — old fetches would reach the *new* handler and pass the origin gate. | Contract stated in the handler's doc comment and 0005 §4; KIT-010's plan must keep closure capture or abandon in-flight fetches on source change. The selected gate still refuses VTT until the new source selects the id, so the exposure is the same-id window only. |
| R2 | `props.onCue([])` runs inside a layout effect; an app that calls `flushSync` in `onCue` (the harness page does) gets React's "flushSync inside a lifecycle" warning. | Neither app does; the harness only when the future source-switch spec lands, and §3 says how to guard it. Not a correctness issue. |
| R3 | `setTracks`/`setPosition` in a layout effect trigger one synchronous re-render before paint. | Once per source change; negligible. |
| R4 | The scheduler is rebuilt in the same render if `onCue` identity changes (KIT-012) → no `onCue([])`, overlay keeps its last cue until the new source's first cue. | Pre-existing; KIT-012 fixes it; KIT-011 must not touch line 23. |
| R5 | `api.getTracks()` prefers the adapter's stale `tracks` ref while `renderControls` shows `[]`. | Adapter follow-up (0005 Consequences); one line per adapter; ticket it, do not fold in — the fireos structural guards in `test/hls-load.test.ts` pin adapter shape. |
| R6 | A source change while `selectText` on the *new* source is pending from an app call before `onTracks` — impossible; the app cannot know the new ids before `onTracks`. | — |
| R7 | Mirror drift: the mirror's `changeSource` and the component's effect diverge. | Same trade KIT-009 made and documented in the file's NOTE; the future harness spec closes it on web. |

---

## 6. Changeset

Append to `.changeset/release-0-1-0.md` (the 0.1.0 release notes are one file since `d36b2bc`; the file is
already `minor`, and this is a `patch`-level fix within it). If 0.1.0 has been cut by the time this lands,
write `.changeset/source-change-reset.md` with `'@moizp/vega-media-kit': patch` and the same paragraph.

```
**Switching `source` resets text selection and cues.** Changing `source.uri` now clears the selected text
tracks and every pending cue (`onCue([])` fires once if cues were on screen), resets the `tracks` and
`position` handed to `renderControls`, and re-applies `preferredAudio` and `preferredText` on the new
source's first `onTracks`. Previously a second source inherited the first one's selected ids — which collide,
since ids are ordinals — and its cues, and preferences were never applied again. WebVTT fetched for the
previous source is dropped even when the new source selects the same id. `type`- or `headers`-only changes
are not a source change, matching when the adapters reload. Multi-track text selection is unchanged.
```

---

## 7. Open questions

None block. One for the orchestrator to ticket, not answer: the three adapter follow-ups in 0005 Consequences
(stale `tracks` ref; fireos `audioIndex`; abandon in-flight fetches — the last belongs with KIT-016) and the
harness source-switch spec in §3.
