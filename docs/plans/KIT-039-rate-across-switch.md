# KIT-039 — Playback rate (and volume) across a source switch

**Ticket:** KIT-039 (from `docs/plans/KIT-020-adapter-tracks-reset.md` §10 Q3) · **Base:** `main` `efefa95`
**Status:** plan — **BLOCKED on a human policy decision (§4)**. Everything after §4 assumes the recommended option A.
**Parallel:** KIT-038 (`getPosition` during a switch) is planned separately; no file overlap except possibly
`docs/getting-started.md` (different section) and `harness/e2e/player.spec.ts` (append-only).

---

## 0. The question

`KitPlayerRef.setRate(r)` and `KitPlayerRef.setVolume(v)` are imperative settings the app makes on one `KitPlayer`. When
the same `KitPlayer` gets a new `source.uri` (decision 0005), does the setting carry over to the new source, or go back to
the default (1×, volume 1)? Today the answer depends on the platform for rate and is documented only for volume. The kit's
promise is one behaviour on every platform, so the kit has to pick one and make every adapter do it.

Out of scope: a remounted `KitPlayer` (new `key`, route change). It is a new player and starts at 1× / volume 1 on every
platform under every option; both consuming apps switch content that way today (§2).

---

## 1. Current behaviour per adapter (evidence)

| | rate after `setRate(0.75)` then `source.uri` A → B | volume after `setVolume(0.3)` then A → B |
|---|---|---|
| **Web** (`adapters/web.tsx`) | **1×** — reset | **0.3** — kept |
| **Fire OS** (`adapters/fireos.tsx`) | **0.75×** — kept | **0.3** — kept |
| **Vega** (`adapters/vega.tsx`, scaffold, does not play — 0001/0002) | **probably 1×** — reset (UNVERIFIED) | n/a — `setVolume` is a logged no-op |

**Web.** `setRate` writes `el.playbackRate` only (`web.tsx:148`); the load effect reuses the same `<video>` and assigns
`v.src = props.source.uri` (`web.tsx:132`). The HTML media element load algorithm, run on every `src` assignment, sets
`playbackRate` to `defaultPlaybackRate` and does not touch `volume` or `muted`
(https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm). Probed in headless Chromium (Playwright,
2026-10-10, this planning session):

```
set playbackRate=0.75, volume=0.3, muted=true; then src = B
  → playbackRate 1, volume 0.3, muted true
set defaultPlaybackRate=0.75 and playbackRate=0.75; then src = C
  → playbackRate 0.75, defaultPlaybackRate 0.75
```

So web resets rate and keeps volume, and **setting `defaultPlaybackRate` alongside `playbackRate` makes the load algorithm
restore the app's rate itself** — no re-apply, no 1× window. jsdom does not run the load algorithm, which is why the
existing vitest `'is kept across a source change'` (`test/web-adapter-volume.test.tsx:58`) passes for volume and why no
vitest can observe the web rate reset; only the Playwright harness can.

**Fire OS.** `rate` and `volume` are `useState` in the adapter (`fireos.tsx:38,40`), passed as props to
`<Video key={props.source.uri} rate={rate} volume={volume}>` (`fireos.tsx:135-141`). A uri change remounts `<Video>` (new
ExoPlayer) but not the adapter, and the KIT-020 layout effect (`fireos.tsx:50-55`) resets the load record, position and
`audioIndex` only. The new ExoPlayer mounts with the old `rate` and `volume`. Volume is pinned by
`test/fireos-adapter.test.tsx:392` `'is kept across a source change: the new <Video> mounts at the same volume'`; rate is
not pinned. Device evidence that 0.75× works on Fire OS at all: `docs/device-matrix.md:9`.

**Vega.** `setRate` writes `media.current.playbackRate` (`vega.tsx:67`). Every uri change destroys the Shaka `Player` and
creates a new one that `attach`es and `load`s onto the same element (`vega.tsx:29-52`). Shaka over MSE assigns a new
`src` (a MediaSource blob URL), so if w3cmedia's `VideoPlayer` follows `HTMLMediaElement` the load algorithm resets the
rate as on web. Not verifiable: the scaffold does not play (decision 0002, KIT-010), and lingo's
`packages/shared-ui/src/platformCaps.ts:15` records that w3cmedia lists `playbackRate` as **unsupported**, so `setRate`
may be a no-op on Vega regardless. `setVolume` is a documented no-op (`vega.tsx:103`, DESC-006).

