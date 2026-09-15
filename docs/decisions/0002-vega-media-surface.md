# 0002 — The Vega adapter is a rewrite, not a rename

**Date:** 2026-09-15 (week 0)
**Status:** accepted
**Ticket:** KIT-001 (spike) → supersedes the "names only" premise in `src/player/adapters/vega.tsx:12`

## Context

`src/player/adapters/vega.tsx` was scaffolded on the assumption — stated in its own header comment at line
12 — that "everything marked `TODO(spike)` is expected to change **in name only**". The week-0 spike
(KIT-001) researched `AmazonAppDev/vega-video-sample` and Amazon's Vega 0.24 docs; a second sub-agent
then verified the two load-bearing claims against primary sources, cold. Both are **confirmed**.

## Findings

**1. `VideoPlayer` is a TypeScript class, not a React component.**

> "`VideoPlayer` is a typescript class and not a React Native component." — Vega API reference,
> `README.amazon-devices_react-native-w3cmedia`

Apps construct an instance, `await videoPlayer.initialize()`, and render a **separate** component,
`KeplerVideoSurfaceView`, whose `onSurfaceViewCreated` callback yields a surface handle passed back via
`videoPlayer.setSurfaceHandle(handle)`. Corroborated in `vega-video-sample`'s `PlayerScreen.tsx`, the
Shaka tarball's `AppPreBuffering.tsx` (lines 123-134, 188-191), and the multi-tv sample's
`VideoHandler.kepler.ts` (lines 139, 164).

**Consequence:** `vega.tsx:88` — `return <w3c.VideoPlayer ref={media} …>` — renders a non-component
class. `media.current` is never an `HTMLMediaElement`, so the effect's `if (!el) return` fires and Shaka
is never attached. The adapter cannot work as written; this is a rewrite of its lifecycle, not a rename.

**2. Shaka is vendored, not an npm dependency, and uses the constructor form.**

`vega-video-sample` has no `shaka-player` in `dependencies`. Its `postinstall` runs `shaka-setup/build.sh`,
which clones Shaka, checks out `v4.8.5`, applies Amazon's patch series with `git am`, builds with
`build/all.py`, and copies `dist/` into the app. The helper does `new shaka.Player(this.mediaElement)`
(`ShakaPlayer.ts:305`) — `attach()` appears nowhere. The patch series carries **44** patch files
(numbered 0001–0045 with 0016 absent; subjects read `[PATCH n/45]`).

**Consequence:** the kit's `require('shaka-player')` needs a Metro alias in the consuming app, and
`p.attach(el)` in the current adapter is the wrong shape.

**3. A custom `textDisplayFactory` is honoured** (high static confidence).

Amazon's patch `0023-Fix-captions-rendering.patch` changes `HTMLMediaElement.prototype.addTextTrack` to
`'addTextTrack' in this.video_`, but only inside `defaultConfig_()` — it changes the **default** factory.
Shaka 4.8.5 `lib/player.js` 2116 and 3505 call `this.config_.textDisplayFactory()` unconditionally and,
on a changed factory, call `setTextDisplayer` + `reloadTextStream`. Residual risk is runtime-only and is
settled by Test 3 run A in the runbook.

## Decision

The `TODO(spike)` at `vega.tsx:77` is no longer a two-way choice between "parse the master playlist" and
"capture via `textDisplayer`". Both remain open on the evidence, so the decision stays with the spike
result — but the adapter around it is rewritten regardless, to:

- construct `VideoPlayer`, `await initialize()`, render `KeplerVideoSurfaceView`, wire
  `onSurfaceViewCreated` → `setSurfaceHandle`;
- attach Shaka with `new shaka.Player(element)`, not `.attach()`;
- treat `shaka-player` as an app-vendored module reached through a Metro alias, not a kit dependency.

`Platform.OS` on Vega is **`'kepler'`** (Amazon's doc types it `enum('kelper')` — a typo in their docs).
`src/player/adapters/index.ts:15` and `src/platform/os.ts:5` already accept it; `adapters/index.ts:10`
and `docs/getting-started.md:13` still say `'vega'` and are wrong.

## Consequences

- The header comment at `vega.tsx:12` is false and must go with the rewrite.
- Public interfaces in `src/player/types.ts` and `src/core/types.ts` are **unaffected** — `KitPlayerProps`,
  `KitPlayerRef` and the `Cue` model all survive. No escalation to the apps was required.
- If the spike lands on the scheduler-over-fetched-VTT path, `src/player/hls.ts` (KIT-002/003/004) becomes
  a **prerequisite** for Vega cues rather than independent hardening. Sequence accordingly.
- The adapter rewrite is its own ticket with its own changeset. It is not done on the spike's scratch
  branch (`spike/KIT-001-vega-shim`), which exists only so the human can run tests 1-5.
