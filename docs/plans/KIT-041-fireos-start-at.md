# KIT-041 — Fire OS never applies `startAt`

**Ticket:** KIT-041 (from KIT-038 plan Q3) · **Base:** `main` `584d222` · **Planner:** opus (desk spike, no device run)
**Verdict:** the bug is real, and the code alone proves it. The fix is react-native-video's `source.startPosition`, which the
installed 6.19.x applies natively before `prepare()`, so no frame 0 is shown and no seek is needed. **Changeset: patch.**

---

## 1. Evidence (code reading)

### 1.1 The adapter never hands `startAt` to ExoPlayer

| Where | What |
|---|---|
| `src/player/adapters/fireos.tsx:137` | `source={{ uri, type, headers }}`. There is no `startPosition` and no other start prop on `<Video>` (`:132-154`). |
| `fireos.tsx:36, :60` | `videoRef.seek` is called only from `api.seek`. Nothing seeks on `onLoadStart` / `onLoad` (`:88-129`). |
| `fireos.tsx:42` | `position = useRef(props.startAt ?? 0)` |
| `fireos.tsx:53` | It is reset to `props.startAt ?? 0` on a uri change (the KIT-020 layout effect). |
| `fireos.tsx:84` | `getPosition: () => position.current` |
| `fireos.tsx:148` | `onProgress` is the only other writer of `position.current`. |
| `KitPlayer.tsx:221, :230-233` | The kit's reset sets `position` / `positionRef` to `startAt ?? 0`. Decision 0005 §2.5 calls it "the value the adapter is about to seek to". On Fire OS nothing seeks. |

**What it reports before the first `onProgress`:** `getPosition()` (adapter and kit) and `renderControls`' `position`
answer `startAt`, while ExoPlayer plays from 0. The first `onProgress` arrives within react-native-video's default
`progressUpdateInterval` of 250 ms. It reports roughly 0.2 s, so the position jumps *down* from `startAt` to about 0 and
then counts up from the start of the media. The kit's scheduler shows cues from 0 as well, so cues stay consistent with
the picture. They are just at the wrong place in the video.

Web applies it (`web.tsx:133`, `v.currentTime = props.startAt` in the load effect). Vega applies it too (`p.load(uri, startAt)`,
unverified, decision 0001). Only Fire OS drops it.

### 1.2 The apps already know, and one ships a workaround

- **described** (`described/packages/shared-ui/src/screens/Player.tsx:360-365`, HEAD `b0adfe2`): *"The kit's Fire OS
  adapter does not apply `startAt` (react-native-video has no start position), so the resume point is sought once the
  load is up."* It passes `startAt={startAt.current}` (`:382`), then calls `seekTo(startAt)` on the first `ready`/`playing`.
  This is pinned by `packages/shared-ui/test/player.test.tsx:192` `'resumes from resumeS: startAt, then one seek once the
  load is up (Fire OS ignores startAt)'`. Two paths reach it: resume (`resumeS`) and deep links (`described://play/<slug>?t=N`
  → `startAtS`). The workaround hides the bug, at the cost of the resume showing frame 0 plus a rebuffer. Its comment is
  wrong about react-native-video, which does have a start position (§1.3).
  `described/TASKS.md:40` also has an open kit item: *"the Fire OS adapter's seek should … honour startAt"*.
- **lingo** (`lingo/packages/shared-ui/src/components/MiniPlayer.tsx:39-51`, HEAD `f2af7db`): `<KitPlayer key={…startS…}
  autoplay startAt={startS}>` plays one cue span and stops at `shouldStop(s, endS)` (`:14`). **lingo has no workaround.**
  On Fire OS every Words / Quiz-replay clip (`Words.tsx:125`, `Quiz.tsx:107`) plays from 0:00 until `endS`. The learner
  sees and hears the wrong part of the video, for as many seconds as the cue's offset. For lingo this is the
  demo-visible failure. No lingo friction log or spot-check mentions it.
- The harness `KitSpikeScreen.tsx` passes no `startAt`, which is why the device matrix never saw this.

**Who is affected in the demo:** lingo on the Fire TV stick, badly: every clip starts at the wrong place. described on
the stick, mildly: a frame-0 flash and a seek on resume or deep link. Once the kit is fixed, described's extra seek should
be removed (app ticket, §8).

### 1.3 react-native-video supports a start position, natively, in the installed version

Installed versions: the kit has `6.19.2` (devDependency; peer `>=6`, `package.json:88`), and so do `described/apps/expo`
and `lingo/apps/expo`. The harness `react-native-multi-tv-app-sample/apps/expo-multi-tv` has `6.19.1`, and its Java
code at `ReactExoplayerView.java:884` is identical.