**The kit.** `KitPlayer.tsx:245-249` forwards `setRate`/`setVolume` straight to the adapter and holds neither. The 0005
reset (`KitPlayer.tsx:218-235`) does not mention them; 0005 §3 says "adapter internals (`fireos` `paused`/`rate`/…) are
theirs". So the kit has no policy; each adapter's accident is the behaviour.

**Docs.** Volume: "The volume is kept across source changes" — `KitPlayerRef.setVolume` JSDoc (`types.ts:18`),
`docs/getting-started.md:86`, `.changeset/desc-006-set-volume.md`. Rate: `setRate` has no JSDoc and no getting-started
section. Nothing is released yet (`package.json` `0.1.0-alpha.0`), so either policy can still be adopted without a
breaking release.

**Adjacent, not this ticket (flag for the orchestrator).** Fire OS also keeps `paused` across a switch (`fireos.tsx:37`,
initialised from `autoplay` once): a paused app switching source stays paused even with `autoplay`, and a playing app's
new source plays even without `autoplay`. Web's load algorithm sets `paused` to true and the adapter then honours
`autoplay` per load. Different behaviour, same shape as this ticket; suggest a KIT-040 rather than widening this one.

---

## 2. What the apps actually do

Searched `/Users/moizp/hackathon/{described,lingo,spot}` (excluding `node_modules`, worktrees, tests).

- **lingo** — the only `setRate` user. A Plus learner toggles 1× ↔ 0.75× ("Slower", settings sheet):
  `packages/shared-ui/src/screens/player/machine.ts:111-113` keeps `rate: 1 | 0.75` in the Player's state machine, emits a
  `rate` effect, and `screens/Player.tsx:93` calls `kit.current?.setRate(fx.r)`. The status line and Explain card render
  `state.rate` (`Player.tsx:190,203,218`). Source is `clip.manifestUrl`; the Player is one route and the next clip goes
  through Summary → clip → player (`app/Root.tsx:151,205-258`), i.e. **a remount**, and the machine's `initialState` starts
  at `rate: 1` (`machine.ts:36`). Vega is `rate: false` (and `playback: false`). Today: unaffected by any option. If lingo
  ever changes clip in place (auto-advance), its machine would still say 0.75 — option A matches that on every platform;
  option B/C would show "0.75×" in the status line while web plays 1×, unless lingo resets its own state on a clip change.
- **described** — the only `setVolume` user: `crossfadeAudio` steps 1 → 0 → 1 around `selectAudio`
  (`packages/shared-ui/src/playback.ts:109-133`); the fade always ends at 1. `KitPlayer` is remounted per attempt
  (`screens/Player.tsx:378-381`, `key={attempt}`), and the comment at `playback.ts:121-123` relies on that. It never
  calls `setRate`. Today: unaffected by any option. Under B, a source change mid-fade would snap to 1 then be stepped by
  the fade anyway — harmless; under A it continues the fade — also harmless.
- **spot** — neither.

Conclusion: **no app depends on either behaviour today**; the decision is about the contract the kit publishes, and about
not leaving a platform-dependent difference in it.

---

## 3. Options

### A — Rate and volume are the app's settings: kept across source changes, on every platform  *(recommended)*

Rule: `setRate` and `setVolume` set a property **of the player**, not of the source. A `source.uri` change keeps both; a
new `KitPlayer` starts at 1× and volume 1. This extends what volume already promises to rate.

- Web: `setRate` also sets `el.defaultPlaybackRate` (one line). The load algorithm then restores the rate itself, inside
  the same `src` assignment — **no window at 1×**, no event to hook, no race with the load.
- Fire OS: already does it (adapter state survives the `<Video>` remount). Add the missing pin test.
- Vega: carry the rate over in the KIT-010 rewrite (set `defaultPlaybackRate` too, and re-apply after `load` if the
  device shows Shaka/w3cmedia ignores it). The scaffold does not play, so nothing is lost by deferring.
- Kit: no new state. Fits 0005 §3 ("the kit only resets what it owns") — rate and volume are not per-source state, the way
  tracks, selection and position are.
