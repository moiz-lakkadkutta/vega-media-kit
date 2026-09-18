# KIT-005 — Playwright harness for `CueOverlay` via the web adapter, CI job, and plan Q7

**Role chain:** Planner (opus standing in for fable, this document) → Implementer (opus) → Reviewer (fable).
**Protocol:** `docs/ORCHESTRATOR.md` §3.2, §4, §6. **Folds in:** `docs/plans/KIT-002-hls.md` §9 Q7.
**Status:** ready for an implementer. Nothing in §11 blocks; one conditional fallback is pre-authorised (§11 Q1).

Goal in one sentence: Chromium under Playwright renders the **real** `CueOverlay` and the **real** `KitPlayer` +
`WebAdapter`, asserts the five overlay behaviours the human listed plus `onTracks` ordering, multi-track cue
delivery and the Q7 fix, and runs as a second CI job — after which the two web structural guards in
`test/hls-load.test.ts` retire because a stronger behavioural assertion replaces each.

Ticket text (verbatim, `docs/KICKOFF.md`): "Playwright harness for CueOverlay via the web adapter: line count,
42-char wrap, safe-zone insets, two-track stacking, selectable words. A CI job that runs it. Fold in plan Q7 — the
web adapter currently hands `.m3u8` subtitle playlists straight to the scheduler and must go through
`fetchHlsVtt`. If the harness can assert `onTracks` ordering against a real `<video>`, retire the web half of the
structural guard in test/hls-load.test.ts and say so in the commit. No colours in the harness fixtures beyond
CueOverlay's defaults."

---

## 0. Decisions at a glance

1. **Stack:** `react-native-web` aliased for `react-native` + Vite 5 dev server (esbuild JSX, **no** `@vitejs/plugin-react`) + `@playwright/test`, Chromium only. Root devDependencies, one `pnpm install`.
2. **Location:** `harness/` at repo root: `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `overlay.html`+`overlay.tsx`, `player.html`+`player.tsx`, `e2e/*.spec.ts`, `e2e/helpers.ts`, `fixtures/`. Outside vitest `include` and root tsconfig `include`; its own tsconfig; `pnpm test` stays at 112, `pnpm typecheck` unaffected.
3. **Real `<video>` + HLS (the hard one): option (a).** `page.route('**/stream/**')` fulfils the *same* master URL as the `.m3u8` body when `request.resourceType() === 'fetch'` and as a checked-in 1.2 KB silent VP9 WebM when `resourceType() === 'media'`. Per-test gates (deferred promises) delay either half so ordering is asserted deterministically. Options (b)–(e) rejected in §1.3; (a′) `route.continue({ url })` is the pre-authorised fallback.
4. **Media file:** `harness/fixtures/black-15s.webm`, 64×36, 2 fps, 15 s, VP9, video-only, **1168 bytes**, generated once with the ffmpeg `color` source (§4.5) — synthetic, no third-party content. Video-only + `--autoplay-policy=no-user-gesture-required` + `muted` set by the page: autoplay can never block.
5. **Cue timing is driven by `ref.seek()`** (synchronous `scheduler.update` in `KitPlayer.api.seek`), never by wall-clock waits; exactly one spec plays the element for real to prove `timeupdate` → `onPosition` → scheduler wiring.
6. **Q7:** `selectText` in `web.tsx` calls `fetchHlsVtt(t.url)` instead of `(await fetch(t.url)).text()`. Two-line diff (§3). `.vtt` URLs unchanged (`fetchHlsVtt` returns a WebVTT body untouched).
7. **Both web structural guards retire** — `'the web adapter publishes tracks only after the manifest promise resolves'` and `'the web adapter still adds text tracks for header ids the manifest did not produce'` — each replaced by a named harness spec that is strictly stronger (§6). Fire OS guards stay.
8. **Two pages:** overlay-only (`window.__setCues`, `flushSync`, no video) for the five overlay behaviours; KitPlayer page (real adapter) for ordering, Q7, multi-track and the header bridge. The overlay page also proves stacking geometry; the player page proves both tracks' cues *arrive*.
9. **Fonts:** no font pinned, `defaultCueTheme` untouched. Every text assertion is a **line count** (element height ÷ line-height) with fixture lengths chosen so the result is the same for any sans-serif whose average advance at 44 px is 17–28 px (Liberation Sans/Arial ≈ 22, Helvetica/SF ≈ 22–23, DejaVu Sans ≈ 26). §1.9 has the arithmetic.
10. **CI:** second job `harness` in `.github/workflows/ci.yml`; `test` job unchanged. Playwright `webServer` starts the Vite dev server; specs use `page.route` only for `/stream/**`.
11. **Changeset:** one `patch` for Q7 (§7). The harness is not user-facing; no changeset for it.
12. **Public types unchanged:** `src/core/types.ts`, `src/player/types.ts`, every `index.ts` — no edits. `src/core` untouched.

---

## 1. Reasoning per decision

### 1.1 Tooling

`CueOverlay.tsx` imports `StyleSheet, Text, View` from `react-native`; `KitPlayer.tsx` imports `Platform`. In a
browser these resolve to `react-native-web` (RNW) by alias — RNW's own setup docs prescribe exactly this
(`resolve.alias: { 'react-native': 'react-native-web' }`, https://necolas.github.io/react-native-web/docs/setup/).
Vite's `resolve.alias` (https://vite.dev/config/shared-options#resolve-alias) applies to every module including
`src/**`, so the kit source is used **unmodified**.

Versions, checked with `npm view` on 2026-09-18:
- `react-native-web@0.21.2` — peers `react ^18||^19`, `react-dom ^18||^19`; it does **not** depend on `react-native`, so RN 0.81 in `devDependencies` is irrelevant to it. React 19.3.0 is installed.
- `react-dom@19.3.0` (peer `react ^19.3.0`, satisfied) and `@types/react-dom@19.3.0` (peer `@types/react ^19.3.0`; 19.3.0 is installed).
- `vite@^5.4.0` — **deliberately the 5.x line**: vitest 2.1.9 already pins `vite@5.4.21` in the lockfile, so pnpm dedupes to one copy and `vitest/config` typings keep lining up. Vite 8 (current) would add a second major with a rolldown core; nothing here needs it.
- No `@vitejs/plugin-react`: it only adds Fast Refresh + Babel. Vite's built-in esbuild transform handles `.tsx`; set `esbuild: { jsx: 'automatic' }` explicitly (https://vite.dev/config/shared-options#esbuild, https://esbuild.github.io/api/#jsx).
- `@playwright/test@^1.63.0` (engines `node >=20`; CI uses Node 20).

How RNW renders the props the assertions depend on (read from `react-native-web@0.21.2/dist`, files
`exports/Text/index.js`, `modules/createDOMProps/index.js`, `exports/StyleSheet/compiler/*.js`):
- `numberOfLines={2}` → inline `-webkit-line-clamp: 2` plus class `textMultiLine` = `display:-webkit-box; -webkit-box-orient:vertical; overflow:clip; text-overflow:ellipsis; max-width:100%`. Chromium clamps the box's height to N line boxes (MDN https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-line-clamp), so **height = lines × lineHeight** is a robust line counter.
- A root `<Text>` renders `<div dir="auto">`; a nested `<Text>` renders `<span>` with `font: inherit; color: inherit`. **Selector for a cue's text element: `div[dir="auto"]`.**
- `accessibilityLabel={w}` → `aria-label` (with a one-time dev-mode deprecation warning; harmless). `accessibilityRole="text"` → no `role` attribute (`propsToAriaRole` maps `text` → null). `testID` → `data-testid`.
- `pointerEvents="none"` → `pointer-events: none` via a style class (+ deprecation warning). Harmless; the harness never clicks the overlay.
- `StyleSheet.create({ focusedWord: { textDecorationLine: 'underline' } })` → atomic class `text-decoration-line: underline`. RNW's nested-text reset (`text-decoration: none`) is a *classic-group* rule inserted **before** atomic rules, so the atomic longhand wins the cascade. `getComputedStyle(span).textDecorationLine === 'underline'` is the assertion.
- `gap: 8` on `bottomArea` → CSS `gap: 8px` (flex gap; RNW ≥ 0.18). `maxWidth: '86%'` → `max-width: 86%`. Numeric `lineHeight: 57` → `57px`.
- `fontFamily: undefined` → RNW's default `font: 14px System`, where `System` expands to `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`. On ubuntu-latest after `playwright install --with-deps`, fontconfig maps `Arial` → Liberation Sans (metric-compatible with Arial). See §1.9.

Vitest isolation: `vitest.config.ts` has `include: ['test/**/*.test.ts']`; harness specs are `harness/e2e/*.spec.ts` → never collected. Root `tsconfig.json` `include: ["src","test","src/types"]` → harness files are invisible to `pnpm typecheck`. The harness gets `harness/tsconfig.json` (extends root; `types: ["node"]`, no vitest globals; `include: ["."]`) and a `typecheck:harness` script so spec typos are caught in CI; neither Vite (esbuild) nor Playwright (babel strip) typechecks.