| File (`node_modules/react-native-video/…`) | What |
|---|---|
| `src/types/video.ts:33` | `ReactVideoSourceProperties.startPosition?: number` |
| `src/Video.tsx:291` | Sent to native as `startPosition: resolvedSource.startPosition ?? -1` |
| `src/specs/VideoNativeComponent.ts:52` | `startPosition?: Float` |
| `android/…/common/api/Source.kt:39, :169, :231` | `startPositionMs`, parsed with `safeGetInt(src, "startPosition", -1)`. This is an **int, in ms**. |
| `android/…/exoplayer/ReactExoplayerView.java:879-890` | `if (haveResumePosition) seekTo(resume…) else if (startPositionMs > 0) player.setMediaSource(mediaSource, startPositionMs) else setMediaSource(mediaSource, true)`, then `prepare()`. The position is set **before `prepare()`**: no buffering from 0, no frame 0, no seek. |
| `ReactExoplayerView.java:2040-2067` + `Source.kt:95-101` | `setSrc` reloads when `!source.isEquals(this.source)`, and **`equals` includes `startPositionMs`**. So the same uri with a different `startPosition` **reloads the player**. See §3 R2. |
| `ReactExoplayerView.java:1505-1506, :1527` | `onLoad` carries `currentPosition`, which will be `startAt` once the fix is in. |

Doc: <https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props#start-playback-at-a-specific-point-in-time>.
It says: *"Provide an optional `startPosition` for video playback. The value is in milliseconds. … (If it is negative,
undefined, or `null`, it is ignored.)"* It lists Platforms: Android | iOS | web. The `source` prop is documented at
`…/props#source`.

### 1.4 Fix options (Q3)

| Option | Verdict |
|---|---|
| **A. `source.startPosition` (ms)** | **Chosen.** The start is native and happens before `prepare()`. No frame 0, no wasted segment fetch, no position jump. `onLoad` / `onProgress` report `startAt` onward. No JS timing. |
| B. `videoRef.seek(startAt)` in `onLoad` | Rejected. `onLoad` fires at `STATE_READY` (`videoLoaded`, `:1485`). By then frame 0 has been decoded, and with `autoplay` it is already playing: on the stick `playing` precedes `onLoad`'s continuation (KIT-028). You would get a visible and audible frame-0 blip, a rebuffer, and an `onProgress` near 0 before the seek lands (position jumps 12 → 0.2 → 12). The seek would also have to happen before the manifest `await` (`:112`) or wait for the master playlist. This is described's workaround, and it is what we are removing. |
| C. A seek in `onLoadStart` | Rejected. The player has no timeline yet, and react-native-video's own path for this is A. |

Keep B as the fallback **only if** device check D1 shows that A is ignored on the stick (§5).

---

## 2. Interaction with KIT-023 (per-load record) and `key={source.uri}`

- `<Video key={props.source.uri}>` (`:135`) mounts a fresh native view for each uri. A new view has no `resumeWindow`,
  and `setSrc` calls `clearResumePosition()` anyway (`:2042`). So `startPositionMs` is the path taken on every load,
  including A→B→A, which is a new mount with a fresh latch.
- **The start must be latched per load, not read per render (R2).** `Source.equals` includes `startPositionMs`, so a
  `startAt` prop that changes while the uri stays the same would make ExoPlayer **reload the same uri**. That would
  restart playback at the new point, and the kit would see no reset. Web and Vega read `startAt` once per load (their
  load effects are keyed on `source.uri`), so latching per uri matches them.