- Apps: lingo and described need nothing. An app that wants "1× for every new source" calls `setRate(1)` when it changes
  `source` (it knows when it does; it is the one changing the prop).
- Cost: web one line + tests; Fire OS tests only; docs; patch changeset.
- Risk: an app that toggles 0.75× for one hard clip and auto-advances will keep 0.75× on the next — which is what a
  learner who chose "slower" usually wants, and what every desktop/TV player with a speed menu does within a session
  (YouTube, Netflix, ExoPlayer's own `PlaybackParameters` survive `setMediaItem`).

### B — Both reset to defaults on a source change, on every platform

Rule: a `source.uri` change resets rate to 1× and volume to 1 alongside 0005's per-source reset.

- Web: rate already resets; add `el.volume = 1` in the existing KIT-020 layout effect (`web.tsx:74-76`).
- Fire OS: `setRate(1); setVolume(1)` in the existing layout effect (`fireos.tsx:50-55`).
- Vega: rate likely resets for free; volume is a no-op.
- **Reverses a documented contract** (DESC-006: "kept across source changes" in the JSDoc, getting-started and the
  changeset); unreleased, so allowed, but described's owner should agree.
- Apps that want a persistent rate must re-apply it after every switch — and on Fire OS/web there is an audible 1× / full
  volume window between the load and the app's re-apply (it can only react to `onState('loading')` or later). A muted
  or faded-down player un-mutes itself on every source change, which is the worse failure of the two.
- lingo would need to reset its machine's `rate` on an in-place clip change to keep its status line honest.

### C — Split: rate resets, volume is kept

Rule: rate is "how this content plays" (a learner slows one hard clip), volume is "how loud this device is".

- Web: no change (already this). Fire OS: `setRate(1)` in the layout effect. Docs: say so.
- Cheapest change that is consistent per setting, and matches the HTML default exactly.
- But it is two rules where one would do, and the "rate is per content" premise is weak: the one app that uses rate
  models it as a learner setting held in its own state, not per clip. Inherits B's 1× window for apps that want it kept.

(Rejected without a letter: **document the divergence** — a platform-dependent result is exactly what the kit exists to
remove, and the harness could not pin it.)

---

## 4. BLOCKING — human decision

> **When an app changes `source` on the same `KitPlayer`, should the playback rate and volume it set be kept (A),
> reset to 1× / full volume (B), or rate reset and volume kept (C)?**
> Recommendation: **A** — keep both; it is one rule, matches the volume contract already documented, needs one line on
> web (`defaultPlaybackRate`), nothing on Fire OS, and no consuming app changes. Apps wanting 1× per source call
> `setRate(1)` when they switch.

The orchestrator records the answer as a decision (suggest `docs/decisions/0009-settings-across-source-change.md`) and
amends 0005 §3 with one line pointing to it. If B or C is chosen, §5–§7 change as noted in §8.

---

## 5. Implementation (option A)

### 5.1 Behaviour rules

- **R1.** After `setRate(r)`, every later source loaded by the same `KitPlayer` plays at `r` from its first frame, until
  the app calls `setRate` again. Same for `setVolume(v)` (already true; now pinned on web in a real browser).
- **R2.** A new `KitPlayer` (mount / remount) starts at rate 1 and volume 1. Unchanged.
- **R3.** The kit holds no rate/volume state; carrying them over is an adapter obligation, stated in the `AdapterProps`
  contract (so KIT-010's Vega rewrite inherits it).
- **R4.** No `onState`/`onPosition`/other report is emitted for a rate or volume change or carry-over (0005 §3: the kit
  never synthesises reports).

### 5.2 Files

| File | Change |
|---|---|
| `src/player/adapters/web.tsx` | `setRate: (r) => { const v = el.current; if (v) { v.defaultPlaybackRate = r; v.playbackRate = r } }` with a 2-line comment citing the load algorithm URL and KIT-039. Order: `defaultPlaybackRate` first (both fire `ratechange`; nothing listens). Nothing else — no ref, no re-apply in the load effect. |
| `src/player/adapters/fireos.tsx` | **No code change.** Optionally extend the `rate`/`volume` state comment (`:38-40`) with "kept across source changes (KIT-039): state of the adapter, not of the `<Video>` key". |
| `src/player/adapters/vega.tsx` | **No change in this ticket** (scaffold; does not play). Add one line to the KIT-010 checklist instead (see `TASKS.md`, orchestrator): "carry `setRate` over to each new load — set `defaultPlaybackRate` too; re-apply after `p.load()` if the VVD shows it reset (KIT-039); if w3cmedia rejects `playbackRate`, make `setRate` a logged no-op like `setVolumeUnsupported`". |
| `src/player/types.ts` | `KitPlayerRef.setRate` gains JSDoc: "Playback rate. A property of the player, not of the source: kept across source changes (a new `KitPlayer` starts at 1). Fire OS: react-native-video's `rate` prop. Web: `HTMLMediaElement.playbackRate` and `defaultPlaybackRate`. Vega (experimental): unverified." `setVolume` JSDoc unchanged except "Kept across source changes" → "Kept across source changes, like `setRate`". `AdapterProps` contract gains one sentence: "`setRate` and `setVolume` are the app's settings, not per-source state: the next load must play at the last value set (KIT-039) — do not reset them in the per-uri layout effect." |
| `src/player/KitPlayer.tsx` | **No change.** (The 0005 reset comment could gain "rate and volume are not reset — they are the app's (KIT-039)"; optional, one line, at `:234`.) |
| `docs/getting-started.md` | Rename `## Volume` → `## Rate and volume`; add a short `setRate` paragraph before the volume one: allowed values `0.5 | 0.75 | 1 | 1.25`; "Rate and volume are kept when `source` changes on the same player; a new `KitPlayer` starts at 1× and full volume. To start each source at 1×, call `setRate(1)` when you change `source`." Keep the existing volume text. |
| `.changeset/kit-039-rate-across-switch.md` | **patch** (behaviour fix on web, no type change; §7). |
| `test/web-adapter-rate.test.tsx` *(new, mirrors `web-adapter-volume.test.tsx`)* | vitest, jsdom, real `KitPlayer` + `WebAdapter`. |
| `test/fireos-adapter.test.tsx` | one `describe` added next to the DESC-006 block. |
| `harness/e2e/player.spec.ts` | two specs appended. `harness/player.tsx` already exposes `__kit.ref` and `__kit.setSource(uri)`; no harness change expected. |

### 5.3 Tests

**vitest** (`pnpm test`):

`test/web-adapter-rate.test.tsx` — `describe('WebAdapter — setRate (KIT-039)')`
- `it('sets playbackRate and defaultPlaybackRate on the element')` — `setRate(0.75)` → both are `0.75`.
- `it('keeps defaultPlaybackRate across a source change, so the load algorithm restores the rate')` — `setRate(0.75)`,
  re-render with B → same element, `src` is B, `defaultPlaybackRate === 0.75`. (jsdom does not run the load algorithm;
  this pins the mechanism, the harness pins the behaviour. Say so in the file header.)
- `it('leaves the source alone: same element, same src')` — as the volume twin.
- If jsdom's `HTMLMediaElement` lacks `defaultPlaybackRate` as a settable property, the implementer defines it on the
  element in the test setup and notes it; do not stub `setRate`.

`test/fireos-adapter.test.tsx` — `describe('FireOsAdapter — setRate (KIT-039)')`
- `it('passes the rate to <Video>')` — `setRate(0.75)` → `rig.props.rate === 0.75`, no remount.
- `it('is kept across a source change: the new <Video> mounts at the same rate')` — `render(A)`, `setRate(0.75)`,
  `render(B)` → `rig.mounts === 2`, `rig.props.source.uri === B`, `rig.props.rate === 0.75`.
- `it('a new adapter starts at rate 1')` — fresh mount → `rig.props.rate === 1`.

**Playwright harness** (`harness/e2e/player.spec.ts`, real Chromium — the only place the load algorithm runs):
- `test('setRate(0.75) then a source switch: the new source plays at 0.75 — playbackRate and defaultPlaybackRate (KIT-039)')`
  — load A, `__kit.ref.setRate(0.75)`, `__kit.setSource(B)`, wait for B's `loadedmetadata` (or the kit's `ready`), assert
  `video.playbackRate === 0.75` and `video.currentSrc` ends with B. **Must fail on `main`** (it reads 1) — the implementer
  runs it once before the web change and reports the red.
- `test('setVolume(0.3) then a source switch: the new source keeps volume 0.3 (KIT-039, DESC-006)')` — same shape for
  `video.volume`. Expected green on `main` (spec says so; probe confirmed) — it pins the documented contract in a real
  browser for the first time.

Note: `__kit.play()` sets `muted = true`; these specs need not play, so do not call it, or assert after it — `muted` is
not part of this ticket.

**Done when:** `pnpm typecheck && pnpm test` green; the two harness specs green (first one red on `main`); changeset
present; getting-started updated; no change under `src/core`.

---

## 6. Changeset

`patch` — `.changeset/kit-039-rate-across-switch.md`:

> **Playback rate is kept when `source` changes.** `ref.setRate(r)` now carries over to the next source on the same
> `KitPlayer` on every platform, like `setVolume` already did. Previously web went back to 1× on every source change
> (the browser resets `playbackRate` when a new `src` loads) while Fire OS kept the rate. Web now also sets
> `HTMLMediaElement.defaultPlaybackRate`, so the new source starts at the chosen rate with no moment at 1×. A new
> `KitPlayer` still starts at 1×; to start every source at 1×, call `setRate(1)` when you change `source`. Vega
> (experimental): unverified. No type changes.

Patch, not minor: no API surface changes; it fixes a platform divergence in an undocumented behaviour (the same level
KIT-020 used for `getTracks`).

---

## 7. Risks

- **`defaultPlaybackRate` side effects on web.** It is also what UA-native controls treat as "normal speed"; the kit
  renders no native controls (`<video>` without `controls`), so none. It does not affect `seek` or `play()`.
- **Harness timing.** Read `playbackRate` after B's load has started (after `setSource` + `loadedmetadata`), not
  synchronously after `setSource` — the reset happens inside `src` assignment in the passive load effect, which
  `flushSync` does run, but waiting on metadata removes any doubt.
- **Vega.** Deferred to KIT-010; if the VVD shows w3cmedia rejects `playbackRate` (lingo's note), `setRate` becomes a
  documented no-op there and this contract is "kept" vacuously. Recorded in the KIT-010 checklist line.
- **KIT-038 overlap.** Both may edit `docs/getting-started.md` and append to `player.spec.ts`; land sequentially or
  rebase — no logical conflict.

---

## 8. If the human picks B or C instead

- **B (reset both):** `web.tsx` KIT-020 layout effect gains `if (el.current) el.current.volume = 1` (rate resets by
  itself); `fireos.tsx:50-55` layout effect gains `setRate(1); setVolume(1)` inside the `uri !==` branch. JSDoc of
  `setRate`/`setVolume` and getting-started say "reset to 1× / full volume on every source change". Tests invert:
  fireos `'resets to rate 1 and volume 1 on a source change'`, web vitest `'resets volume to 1 on a source change'`,
  existing `'is kept across a source change'` tests in `web-adapter-volume.test.tsx:58` and `fireos-adapter.test.tsx:392`
  are rewritten, harness specs assert 1 / 1. Changeset **minor** (reverses the DESC-006 documented contract); tell
  described's owner.
- **C (rate resets, volume kept):** `fireos.tsx:50-55` gains `setRate(1)`; web no code change; JSDoc/getting-started
  state the split; fireos test `'resets to rate 1 on a source change'`, harness rate spec asserts 1 (green on `main` for
  web), volume spec as in §5.3. Changeset **patch** (Fire OS behaviour change).

---

## 9. Open questions

- **Q1 — BLOCKING (human).** The policy: A, B or C (§4).
- **Q2 (non-blocking, orchestrator).** Open KIT-040 for Fire OS `paused` surviving a switch vs web's load-algorithm
  pause + per-load `autoplay` (§1 adjacent)? Same family; deliberately not folded in.
- **Q3 (non-blocking).** Should the kit expose the current rate (`getRate()`) so an app can render it without mirroring
  state? No app asks for it (lingo keeps its own); recommend no.
- **Q4 (non-blocking, KIT-010).** Does w3cmedia honour `playbackRate` at all (lingo's caps say unsupported; spike-runbook
  N7)? Decides whether Vega `setRate` is real or a logged no-op.
