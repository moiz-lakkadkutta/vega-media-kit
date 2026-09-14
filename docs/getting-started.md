# Getting started

## Fire OS (Android TV) — the stick you already own
1. `pnpm add @moizp/vega-media-kit react-native-video`
2. Render `<KitPlayer source={{ uri, type: 'hls' }} />`. Native caption rendering is disabled; the kit fetches WebVTT and drives `<CueOverlay>`.
3. Until the kit parses master playlists itself (planned), pass text-track URLs: `source.headers['x-kit-text-urls'] = JSON.stringify({ 'de': 'https://…/de.m3u8' })`.
4. `adb connect <stick-ip> && adb install app-release.apk`.

## Vega OS — Vega Virtual Device or Fire TV Stick 4K Select
1. Install the Vega SDK (macOS/Ubuntu; Apple Silicon needs Rosetta 2; ~20 GB).
2. Create the app with `vega` CLI (React Native for Vega 0.72). Add the kit; follow `vega-video-sample`'s post-install to vendor Shaka.
3. `vega virtual-device start` → `vega run-app build/aarch64-release/<app>.vpkg`.
4. `Platform.OS` on Vega: verify the value in your build (`'vega'` expected); force an adapter in tests with `globalThis.KIT_FORCE_ADAPTER = 'vega'`.

## Scale
Sizes in the kit are "px at 1920×1080". Fire OS renders at 960×540 dp → pass `scale={0.5}`; Vega apps usually pass `1`. Multiply by the user's caption-size setting through `theme.userScale`.