- **Do not latch in the `Load` record.** `load.current` is replaced in the KIT-020 layout effect (`:50-55`), which
  runs *after* the render that first carries the new uri. That render (the first one that mounts B's `<Video>`) would
  read A's record and mount B with A's start. Use React's derived-state pattern instead, keyed on uri
  (<https://react.dev/reference/react/useState#storing-information-from-previous-renders>). It is computed during
  render, so B's first render already has B's start.
- **KIT-034 overlap:** that plan adds `failed` to `Load` / `newLoad` (`docs/plans/KIT-034-error-state.md` §4.1) and
  edits the `onError` / `onBuffer` / `onPlaybackStateChanged` / `onLoadStart` props. KIT-041 touches neither `Load`
  nor those handlers. It touches only the `source=` line, a new `useState` near `:41`, and a new `describe` in the test
  file. Expect a trivial textual merge in `fireos.tsx` (adjacent lines) and in the test rig (`rig` fields). Either
  order works. I recommend **after KIT-034**, so its rig changes land first.
- **KIT-035 (`reload()`, decision 0009):** its load key becomes `${generation}:${uri}` and `<Video key>` follows it.
  The start latch must be keyed on **the same load key**, so a `reload()` restarts at the current `startAt` and not at
  0. Flag this in KIT-035's brief. Whether `reload()` should resume from the failure position instead is KIT-035's call.
- **KIT-038:** its R-P4 / K-P5 (mount position = `startAt`) and 0005 §2.5 become *true* on Fire OS with this fix. No
  change to KIT-038 is needed.
- **KIT-040 (autoplay per load):** this edits the same `<Video>` block. There is no semantic overlap.

---

## 3. Fix

### 3.1 `src/player/adapters/fireos.tsx`

```ts
/** startAt in whole ms for react-native-video's `source.startPosition`; undefined when there is nothing to apply. */
const startPositionMs = (s?: number) => (s !== undefined && Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : undefined)

// in the component, beside the other state (≈ :41):
// The start of the current load, latched per source.uri (derived state; React docs "storing information from previous
// renders"). Not read per render: react-native-video reloads when source.startPosition changes (Source.equals), so a
// startAt change on the same uri must not reach it. Not in the Load record: that is replaced in a layout effect, after
// the render that mounts the new <Video>.
const [start, setStart] = useState(() => ({ uri: props.source.uri, ms: startPositionMs(props.startAt) }))
if (start.uri !== props.source.uri) setStart({ uri: props.source.uri, ms: startPositionMs(props.startAt) })
// …and use `start.uri === props.source.uri ? start.ms : startPositionMs(props.startAt)` in the JSX (the render that
// calls setStart is re-run by React before commit, but compute defensively so a discarded pass never shows A's start)
```

`<Video source={{ uri, type, headers, startPosition: <latched ms> }}>`. Leave the key **out** when it is `undefined`,
so the source object for "no `startAt`" stays exactly what it is today.

- R1. When `startAt > 0` and finite, `source.startPosition = Math.round(startAt * 1000)`. When `startAt` is
  undefined, 0, negative, NaN or ±Infinity, the key is absent.
- R2. The value is latched per `source.uri`. A `startAt` change on the same uri leaves the `source` prop deep-equal
  and causes no re-mount.
- R3. The first render with a new uri already carries that uri's start. No commit shows B with A's start.
- R4. No `seek` on load. `position.current` stays as it is (`:42`, `:53`). It is already `startAt ?? 0`, which is
  now correct. Optional, not required: when `onLoad`'s `currentTime` is provided, take it. Skipped, because it would
  need a `Load.started` / superseded guard for a value that is already right.
- R5. The doc comment on `FireOsAdapter` (`:24-33`) gets one line: "`startAt` → `source.startPosition` (ms, applied
  before `prepare()`)", with the doc URL.

### 3.2 `src/player/types.ts`

JSDoc on `KitPlayerProps.startAt` (`:38`, currently undocumented):

> Seconds. Where each load of `source.uri` starts playing. It is read once per load, when the uri changes or on mount.
> Changing it while the uri stays the same does nothing: call `seek`. Fire OS: react-native-video `source.startPosition`
> (applied before the first frame). Web: `currentTime` at load. Vega: `player.load(uri, startAt)` (not device-verified).
> `getPosition()` answers it until the first position report.

### 3.3 `.changeset/fireos-start-at.md`, patch

> Fire OS: `startAt` is now applied. Playback used to start at 0 while `getPosition()` reported `startAt`.
> react-native-video's `source.startPosition` starts the load at `startAt`, with no frame-0 flash and no seek.
> `startAt` is read once per `source.uri`. Apps that seeked to `startAt` themselves after `ready` can drop that seek.

### Files

| File | Change |
|---|---|
| `src/player/adapters/fireos.tsx` | `startPositionMs`, latched `start` state, `source.startPosition`, doc line |
| `src/player/types.ts` | `startAt` JSDoc |
| `test/fireos-adapter.test.tsx` | `rig.sources` history + `rig.seek` spy; new `describe` (§4) |
| `.changeset/fireos-start-at.md` | patch |
| `docs/device-matrix.md` | new row "Start position (KIT-041)" after D1/D2 |

`src/core` is untouched, the rule that `src/core` has no React Native imports still holds, and no other adapter changes.

---

## 4. Tests: `test/fireos-adapter.test.tsx`

The rig uses mocked rnv, as today. The changes:
- Extend `render(uri, headers?, opts?)` so `opts` takes `startAt?: number`.
- `MockVideo` pushes `{ uri: props.source.uri, startPosition: props.source.startPosition }` to `rig.sources` on every render.
- `MockVideo` exposes `seek` through its `ref` prop (React 19 passes `ref` as a prop to a function component;
  `useImperativeHandle(props.ref, () => ({ seek: rig.seek }))`).
- Reset `rig.sources` and `rig.seek` in `beforeEach`.

`describe('FireOsAdapter — startAt (KIT-041)')`:

- **S1** `it('passes startAt to react-native-video as source.startPosition in whole milliseconds')`: mount A with
  `startAt: 12.5` → `rig.props.source.startPosition === 12500`. Also `startAt: 1.2345` → `1235`.
- **S2** `it('passes no startPosition without startAt, or for 0, negative and non-finite startAt')`: undefined, `0`,
  `-5`, `NaN` each give `'startPosition' in rig.props.source === false`.
- **S3** `it('latches the start per load: a startAt change on the same uri leaves source unchanged and does not re-mount')`:
  A with `startAt: 10`, then a re-render of A with `startAt: 99` → `startPosition === 10000` and
  `[mounts, unmounts] === [1, 0]`.
- **S4** `it("a source change takes the new render's startAt; a source without one gets none")`: A `startAt: 10` → B
  `startAt: 30` → `30000`, then C with no `startAt` → no key.
- **S5** `it("no render of the new source carries the previous source's start")`: A `startAt: 10` → B `startAt: 30`.
  Every `rig.sources` entry with `uri === B` has `startPosition === 30000`. This catches the "latched in `Load` / ref
  read during render" mutation.
- **S6** `it('does not seek on load: the start is native')`: mount with `startAt: 12`, `loadStart`, `load`,
  `release(0, MASTER_A)` → `rig.seek` not called.
- **S7** `it('getPosition() answers startAt from mount until the first onProgress, then the reported time')`: mount
  `startAt: 12` → `12`. `onProgress({ currentTime: 12.25 })` → `12.25`. This pins the existing behaviour, which is now
  coherent with playback.

Existing tests stay green unchanged. `'mounts a fresh react-native-video instance per source.uri'` uses `toMatchObject`,
so it is unaffected. KIT-020's `getPosition() === 0` after the switch is still right, because B has no `startAt`.

### Mutation table

| # | Mutation | Caught by |
|---|---|---|
| M1 | `startPosition` not passed (today's code) | S1, S4 |
| M2 | Seconds, not ms (`startPosition: startAt`) | S1 |
| M3 | No rounding (`12.3456*1000`) | S1 (1.2345 case) |
| M4 | `startPosition: props.startAt * 1000` per render, no latch | S3 |
| M5 | Latch stored in the `Load` record / a ref updated in the layout effect | S5 (and S4's first B render) |
| M6 | Latch keyed on `startAt` instead of uri | S3 |
| M7 | `startPosition: 0` / `-1` sent when there is no `startAt` | S2 |
| M8 | `videoRef.seek(startAt)` added in `onLoad` (option B alongside A) | S6 |
| M9 | `position` init changed to 0 | S7 |

Run: `pnpm typecheck && pnpm test`. Lint goes through KIT-037's config if it has landed.

---

## 5. Device checks: Fire TV Stick `AFTSS` (Fire OS 7.7.1.6)

Setup follows the runbook (`docs/spike-runbook.md` §2, §2.7): `react-native-multi-tv-app-sample` with the kit
`portal:`-linked, `adb connect <STICK_IP>:5555 && yarn dev:android`. Metro serves the kit from source, so a kit change
needs only a JS reload and no native rebuild (react-native-video 6.19.1 native is unchanged).

Harness edit (app-side, uncommitted like the rest of `KitSpikeScreen.tsx`): add `const START_AT = 40`, pass
`startAt={START_AT}` to `<KitPlayer>`, set `SCRIPT = false` (the scripted seek at +22 s would confuse the reading), and
log once on the first position: in `onPosition`, `if (!firstPos.current) { firstPos.current = true; log('firstPos', p.toFixed(2)) }`.
The URI stays at `sintel-90-150` (90 → 150 s cut, about 60 s long, so 40 s is inside it).

```
adb logcat -c
adb logcat -v time | grep KIT-SPIKE | tee ~/hackathon/spike-evidence/fireos-kit041-<base|fix>.log
```

- **D1, base (`584d222`), to confirm the bug, about 5 min.** Expected: `state loading` → … → `firstPos 0.xx` (< 2), then
  `pos` lines 1, 2, 3 … The HUD shows `40.0s` before playback, then drops to about 0.3 s. The picture is Sintel's
  opening of the cut. Any `firstPos` < 5 **confirms KIT-041**.
- **D1, fix.** Expected: `firstPos` ≥ 39.5 and `pos` lines rising monotonically from about 40. The HUD never shows a
  value below 40 after launch. No `firstPos` near 0 (no frame-0 flash, consistent with no seek). `cue` lines' `pos` ≥ 40
  and cue start times near 40. **Pass** = `firstPos ∈ [39.5, 41.5]` and no `pos` line < 39.5 after `state playing`.
  **Fail** = it behaves like base. Then `startPosition` is not honoured on the stick, so take option B (§1.4) back to
  the planner, and write a friction log.
- **D2, fix, `startAt` removed (no regression).** `firstPos` < 2, as before.
- **D3, optional, fix, switch.** Add a button that swaps `URI` to Angel One with `startAt={20}` (keep both constants).
  After the switch: `firstPos`-style first `pos` for B ≈ 20, and B never reports a time from A. Not blocking. It is
  covered by S4/S5, and `key={uri}` gives a fresh native view.
- **D4, app acceptance (lingo, after the kit lands, owner lingo).** On the stick, open Words → play a word. The clip's
  audio and picture match the cue text, and the clip stops after about `endS - startS` seconds, not after `endS`.

Record D1 and D2 as a device-matrix row: "Start position (KIT-041)", with the evidence log paths.

**Does the device check have to come before implementation? No.** The defect is certain from the code (§1.1).
described's shipped workaround and its test name already confirm it. The fix mechanism is read from the exact
installed native source (§1.3), and it is the documented API. Implement against the mocked tests first. Then run D1
base and D1 fix back to back in one stick session (Metro reload between them, about 15 min in total). Only D1-fix gates
closing the ticket. If the stick is already connected, running D1-base first costs 5 minutes and is good evidence for
the friction log, but it does not block.

---

## 6. Risks

- **R-a. Rerender reload (handled by R2).** If the latch regresses, any app that passes a changing `startAt` on the same
  uri silently reloads ExoPlayer. described's `startAt={startAt.current}` changes only alongside `key={attempt}`, and
  lingo's alongside `key`, so neither app triggers this today. S3 pins it.
- **R-b. Deep-equal of the `source` prop.** The kit builds `source` inline every render, as it does today. Adding a
  primitive key does not change how react-native-video diffs it.
- **R-c. described double start.** After this fix, described's workaround seeks to the position the player is already
  at. That is harmless, but costs a short rebuffer on resume. It needs an app ticket (§8), not a kit fix.
- **R-d. `startAt` past the end.** ExoPlayer starts at the end and `onEnd` follows. That is the same as web's
  `currentTime` clamp. Not specified, not tested.
- **R-e. Live HLS.** `setMediaSource(src, ms)` is relative to the window. The kit is VOD-only today, so this is noted only.
- **R-f. Older react-native-video 6.x below `startPosition`'s introduction.** The peer is `>=6`. The docs page does
  not say which version added it, and an older version ignores the unknown key (no crash; it plays from 0 as today).
  Both apps pin `^6.16.0`, which is fine. Optionally tighten the peer in a later minor. Not blocking.
- **R-g. React 19 derived state.** The `setState` during render must be guarded (`start.uri !== uri`), or it loops.
  S3 and S4 exercise it.

## 7. Out of scope

Vega start verification (KIT-010). `reload()` start semantics (KIT-035; see §2). KIT-040's autoplay. described's and
lingo's app code.

## 8. Open questions (none blocking)

- **Q1 (non-blocking, decided here).** Should `startAt` changes on a live uri do anything? No. Read it once per load,
  matching web and Vega. This is documented in the JSDoc (§3.2). A `seek` covers "go elsewhere".
- **Q2 (non-blocking, app tickets for the orchestrator to open).** described: delete the Fire OS resume seek
  (`Player.tsx:360-365`) and update `player.test.tsx:192`, then tick `described/TASKS.md:40`. Check that a seek sent
  before the load is up still wins: `'a seek sent before the load is up wins over the resume point'` keeps that path.
  lingo: no code change. Add D4 to its spot-checks once the kit lands.
- **Q3 (non-blocking).** Friction log in the consuming apps' `docs/friction/` (CLAUDE.md format)? Only if D1-fix fails.
  The platform itself is not at fault here; the kit is.
- **Q4 (non-blocking, KIT-035).** `reload()`'s load key must also key the start latch (§2).