`KitPlayer` imports `./adapters/index.ts`, which imports `fireos.tsx` and `vega.tsx`. Both reach their native
modules through **lazy `require(...)` inside the component body** (`fireos.tsx:19`, `vega.tsx:16-18`), so Vite
never resolves `react-native-video` / `@amazon-devices/react-native-w3cmedia` / `shaka-player` statically and
no stub aliases are needed. `resolveAdapter(Platform.OS)` with RNW's `Platform.OS === 'web'` falls to the
`default` branch → `WebAdapter`; the player page also sets `globalThis.KIT_FORCE_ADAPTER = 'web'` (documented
override, `adapters/index.ts:11`) so the choice does not depend on RNW's value.

### 1.2 Location and packaging

`harness/` at the repo root, root devDependencies. A separate workspace package would need a
`pnpm-workspace.yaml`, a second lockfile scope and a second install in CI for no benefit; the kit's `files`
field (`dist`, `src`, README, LICENSE, CHANGELOG) already excludes `harness/` from the published tarball, and
`tsup.config.ts` entries are `src/**` only, so `pnpm build` is unaffected.

### 1.3 A real `<video>` and HLS in Chromium — option (a)

Facts. `WebAdapter` sets `v.src = props.source.uri` **and** fetches the same URI with `loadHlsTextTracks`;
`onTracks` is published from `Promise.all([manifest, metadata])` where `metadata` resolves on `loadedmetadata`
(`web.tsx:24-39`). Chromium has no native HLS (https://caniuse.com/http-live-streaming — desktop Chrome: no), so
a `<video src="master.m3u8">` errors, `loadedmetadata` never fires, `onTracks` never fires.

Playwright's route handler sees `request.resourceType()`, "the request's resource type as it was perceived by
the rendering engine … `media`, `fetch`, …" (https://playwright.dev/docs/api/class-request#request-resource-type).
`route.fulfill({ path, contentType })` answers without touching the network
(https://playwright.dev/docs/api/class-route#route-fulfill). So one URL can be two things: the playlist for the
adapter's `fetch`, a playable WebM for the element. Chromium sends `Range: bytes=0-` on media loads; a 200 with the
full 1168-byte body is the standard "server without range support" answer and is accepted; the whole file is
buffered, `loadedmetadata` fires, `duration === 15`.

**Amended 2026-09-18 (probe, §13).** Two corrections from the step-1 probe on Chrome Headless Shell 153: (1) Chromium
sniffs `.m3u8` in the media URL's path *before* the demuxer runs, so a `<video src="…/master.m3u8">` fed WebM bytes
by the route fails with `DEMUXER_ERROR_COULD_NOT_PARSE` whatever the body, status or headers — and so does (a′),
because the renderer still sees the `.m3u8` URL. Route substitution cannot make a `.m3u8` URL play non-HLS bytes.
The master is therefore served at the **extension-less** URL `/stream/master` (on disk it stays
`harness/fixtures/stream/master.m3u8`); the adapter parses the body, not the extension, and rendition URIs still
resolve to `/stream/subs/…/index.m3u8`. (2) A plain 200 loads but Chromium marks the resource **non-seekable** and
clamps every seek to 0; `routeStream`'s media branch answers `Range` with a 206 + `Content-Range` +
`Accept-Ranges: bytes`, after which `seekable` is 0–15. Nothing in `src/` changes; option (e) stays rejected.

Why not the others:
- **(b) a checked-in `.mp4`/`.webm` as `source.uri`.** `loadHlsTextTracks` on binary bytes throws `EXTM3U` → caught → `[]`; text tracks then come only through the deprecated header, which cannot exercise Q7 (`.m3u8` subtitle playlists) and disappears next minor. It also cannot assert the manifest half of the ordering. Rejected as the primary path; the header-bridge spec (§5) still covers the header path *alongside* a manifest.
- **(c) Shaka on web.** Out of scope: a new dependency, a different adapter code path, and the ticket is about the overlay and the existing web adapter.
- **(d) WebKit.** Native HLS in Playwright's WebKit exists only on macOS; CI is `ubuntu-latest`. Rejected.
- **(e) drop the `metadata` requirement.** `metadata` contributes nothing to the track list (audio is hard-coded, element text tracks are ignored), so one could publish on the manifest alone. But it is a behaviour change to the contract in plan §4.7 web step 3 ("once, when both … `Promise.all`"), R7, decision 0004's consequences, and the guard comment in `test/hls-load.test.ts:253-256`; it would also let `onTracks` precede `onState('ready')`. A harness ticket does not change adapter contracts. Rejected. Only the orchestrator may reopen it, and only if (a) and (a′) both fail (§11 Q1).

Ordering assertion (exact, §5 `player.spec.ts`): with the manifest fulfilment held behind a test-controlled
deferred, wait for `state:ready`, assert **zero** `tracks` events, release, then assert exactly **one** `tracks`
event whose `text` equals the two manifest tracks (ids `'0'`,`'1'`, labels, resolved URLs). Mirror test with the
**media** held: manifest fulfilled, assert zero `tracks` after 500 ms, release, assert one `tracks` event and that
its index in the event log is greater than that of `state:ready`. Plus the semantic reason for the guard:
`preferredText={{ languages: ['en'] }}` with the manifest held until after `ready` still auto-selects `'1'` and
delivers its cues — a mutant that publishes from the `loadedmetadata` listener latches `appliedPrefs` on `[]`
and fails this spec. That is strictly stronger than a regex over the source text; both web guards retire (§6).

Fallback (a′), pre-authorised, only if the probe in §10 step 1 fails: for the `media` request use
`route.continue({ url: baseURL + '/black-15s.webm' })` (Playwright: "If set changes the request URL",
https://playwright.dev/docs/api/class-route#route-continue) and let Vite serve it from `publicDir`. The `fetch`
half stays fulfilled from file. Everything else in this plan is unchanged.

### 1.4 The media file

`ffmpeg` is not guaranteed on CI, and a MediaRecorder-generated WebM has no duration/cues index (not seekable) —
so the file is **checked in**. Provenance: the ffmpeg `color` lavfi source (https://ffmpeg.org/ffmpeg-filters.html#color)
produces synthetic black frames; nothing is derived from third-party media; no licence attaches. VP9 in WebM
because Playwright's Chromium "does not have all the codecs that Google Chrome or Microsoft Edge are bundling"
(https://playwright.dev/docs/browsers, "Media codecs") — H.264/AAC are the ones missing; VP8/VP9/Opus are open.
Video-only (`-an`): an element with no audio track is never blocked by the autoplay policy ("muted autoplay is
always allowed", https://developer.chrome.com/blog/autoplay/); the page still sets `muted = true` and the
launch adds `--autoplay-policy=no-user-gesture-required` (same page, "Developer switches"). Trial run on
2026-09-18: 1168 bytes, `ffprobe` duration 15.000, `vp9`, 64×36.

### 1.5 Seek-driven cues, one playback spec

`KitPlayer.api.seek(s)` calls `adapterRef.seek(s)` **and** `scheduler.update(s)` synchronously (`KitPlayer.tsx:91-94`),
and `CueScheduler.update` calls `onChange` synchronously, so `window.__kit.seek(t)` (page helper) can return the
active-cue set produced by that very call. No `timeupdate`, no waiting, no dependence on the element honouring
the seek. One spec (`'a playing element drives cues through timeupdate'`) plays for real and polls up to 5 s for
the 1 s cue — proves `timeupdate → onPosition → scheduler.update`, and is the only wall-clock-tolerant assertion.

### 1.6 Q7

`fetchHlsVtt` (`src/player/hls.ts:81-89`) fetches `url`; if the body starts with `WEBVTT` and has no `#EXTM3U`
it returns it unchanged, otherwise it treats it as a media playlist, fetches each non-comment line as `base + line`
(pinned by `test/hls-load.test.ts` "fetchHlsVtt (moved, behaviour pinned)"; plan Q5 keeps that), strips each
segment's `WEBVTT` + `X-TIMESTAMP-MAP` header and joins under one `WEBVTT`. So routing `selectText` through it
makes manifest-derived `.m3u8` subtitle URLs work and leaves `.vtt` URLs (the deprecated header's typical value)
byte-identical. The fixture's segment files sit in the same directory as their media playlist, so the `base + l`
resolution is exercised exactly as pinned.

The structural guards that must keep passing after the diff: `'fireos and web derive text tracks through
loadHlsTextTracks'` (still one call), `'fireos and web read the header only through deprecatedTextUrls'` (still
one call, no header literal, no `JSON.parse`). The diff adds one import name and changes one expression; neither
guard sees it.

### 1.7 Two pages, not one

The overlay assertions are about geometry and DOM shape; they need cues injected in one synchronous step and no
network. Going through `KitPlayer` for them would add a manifest, a `<video>` and fetches to every geometry test
and make a font or padding regression look like a playback failure. The player page exists to prove the things
only the real adapter can: `onTracks` ordering against real `loadedmetadata`, Q7, multi-track delivery from one
`selectText([...])`, the header bridge, and `timeupdate`. The player page also renders `CueOverlay` on top of the
video so stacking is seen once end-to-end (one assertion, not the full geometry suite).

Colours: none. The overlay page has an unstyled `<body>` (browser default), `margin: 0`, and a
`#stage` div with only `position:relative; width:1920px; height:1080px; overflow:hidden`. The player page's
stage is the same; the only colour on screen is the adapter's own `background: '#000'` on the `<video>`
(`web.tsx:67`). The player page may render exactly one `<pre id="events">` below the stage, with **no CSS at
all**, mirroring `window.__kit.events` for `pnpm harness:dev` eyeballing; tests never read it. No HUD on the
overlay page.

### 1.8 CI

Second job `harness` (`.github/workflows/ci.yml`), same checkout/pnpm/node steps as `test`, then
`pnpm exec playwright install --with-deps chromium` (https://playwright.dev/docs/ci#github-actions), then
`pnpm typecheck:harness`, then `pnpm harness`. `test` job untouched. Playwright's `webServer` starts the Vite dev
server (https://playwright.dev/docs/test-webserver) — a dev server is fine here: no build step, ~2 s cold start,
`reuseExistingServer: !process.env.CI`. The specs need a server (the pages, RNW's bundle); `page.route` covers only
`/stream/**`. Browser binaries are not cached (Playwright's own advice: not recommended).

### 1.9 Fonts and the 42-char rule — line counts, not px widths

Available text width at scale 1: root inset 96 → 1728; box `maxWidth: 86%` → 1486.08; box `paddingHorizontal` 20 → **1446 px** for the `<Text>`.

- A 42-char mixed-case English line at 44 px measures ≈ 42 × 0.5 em ≈ 924 px in Arial/Liberation Sans; even at an average advance of 0.64 em (wider than any sans in the RNW stack) it is 1183 px < 1446. **It fits on one line for any plausible font → height 57.**
- A 95-char run-on line measures ≈ 2090 px in Arial (0.5 em), 1710 px at 0.41 em (a narrow face), 2508 px at 0.6 em (DejaVu-class). All are in (1446, 2892) → **exactly two lines → height 114** — and it does not reach three lines for anything narrower than 0.69 em. That window is why the fixture is 95 characters, not 43: at 1080p a 44 px line holds ≈ 65 Arial characters, so **the 42-char limit is a readability rule enforced by `lintCues`, not a geometric one**. The spec asserts both halves side by side: `lintCues([cue42])` is `[]` and the line renders as one; `lintCues([cue95])` reports `lineLength: 95` and the line renders as two.
- Line-heights are explicit px (`s(44 × 1.3) = 57`, `s(32 × 1.3) = 42`), so heights are font-independent.

No `theme.fontFamily` is passed (that would be a theme beyond the defaults for the kit's own test and would not
exist on both macOS and ubuntu anyway).

---

## 2. Files

| File | Action | Purpose |
|---|---|---|
| `docs/plans/KIT-005-harness.md` | exists | this plan |
| `package.json` | edit | devDependencies: `react-native-web`, `react-dom`, `@types/react-dom`, `vite`, `@playwright/test`; scripts `harness`, `harness:dev`, `typecheck:harness` |
| `pnpm-lock.yaml` | regenerated | by `pnpm add -D …` |
| `.gitignore` | edit | `harness/test-results/`, `harness/playwright-report/` |
| `.github/workflows/ci.yml` | edit | add job `harness`; `test` job unchanged |
| `src/player/adapters/web.tsx` | edit | Q7 (§3) |
| `test/hls-load.test.ts` | edit | retire two web guards, update comments (§6) |
| `.changeset/web-hls-subtitle-playlists.md` | new | `patch` (§7) |
| `harness/vite.config.ts` | new | RNW alias, esbuild JSX, port 4173, `publicDir: 'fixtures'` |
| `harness/playwright.config.ts` | new | Chromium, 1920×1080, `webServer`, autoplay flag, reporters |
| `harness/tsconfig.json` | new | extends root; `include: ["."]`; `types: ["node"]`; `noEmit` |
| `harness/overlay.html`, `harness/overlay.tsx` | new | overlay-only page: `window.__setCues(cues, props)` via `flushSync` |
| `harness/player.html`, `harness/player.tsx` | new | KitPlayer + WebAdapter + CueOverlay; `window.__kit` |
| `harness/e2e/helpers.ts` | new | `deferred()`, `routeStream(page, gates)`, `rect(locator)`, `setCues(page, …)` |
| `harness/e2e/overlay.spec.ts` | new | the five overlay behaviours + speaker + top line |
| `harness/e2e/player.spec.ts` | new | ordering ×2, preferredText, Q7, multi-track, header bridge, playback |
| `harness/e2e/probe-media.spec.ts` | new, then **deleted** | §10 step 1 probe; not committed |
| `harness/fixtures/black-15s.webm` | new (binary) | §4.5 |
| `harness/fixtures/stream/master.m3u8` | new | 2 subtitle renditions (de, en) + 1 variant |
| `harness/fixtures/stream/subs/de/index.m3u8`, `seg-0.vtt`, `seg-1.vtt` | new | de media playlist, 2 segments |
| `harness/fixtures/stream/subs/en/index.m3u8`, `seg-0.vtt`, `seg-1.vtt` | new | en media playlist, 2 segments |
| `harness/fixtures/stream/legacy-en.vtt` | new | bare VTT for the deprecated header spec |

Not touched: `src/core/**`, `src/player/types.ts`, `src/player/KitPlayer.tsx`, `src/player/hls.ts`,
`src/player/adapters/fireos.tsx`, `src/player/adapters/vega.tsx`, `src/cues/**`, `vitest.config.ts`,
`tsconfig.json`, `tsup.config.ts`, `README.md`, `docs/getting-started.md`.

---

## 3. The `web.tsx` diff for Q7

```diff
--- a/src/player/adapters/web.tsx
+++ b/src/player/adapters/web.tsx
@@ -1,7 +1,7 @@
 import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
 import type { TextTrack, Tracks } from '../../core'
 import type { AdapterProps, KitPlayerRef } from '../types'
-import { deprecatedTextUrls, loadHlsTextTracks } from '../hls'
+import { deprecatedTextUrls, fetchHlsVtt, loadHlsTextTracks } from '../hls'
@@ -54,9 +54,11 @@
     selectAudio: () => {},
     selectText: async (ids) => {
       for (const id of ids) {
         const t = tracks.current.text.find((x) => x.id === id)
-        if (t?.url) props.onTextTrackData?.(id, await (await fetch(t.url)).text())
+        // Manifest-derived urls are HLS subtitle media playlists; fetchHlsVtt joins their segments into one
+        // WebVTT body and returns a bare .vtt body (the deprecated header's usual value) unchanged (plan Q7).
+        if (t?.url) props.onTextTrackData?.(id, await fetchHlsVtt(t.url))
       }
     },
```

Nothing else in the file changes. `props.onTracks?.(` still occurs once; `loadHlsTextTracks(` once;
`deprecatedTextUrls(` once; no `x-kit-text-urls` literal; no `JSON.parse`.

---

## 4. Harness pages and fixtures

### 4.1 `harness/vite.config.ts`

```ts
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'fixtures', // served at / — only used by the (a′) fallback and by harness:dev
  resolve: { alias: [{ find: /^react-native$/, replacement: 'react-native-web' }] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { include: ['react-native-web'] },
  server: { port: 4173, strictPort: true },
})
```

### 4.2 `harness/playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  retries: 0,                                   // flakiness is a bug here, not a retry budget
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    browserName: 'chromium',
    baseURL: 'http://localhost:4173',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    // Playwright does spawn from the config file's directory, but `pnpm exec` re-roots to the nearest
    // package.json (the repo root) — so the config path is given from the root and cwd is pinned there.
    command: 'pnpm exec vite --config harness/vite.config.ts',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://localhost:4173/overlay.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
```

`pnpm harness` runs `playwright test -c harness/playwright.config.ts` from the repo root; `testDir`,
`outputDir`, the html `outputFolder` and `webServer.cwd` all resolve relative to the config file
(https://playwright.dev/docs/test-webserver), so the on-disk paths are `harness/test-results/` and
`harness/playwright-report/`.

### 4.3 `harness/overlay.html` + `harness/overlay.tsx`

`overlay.html` (whole file, no styles beyond layout):

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>CueOverlay harness</title>
<style>body{margin:0}#stage{position:relative;width:1920px;height:1080px;overflow:hidden}</style></head>
<body><div id="stage"></div><script type="module" src="/overlay.tsx"></script></body></html>
```

`overlay.tsx` (sketch — the implementer fills in types):

```tsx
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CueOverlay } from '../src/cues'
import type { CueOverlayProps } from '../src/cues'
import type { Cue } from '../src/core'

type Extra = Omit<CueOverlayProps, 'active' | 'scale' | 'testID'>
declare global {
  interface Window { __setCues(cues: Cue[], props?: Extra): void; __focusCalls: [string, number][] }
}
window.__focusCalls = []

function App() {
  const [s, set] = useState<{ cues: Cue[]; props: Extra }>({ cues: [], props: {} })
  window.__setCues = (cues, props = {}) => flushSync(() => set({ cues, props }))   // DOM is committed before evaluate() returns
  const sel = s.props.selectable
    ? { ...s.props.selectable, onFocusWord: (w: string, i: number) => { window.__focusCalls.push([w, i]) } }
    : undefined
  return <CueOverlay active={s.cues} scale={1} testID="overlay" {...s.props} selectable={sel} />
}
createRoot(document.getElementById('stage')!).render(<App />)
```

`flushSync` (https://react.dev/reference/react-dom/flushSync) is what makes `page.evaluate(() => __setCues(...))`
followed by a DOM query deterministic.

### 4.4 `harness/player.html` + `harness/player.tsx`

`player.html` is `overlay.html` with the title `KitPlayer harness`, `<pre id="events"></pre>` after `#stage`, and
`src="/player.tsx"`.

```tsx
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { KitPlayer } from '../src/player'
import type { KitPlayerRef } from '../src/player'
import { CueOverlay } from '../src/cues'
import type { Cue, PlayerState, Tracks } from '../src/core'

;(globalThis as { KIT_FORCE_ADAPTER?: string }).KIT_FORCE_ADAPTER = 'web'

type Ev = { type: 'state'; state: PlayerState } | { type: 'tracks'; tracks: Tracks } | { type: 'cue'; ids: string[] }
declare global {
  interface Window {
    __kit: {
      ref: KitPlayerRef | null
      events: Ev[]
      active: Cue[]
      /** ref.seek(t) — synchronous scheduler.update — and the active set it produced. */
      seek(t: number): Cue[]
      /** seek(t), then the bottom-area boxes as the overlay committed them in that same task (spec 14). */
      seekSnapshot(t: number): { ids: string[]; boxes: { text: string; fontSize: string; top: number }[] }
      play(): void
    }
  }
}
const q = new URLSearchParams(location.search)
const src = q.get('src') ?? '/stream/master' // extension-less: see §1.3 amendment / §13
const textUrls = q.get('textUrls')                 // JSON map → deprecated header (header-bridge spec only)
const preferred = q.get('preferred')               // JSON → preferredText
const primary = q.get('primary') ?? '0'

const kit: Window['__kit'] = {
  ref: null, events: [], active: [],
  seek: (t) => { kit.ref?.seek(t); return kit.active },
  seekSnapshot: (t) => {
    kit.ref?.seek(t) // onCue → flushSync → the overlay DOM below is already committed
    const area = document.querySelector('[data-testid="overlay"]')!.children[1]!
    return {
      ids: kit.active.map((c) => `${c.trackId}:${c.id}`),
      boxes: [...area.children].map((el) => ({
        text: el.textContent ?? '',
        fontSize: getComputedStyle(el.querySelector('div[dir]')!).fontSize,
        top: el.getBoundingClientRect().top,
      })),
    }
  },
  play: () => { const v = document.querySelector('video'); if (v) v.muted = true; kit.ref?.play() },
}
window.__kit = kit
const log = (e: Ev) => { kit.events.push(e); const pre = document.getElementById('events'); if (pre) pre.textContent = JSON.stringify(kit.events, null, 1) }

// Stable callbacks (module scope): an inline onCue would rebuild the scheduler every render (KIT-012).
let setCuesState: (c: Cue[]) => void = () => {}
const onCue = (active: Cue[]) => { kit.active = active; log({ type: 'cue', ids: active.map((c) => `${c.trackId}:${c.id}`) }); flushSync(() => setCuesState(active)) }
const onTracks = (t: Tracks) => log({ type: 'tracks', tracks: t })
const onState = (s: PlayerState) => log({ type: 'state', state: s })

function App() {
  const [cues, setCues] = useState<Cue[]>([])
  setCuesState = setCues
  return (
    <>
      <KitPlayer
        ref={(r) => { kit.ref = r }}
        source={{ uri: src, type: 'hls', ...(textUrls ? { headers: { 'x-kit-text-urls': textUrls } } : {}) }}
        preferredText={preferred ? JSON.parse(preferred) : undefined}
        onCue={onCue} onTracks={onTracks} onState={onState}
        testID="kit-video"
      />
      <CueOverlay active={cues} primaryTrackId={primary} scale={1} testID="overlay" />
    </>
  )
}
createRoot(document.getElementById('stage')!).render(<App />)
```

The `<video>` from `web.tsx:67` fills the 1920×1080 stage (`width/height: 100%`); the overlay's absolute root
sits on top because it comes later in the DOM.

### 4.5 `harness/fixtures/black-15s.webm`

Generate once (ffmpeg 8.0 with libvpx was used; any ffmpeg with `libvpx-vp9` works), from the repo root:

```
ffmpeg -hide_banner -y -f lavfi -i color=c=black:s=64x36:r=2 -t 15 -c:v libvpx-vp9 -b:v 10k -an harness/fixtures/black-15s.webm
```

Verify: `ffprobe -v error -show_entries format=duration:stream=codec_name -of default=nw=1 harness/fixtures/black-15s.webm`
→ `codec_name=vp9`, `duration=15.000000`; size ≈ 1.2 KB. Record this command in a comment at the top of
`harness/e2e/helpers.ts` (provenance: synthetic lavfi `color` source, no third-party content). Do not add
`*.webm` to `.gitignore`.

### 4.6 `harness/fixtures/stream/master.m3u8` (verbatim)

```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Deutsch",LANGUAGE="de",DEFAULT=NO,AUTOSELECT=YES,URI="subs/de/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subs/en/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=200000,CODECS="vp09.00.10.08",RESOLUTION=64x36,SUBTITLES="subs"
video/index.m3u8
```

`textTracksFromHls` yields ids in rendition order: `'0'` = de, `'1'` = en (`src/core/hls.ts:306`). `video/index.m3u8`
is never fetched (nothing on web reads variants); it exists so `isMasterPlaylist` is true by both rules.

### 4.7 `harness/fixtures/stream/subs/de/index.m3u8` (verbatim)

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:8
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:7.000,
seg-0.vtt
#EXTINF:8.000,
seg-1.vtt
#EXT-X-ENDLIST
```

`subs/en/index.m3u8` is byte-identical (segments are named the same, in their own directory — that is the `base + l`
resolution `fetchHlsVtt` pins).

### 4.8 Segment fixtures (verbatim; ≤ 6 cues per track)

`subs/de/seg-0.vtt`
```
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

c1
00:00:01.000 --> 00:00:03.000
Hallo Welt

c2
00:00:04.000 --> 00:00:06.000
Zweiter Satz
```

`subs/de/seg-1.vtt`
```
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

c3
00:00:08.000 --> 00:00:10.000
Aus dem zweiten Segment

c4
00:00:11.000 --> 00:00:13.000
Letzter Satz
```

`subs/en/seg-0.vtt`
```
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

c1
00:00:01.000 --> 00:00:03.000
Hello world

c2
00:00:04.000 --> 00:00:06.000
Second sentence
```

`subs/en/seg-1.vtt`
```
WEBVTT
X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000

c3
00:00:08.000 --> 00:00:10.000
From the second segment

c4
00:00:11.000 --> 00:00:13.000
Last sentence
```

`stream/legacy-en.vtt` (bare WebVTT, the deprecated header's shape)
```
WEBVTT

L1
00:00:02.000 --> 00:00:03.000
Legacy header cue
```

Every cue is ≥ 0.833 s and ≤ 42 chars, so `parseVtt`'s `minDuration` and `lintCues` never bite; all cue times are
inside the 15 s media.

### 4.9 `harness/e2e/helpers.ts` (sketch)

```ts
import type { Locator, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export const FIX = (rel: string) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url))

export function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => (resolve = r)); return { promise, resolve } }

/** Serve /stream/** from fixtures. The master URL is the playlist for `fetch` and the WebM for `media`. */
export async function routeStream(page: Page, gates: { manifest?: Promise<void>; media?: Promise<void> } = {}) {
  const hits: string[] = []
  await page.route('**/stream/**', async (route) => {
    const req = route.request()
    const rel = new URL(req.url()).pathname.replace(/^\/stream\//, '')
    hits.push(`${req.resourceType()} ${rel}`)
    if (rel === 'master.m3u8' && req.resourceType() === 'media') {
      await gates.media
      return route.fulfill({ path: FIX('black-15s.webm'), contentType: 'video/webm' })
    }
    if (rel === 'master.m3u8') await gates.manifest
    return route.fulfill({ path: FIX(`stream/${rel}`), contentType: rel.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'text/vtt' })
  })
  return hits
}

export const rect = (l: Locator) => l.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height } })
export const events = (page: Page) => page.evaluate(() => window.__kit.events)
export const cueIds = (page: Page, t: number) => page.evaluate((t) => window.__kit.seek(t).map((c) => `${c.trackId}:${c.id}`), t)
```

### 4.10 `harness/tsconfig.json`, scripts, `.gitignore`

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "noEmit": true, "types": ["node"], "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["."]
}
```

`rootDir`, `jsx: react-jsx`, `moduleResolution: Bundler` and `strict` are inherited; `types` drops
`vitest/globals` so `describe`/`it` are not in scope in specs; `@types/react-dom` provides `react-dom/client`.
The include pulls `../src/**` in transitively — it typechecks against `react-native`'s types exactly as
`pnpm typecheck` does, which is the point: the harness compiles the kit's real types.

`package.json` scripts (added; nothing existing changes):

```json
"harness": "playwright test -c harness/playwright.config.ts",
"harness:dev": "vite --config harness/vite.config.ts",
"typecheck:harness": "tsc -p harness/tsconfig.json"
```

`.gitignore` additions: `harness/test-results/` and `harness/playwright-report/`.

Selectors used by every spec (fixed here so the implementer never chooses one):

| Thing | Locator |
|---|---|
| overlay root | `page.getByTestId('overlay')` |
| top area / bottom area | `overlay.locator(':scope > div').nth(0)` / `.nth(1)` |
| boxes in an area | `area.locator(':scope > div')` (DOM order: secondary box first, primary box second) |
| a cue's text element | `div[dir="auto"]` (RNW root `<Text>`) |
| selectable words | `span[aria-label]` (whitespace spans carry no label) |
| the adapter's element | `page.getByTestId('kit-video')` (a `<video>`) |

---

## 5. Acceptance tests

All at `scale={1}`, viewport 1920×1080, so numbers are literal px. `≈` means `toBeCloseTo(x, 0)` (±0.5 px).

### `harness/e2e/overlay.spec.ts` — overlay page, cues via `__setCues`

Cue literals (trackId/id/start/end are inert here; the page never runs a scheduler):
- `CUE42 = { trackId: 'de', id: 'w42', start: 0, end: 5, text: 'The quick brown fox jumps over a lazy dog.' }` (42 chars)
- `CUE95 = { …, id: 'w95', text: 'The quick brown fox jumps over the lazy dog while the patient owl watches from the old oak tree' }` (95 chars, no `\n`)
- `CUE3L = { …, id: 'l3', text: 'Line one of three\nLine two of three\nLine three is clipped' }`
- `DE = { trackId: 'de', id: 'd1', …, text: 'Hallo Welt' }`, `EN = { trackId: 'en', id: 'e1', …, text: 'Hello world' }`
- `WORDS = { trackId: 'de', id: 's1', …, text: 'Hello brave new world' }`
- `SPK = { …, speaker: 'Maria', text: 'Are you coming?' }`, `SND = { …, sound: true, text: 'door slams' }`, `TOP = { …, line: 'top', text: 'Up here' }`

1. `test('a three-line cue is clamped to two lines')` — `__setCues([CUE3L])`; `rect(overlay.locator('div[dir="auto"]').height` ≈ **114** (2 × 57); computed `-webkit-line-clamp` is `'2'`; `lineHeight` is `'57px'`, `fontSize` `'44px'`. Control: `__setCues([DE])` → height ≈ **57**. Red mutant: `numberOfLines={3}` → 171.
2. `test('42 characters fit on one line; a 95-character run-on wraps to exactly two')` — `__setCues([CUE42])` → text height ≈ 57 and `lintCues([CUE42])` (imported from `../../src/core`) equals `[]`; `__setCues([CUE95])` → text height ≈ 114, box `width` ≈ **1486.08** (86 % of 1728 — the `maxWidth` bound), and `lintCues([CUE95])` equals `[{ id: 'w95', problem: 'lineLength', value: 95 }]`. Red mutant: `box.maxWidth: '100%'` → width 1728 and the 95-char line is still two lines but the width assertion fails; `lineHeight` removal → heights change.
3. `test('the bottom box respects the 5 % safe zone by default')` — `__setCues([CUE95])`; `b = rect(bottomArea.locator(':scope > div').nth(0))`: `b.bottom` ≈ **1026**, `b.left` ≈ **216.96**, `b.right` ≈ **1703.04**, and `b.left ≥ 96`, `b.right ≤ 1824`; root computed `padding` is `54px 96px`. Red mutant: `inset` default `{ x: 0, y: 0 }`.
4. `test('safeInset overrides the safe zone')` — `__setCues([CUE95], { safeInset: { x: 200, y: 100 } })`: `b.bottom` ≈ **980**, `b.width` ≈ **1307.2**, `b.left` ≈ **306.4**, `b.right` ≈ **1613.6**. Red mutant: ignore `safeInset`.
5. `test('the secondary track stacks above the primary at 32 px with an 8 px gap')` — `__setCues([DE, EN], { primaryTrackId: 'de' })`; `boxes = bottomArea.locator(':scope > div')`, count **2**; `sec = rect(boxes.nth(0))`, `prim = rect(boxes.nth(1))`: `boxes.nth(0)` text is `Hello world`, `boxes.nth(1)` text is `Hallo Welt`; `sec.bottom + 8` ≈ `prim.top`; `sec.top < prim.top`; `prim.bottom` ≈ 1026; `prim.height` ≈ **81** (57 + 2×12), `sec.height` ≈ **66** (42 + 2×12); computed `fontSize` of the en text `'32px'`, of the de text `'44px'`. Red mutants: swap the two `box(...)` lines in `bottomArea` → order flips; `gap: 0` → 8 px assertion.
6. `test('hideSecondary removes the secondary box')` — `__setCues([DE, EN], { primaryTrackId: 'de', hideSecondary: true })`: box count **1**, its text `Hallo Welt`, `page.getByText('Hello world')` count 0.
7. `test('selectable underlines the focused word and labels every word')` — `__setCues([WORDS], { selectable: { focusedIndex: 1 } })`: `words = overlay.locator('span[aria-label]')`, count **4**, `aria-label`s `['Hello','brave','new','world']`; computed `textDecorationLine` of `words.nth(1)` is `'underline'`, of `nth(0)`, `nth(2)`, `nth(3)` is `'none'`; `page.evaluate(() => window.__focusCalls)` is `[]` (the overlay never calls `onFocusWord`; it is app-driven — the assertion documents that). Then `__setCues([WORDS], { selectable: { focusedIndex: null } })` → no span has `'underline'`. Red mutant: `focused = selectable.focusedIndex === wi + 1`.
8. `test('speaker and sound cues get their bracketed prefixes')` — `__setCues([SPK])` → text `'[Maria] Are you coming?'`; `__setCues([SND])` → `'[door slams]'`.
9. `test('a line:top cue renders in the top area')` — `__setCues([TOP, DE])`: `topArea.locator(':scope > div')` count 1 with text `Up here` and `rect(...).top` ≈ **54**; bottom area has one box (`Hallo Welt`).

### `harness/e2e/player.spec.ts` — KitPlayer page, real `WebAdapter`

Each test: `routeStream(page, gates)` **before** `page.goto('/player.html?…')`.

10. `test('onTracks waits for the manifest: nothing is published on loadedmetadata alone')` — `m = deferred()`; `routeStream(page, { manifest: m.promise })`; goto; `expect.poll(() => events(page).then(e => e.some(x => x.type === 'state' && x.state === 'ready'))).toBe(true)`; assert `events` has **0** `tracks`; `m.resolve()`; `expect.poll(() => events(page).then(e => e.filter(x => x.type === 'tracks').length)).toBe(1)`; the `tracks.text` equals
    `[{ id:'0', language:'de', label:'Deutsch', kind:'subtitles', active:false, url:'http://localhost:4173/stream/subs/de/index.m3u8' }, { id:'1', language:'en', label:'English', … url:'…/subs/en/index.m3u8' }]`; after `page.waitForTimeout(300)` the count is still **1**. Red mutant: `metadata.then(() => props.onTracks?.(tracks.current))` added in `web.tsx` (the very mutation the retired guard blocked) → count 2 / a `tracks` before release.
11. `test('onTracks waits for loadedmetadata: a resolved manifest alone publishes nothing')` — `md = deferred()`; `routeStream(page, { media: md.promise })`; goto; `expect.poll(() => hits).toContain('fetch master')`; `page.waitForTimeout(500)`; **0** `tracks`, **0** `state:ready`; `md.resolve()`; poll → `tracks` count **1** and `events.findIndex(state ready) < events.findIndex(tracks)`. Red mutant: `manifest.then(([…]) => publish)` without `Promise.all`.
12. `test('preferredText auto-selects a manifest track even when the manifest lands after ready')` — `m = deferred()`; `routeStream(page, { manifest: m.promise })`; goto `/player.html?preferred=` + `encodeURIComponent('{"languages":["en"]}')`; wait for `state:ready`; `m.resolve()`; `expect.poll(() => cueIds(page, 2)).toEqual(['1:c1'])` — only en; no `selectText` call from the test. This is the `appliedPrefs` latch (decision 0004 consequences; `KitPlayer.tsx:47-56`) observed end-to-end. Red mutant: the same publish-on-metadata mutant as 10 → `appliedPrefs` latches on `[]`, no cue ever.
13. `test('Q7: a manifest .m3u8 subtitle track is resolved through its segments')` — `routeStream(page)`; goto; poll for `tracks`; `page.evaluate(() => window.__kit.ref!.selectText(['1']))`; `expect.poll(() => cueIds(page, 9)).toEqual(['1:c3'])` (segment 2, 8–10 s); `cueIds(page, 2)` equals `['1:c1']`; `cueIds(page, 7.5)` equals `[]`; `hits` contains `'fetch subs/en/index.m3u8'`, `'fetch subs/en/seg-0.vtt'`, `'fetch subs/en/seg-1.vtt'`; **no** active cue at any of `[0.5, 2, 5, 9, 12]` has text starting with `#`. **Red against current `web.tsx`** (the body handed to `parseVtt` is the media playlist → zero cues, so the 9 s poll times out).
14. `test('one selectText with two ids delivers both tracks\' cues and the overlay stacks them')` — `routeStream(page)`; goto `/player.html?primary=0`; poll for `tracks`; `selectText(['0','1'])`; `expect.poll(() => cueIds(page, 2).then(ids => ids.sort()))` equals `['0:c1','1:c1']` (both start at 1.0, so the scheduler's start-sort leaves their order unspecified — sort before comparing); then `snap = page.evaluate(() => window.__kit.seekSnapshot(2))` — read in the **same task as the seek**, so a later `timeupdate` cannot repaint between the seek and the read: `snap.boxes.length === 2`, `snap.boxes[0]` is `{ text: 'Hello world', fontSize: '32px' }` (secondary), `snap.boxes[1]` is `{ text: 'Hallo Welt', fontSize: '44px' }` (primary), `snap.boxes[0].top < snap.boxes[1].top`; `hits` has all six subtitle fetches (2 playlists + 4 segments). Red mutant: `selectText: async (ids) => { for (const id of ids.slice(0, 1)) …` — the "simplification" CLAUDE.md forbids.
15. `test('deprecated x-kit-text-urls still adds ids the manifest did not produce, after the manifest tracks')` — `routeStream(page)`; goto `/player.html?textUrls=` + `encodeURIComponent('{"legacy-en":"/stream/legacy-en.vtt"}')`; poll for `tracks`; `tracks.text.map(t => t.id)` equals `['0','1','legacy-en']` and the third is `{ id:'legacy-en', language:'legacy', label:'legacy-en', kind:'subtitles', active:false, url:'/stream/legacy-en.vtt' }`; `selectText(['legacy-en'])`; `expect.poll(() => cueIds(page, 2.5)).toEqual(['legacy-en:L1'])` (a bare `.vtt` body passes through `fetchHlsVtt` untouched). Red mutant: delete the `text.push({ id, …})` loop.
16. `test('a playing element drives cues through timeupdate')` — `routeStream(page)`; goto; poll for `tracks`; `selectText(['0'])`; `expect.poll(() => cueIds(page, 0))` equals `[]` (track loaded, nothing active at 0 — establishes the VTT arrived); `page.evaluate(() => window.__kit.play())`; `expect.poll(() => events(page).then(e => e.some(x => x.type === 'cue' && x.ids.includes('0:c1'))), { timeout: 5_000 }).toBe(true)`; `events` contains `state:playing`; `getByTestId('kit-video')` `.evaluate(v => v.currentTime)` > 1. Red mutant: remove the `timeupdate` listener in `web.tsx`.

Total: 16 specs; runtime target < 30 s locally.

---

## 6. What retires in `test/hls-load.test.ts`

Delete these two `it(...)` blocks in `describe('adapter wiring')`:

- `it('the web adapter publishes tracks only after the manifest promise resolves', …)` (lines 251–264) → replaced by specs **10, 11, 12**. The guard pinned three shapes: `Promise.all([manifest, metadata])` textually before `props.onTracks?.(`, exactly one `props.onTracks?.(` call site, and `.then(([manifestText])`. Spec 10 observes zero publishes before the manifest resolves and exactly one after; spec 11 the same for metadata plus `ready` before `tracks`; spec 12 the consequence the guard's comment names (`preferredText` never applied). Every mutation the regex could catch changes one of those observations; mutations the regex cannot see (publishing a stale `[]` from the correct `.then`; a second publish from a listener that does not use the `props.onTracks?.(` spelling) also fail 10/12. Strictly stronger.
- `it('the web adapter still adds text tracks for header ids the manifest did not produce', …)` (lines 282–286) → replaced by spec **15**, which observes the appended track, its position after the manifest tracks, its shape, and that its cues are delivered. The regex only saw `text.push({ id,`.

Keep: `'fireos and web derive text tracks through loadHlsTextTracks'`, `'fireos and web read the header only
through deprecatedTextUrls'`, `'fetchHlsVtt is defined in src/player/hls.ts …'`, both Fire OS guards, and the
`TODO(spike KIT-001)` guard. Fire OS has no harness; its guards stay structural.

Comment edits:
- Line 212 becomes: `/** Source guards, same spirit as test/selection.test.ts "KitPlayer wiring": wiring no unit test can reach. The web adapter's equivalents are behavioural — harness/e2e/player.spec.ts renders the real adapter in Chromium (KIT-005). */`
- Lines 270–273 (above the Fire OS merge guard) drop the mention of the web mutation: "mutation-testing this file found the deprecated header's *merge semantics* unprotected on Fire OS … only observable through a rendered component, so the check is structural. The web adapter's merge is asserted by `player.spec.ts › 'deprecated x-kit-text-urls still adds ids …'`."
- Line 284's `KIT-005 harness's .mp4 sources` remark goes with the deleted block.

Commit message body must say: "Retires the two web structural guards in test/hls-load.test.ts; `harness/e2e/player.spec.ts` asserts `onTracks` ordering and the header bridge against a real `<video>` in Chromium." Test count after: **110** vitest tests (112 − 2). Nothing else in `test/` changes.

---

## 7. Changeset (`.changeset/web-hls-subtitle-playlists.md`)

```
---
'@moizp/vega-media-kit': patch
---

The web adapter now resolves HLS subtitle media playlists through `fetchHlsVtt` before handing text to the
scheduler, so manifest-derived text tracks (`#EXT-X-MEDIA:TYPE=SUBTITLES` with a `.m3u8` URI) deliver cues on
web instead of none. Bare `.vtt` URLs — including entries from the deprecated `x-kit-text-urls` header — are
fetched exactly as before. Multi-track text selection is unchanged.
```

The harness, the CI job and the retired guards are not user-facing and get no changeset.

---

## 8. What else changes; what does not

- `test/hls-load.test.ts`: §6 only.
- `src/core/**`: nothing. `src/player/types.ts`, `src/core/types.ts`: nothing — confirmed by reading both; no new fields are needed (the harness reads `Tracks`, `Cue`, `PlayerState`, `KitPlayerRef` as they are).
- `src/player/index.ts`, `src/cues/index.ts`: nothing; `fetchHlsVtt` is already exported from `./hls`.
- RNW logs dev-mode deprecation warnings for `accessibilityLabel`, `accessibilityRole`, `pointerEvents` (RN 0.81 also accepts `aria-label`/`role`). Not fixed here; noted in §11 as a follow-up, not a blocker.

---

## 9. Risks (ranked)

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Chromium's media request is not fulfillable from `page.route`** (range semantics, or the media loader bypassing interception). | §10 step 1 is a 15-line probe spec run before anything else. Fallback (a′) `route.continue({ url })` is pre-authorised. Only if both fail does the implementer stop (§11 Q1). **Outcome (2026-09-18):** interception works and the bytes arrive; the actual blockers were `.m3u8` URL sniffing before the demuxer and non-seekability of a plain 200 — both fixed in the harness alone (§1.3 amendment, §13). |
| R2 | **Font metrics on CI differ from the developer's machine.** | All text assertions are line counts with fixture lengths that yield the same count for 0.41–0.64 em average advances (§1.9); line-heights are explicit px. Box widths are asserted only where the text exceeds the box (so width = `maxWidth`). |
| R3 | **Codec support** in Playwright's Chromium. | VP9/WebM, video-only; verified by the probe. |
| R4 | **Autoplay policy** blocks `play()`. | Video-only file (never blocked), `muted = true` in `__kit.play`, `--autoplay-policy=no-user-gesture-required`. |
| R5 | **`timeupdate` timing flakiness.** | Only spec 16 depends on playback, with a 5 s poll for a 1 s event; every other cue assertion goes through the synchronous `ref.seek()` path. |
| R6 | **react-native-web drift** (0.21 → 0.22 changing `numberOfLines` or `$raw` cascade). | Pin `^0.21.2`; §1.1 lists the exact DOM contract; if a bump changes it, the spec fails loudly and the table in §1.1 says what to re-check. |
| R7 | **Two Vite majors** in the tree. | Vite pinned to `^5.4.0` to dedupe with vitest 2.1.9. |
| R8 | **`react` prop callbacks unstable** → scheduler rebuilt each render (KIT-012), tracks dropped. | `onCue`/`onTracks`/`onState` are module-scope constants in `player.tsx`. |
| R9 | **Negative wall-clock checks** (spec 10's 300 ms, spec 11's 500 ms) could false-pass on a very slow runner. | They are secondary; the deterministic gates (deferreds released by the test) carry the ordering claim. |
| R10 | **The harness CI job is flaky and weakens the retired guards.** | `retries: 0`; traces on failure uploaded; a flaky spec is a bug ticket, not a retry. |
| R11 | Vite dev server cold start on CI exceeds `webServer.timeout`. | 60 s; typical is 2–4 s including RNW pre-bundling. |

---

## 10. Implementation order (tests red before green — ORCHESTRATOR §4)

1. **Probe.** `pnpm add -D react-native-web@^0.21.2 react-dom@^19.0.0 @types/react-dom@^19.0.0 vite@^5.4.0 @playwright/test@^1.63.0`; `pnpm exec playwright install chromium`. Generate `black-15s.webm` (§4.5). Write `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, an empty `overlay.html`, and `e2e/probe-media.spec.ts`: `routeStream(page)` first, then `page.goto('/overlay.html')`, then `page.evaluate` appends `document.createElement('video')` with `muted = true` and `src = '/stream/master.m3u8'` to `document.body` (not `setContent`, which would lose the origin for the relative URL); wait for `loadedmetadata`; assert `duration === 15`; then set `currentTime = 9`, await `seeked`, assert `currentTime` ≈ 9 (a fulfilled 200 must be seekable for spec 14's overlay read to hold); then `play()` and poll `currentTime > 9.5` within 3 s. Run it. Green → delete the probe, continue. Red → switch `routeStream`'s media branch to (a′) and re-run; still red → stop and report (§11 Q1). Confirm `pnpm test` still says 112 and `pnpm typecheck` passes.
2. **Overlay page + `overlay.spec.ts`.** Write the page and all nine specs. Show each red once against the mutant named in §5 (one at a time, revert after each; do not commit mutants), then green against the unmodified `CueOverlay.tsx`.
3. **Player page + `player.spec.ts` specs 10, 11, 12, 14, 15, 16** against the **current** `web.tsx` (all green except where noted: 14 needs `.m3u8` resolution for both tracks → red until step 4; 15 green already). Show 10 and 12 red against the publish-on-metadata mutant; 11 red against the no-`Promise.all` mutant; 14 red against `ids.slice(0, 1)`; 15 red against deleting the push loop; 16 red against removing the `timeupdate` listener. Revert every mutant.
4. **Q7.** Write spec 13, run → **red against current `web.tsx`** (record the failure output in the report). Apply §3. Run 13 and 14 → green. `pnpm test` → the two remaining web guards still green.
5. **Retire.** Edit `test/hls-load.test.ts` per §6. `pnpm test` → 110. Write the changeset (§7).
6. **CI + scripts + .gitignore.** `package.json` scripts: `"harness": "playwright test -c harness/playwright.config.ts"`, `"harness:dev": "vite --config harness/vite.config.ts"`, `"typecheck:harness": "tsc -p harness/tsconfig.json"`. Add the `harness` job (§1.8; also `actions/upload-artifact@v4` of `harness/playwright-report` and `harness/test-results` `if: failure()`). `.gitignore`: `harness/test-results/`, `harness/playwright-report/`.
7. **Gate.** `pnpm typecheck && pnpm test && pnpm build && pnpm typecheck:harness && pnpm harness`. Report: package versions added, the 16 spec names with timings, the red evidence per step, the retired guard names, anything not done.

Commit (conventional, one commit or two — `feat(harness)` and `fix(web)` — the orchestrator's call): the body
names the retired guards (§6) and cites the doc URLs in §12 for the Playwright and Chromium behaviour relied on.

---

## 11. Open questions for the orchestrator

**Q1 — conditional, not blocking now.** If the §10 step-1 probe fails under both (a) and (a′), the only remaining
route to a real `<video>` with a manifest is option (e) (publish on the manifest alone), which changes the
adapter contract in decision 0004. The implementer must **stop and report**, not decide. Everything else in this
plan proceeds regardless.

No other question blocks. Non-blocking follow-ups the reviewer may want ticketed: migrate `CueOverlay` from
`accessibilityLabel`/`accessibilityRole`/`pointerEvents` props to `aria-label`/`role`/`style.pointerEvents` (RN
0.81 and RNW 0.21 both accept the new names; the deprecation warnings are dev-only noise); Fire OS has no
behavioural equivalent of specs 10–12 and keeps its structural guards.

---

## 12. Sources

- Playwright `Request.resourceType()` — https://playwright.dev/docs/api/class-request#request-resource-type
- Playwright `Route.fulfill()` / `Route.continue({ url })` — https://playwright.dev/docs/api/class-route#route-fulfill , https://playwright.dev/docs/api/class-route#route-continue
- Playwright network interception model (Sec-Fetch-* are added after the handler; not usable in a route) — https://playwright.dev/docs/network
- Playwright web server — https://playwright.dev/docs/test-webserver
- Playwright CI on GitHub Actions (`install --with-deps`) — https://playwright.dev/docs/ci#github-actions
- Playwright browsers: "Media codecs" (bundled Chromium lacks Chrome's licensed codecs), headless shell — https://playwright.dev/docs/browsers
- Chromium autoplay policy ("muted autoplay is always allowed"; `--autoplay-policy=no-user-gesture-required`) — https://developer.chrome.com/blog/autoplay/
- HLS not native on desktop Chrome — https://caniuse.com/http-live-streaming
- react-native-web setup (alias) — https://necolas.github.io/react-native-web/docs/setup/ ; Text (`numberOfLines`) — https://necolas.github.io/react-native-web/docs/text/ ; accessibility (`aria-label`, `role`) — https://necolas.github.io/react-native-web/docs/accessibility/ ; source read: `react-native-web@0.21.2/dist/exports/Text/index.js`, `modules/createDOMProps/index.js`, `exports/StyleSheet/{index,compiler/index,compiler/createReactDOMStyle}.js`
- Vite `resolve.alias`, `esbuild`, `publicDir` — https://vite.dev/config/shared-options ; `server.port`/`strictPort` — https://vite.dev/config/server-options ; esbuild JSX automatic — https://esbuild.github.io/api/#jsx
- React `flushSync` — https://react.dev/reference/react-dom/flushSync
- MDN `-webkit-line-clamp` — https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-line-clamp ; `text-decoration-line` — https://developer.mozilla.org/en-US/docs/Web/CSS/text-decoration-line ; `loadedmetadata` — https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/loadedmetadata_event ; `timeupdate` — https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event
- ffmpeg `color` source — https://ffmpeg.org/ffmpeg-filters.html#color ; VP9 encoding — https://trac.ffmpeg.org/wiki/Encode/VP9
- RFC 8216 (HLS) §4.3.4.1 `EXT-X-MEDIA`, §3.5 WebVTT segments (`X-TIMESTAMP-MAP`) — https://datatracker.ietf.org/doc/html/rfc8216
- Netflix Timed Text Style Guide (42 chars / 2 lines) — https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617
- In-repo: `docs/plans/KIT-002-hls.md` §4.7, §9 Q5/Q7; `docs/decisions/0004-hls-master-parsing.md`; `docs/cue-overlay.md`; `test/hls-load.test.ts:212-287`; `src/player/adapters/web.tsx`; `src/cues/CueOverlay.tsx`; `src/player/KitPlayer.tsx:43-59, 87-102`; `src/core/scheduler.ts:33-57`; `src/core/vtt.ts:177-193`; `src/core/hls.ts:297-313`.

---

## 13. Amendments during implementation (2026-09-18)

1. **Master URL is extension-less.** Chrome Headless Shell 153 sniffs `.m3u8` in a media URL's path before the
   demuxer, so neither (a) nor (a′) can make `/stream/master.m3u8` play the route-served WebM. The harness serves
   the master at `/stream/master` (`player.tsx` default `src`; spec 11's `hits` expectation is `'fetch master'`);
   the on-disk fixture stays `harness/fixtures/stream/master.m3u8`. Harness fixture choice only — no adapter or
   contract change; option (e) stays rejected. §1.3 and R1 updated.
2. **Range-aware media fulfilment.** A plain 200 loads but is non-seekable (seeks clamp to 0); `routeStream`'s
   media branch honours `Range` with 206 + `Content-Range` + `Accept-Ranges: bytes`. §1.3 updated.
3. **`webServer` cwd.** `pnpm exec` re-roots to the repo's package.json regardless of Playwright's cwd, so
   `playwright.config.ts` passes `--config harness/vite.config.ts` and pins `cwd` to the repo root. §4.2 updated.
