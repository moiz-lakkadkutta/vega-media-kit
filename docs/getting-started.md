# Getting started

## Fire OS (Android TV) — the stick you already own
1. `pnpm add @moizp/vega-media-kit react-native-video`
2. Render `<KitPlayer source={{ uri, type: 'hls' }} />`. Native caption rendering is disabled; the kit fetches WebVTT and drives `<CueOverlay>`.
3. Nothing else to pass for subtitles: the kit reads the master playlist itself and reports the text tracks through `onTracks`. See [Text tracks](#text-tracks).
4. `adb connect <stick-ip> && adb install app-release.apk`.

## Vega OS — Vega Virtual Device or Fire TV Stick 4K Select
1. Install the Vega SDK (macOS/Ubuntu; Apple Silicon needs Rosetta 2; ~20 GB).
2. Create the app with `vega` CLI (React Native for Vega 0.72). Add the kit; follow `vega-video-sample`'s post-install to vendor Shaka.
3. `vega virtual-device start` → `vega run-app build/aarch64-release/<app>.vpkg`.
4. `Platform.OS` on Vega is `'kepler'` (Amazon's Platform reference types it `enum('kelper')` — a typo in their docs, not a second value). The kit's `resolveAdapter` and `isVega()` accept `'kepler'`, and `'vega'` for forward-compatibility; force an adapter in tests with `globalThis.KIT_FORCE_ADAPTER = 'vega'`.

## Text tracks

This is how text tracks work on Fire OS and web, and the rewritten Vega adapter (KIT-010) is expected to
use the same path. The kit reads the HLS master playlist and builds the text-track list from
`#EXT-X-MEDIA:TYPE=SUBTITLES`, so `TextTrack.url` is populated on Fire OS and web without the app knowing
where the subtitle playlists live. `CHARACTERISTICS` decides `kind` (`public.accessibility.describes-video`
→ `descriptions`, `transcribes-spoken-dialog` / `describes-music-and-sound` → `captions`), falling back to
the rendition's `NAME` and then to `subtitles`. On web, a rendition whose URI is a `.m3u8` subtitle media
playlist is resolved segment-by-segment through `fetchHlsVtt` too, so it delivers cues exactly as a bare
`.vtt` does.

Select by the ids the kit reports — never by ids your app composes:

```tsx
<KitPlayer
  source={{ uri, type: 'hls' }}
  preferredText={{ languages: ['de', 'en'] }}   // auto-selection, applied on the first onTracks
  onTracks={(t) => setText(t.text)}             // [{ id: '0', language: 'de', kind: 'subtitles', … }]
/>
// later, from your own track sheet — several tracks at once is the point:
ref.current?.selectText(text.filter((x) => x.kind === 'captions' || x.kind === 'descriptions').map((x) => x.id))
```

Text stays off until something asks for it: no `preferredText` means no track is selected, and `{ kinds: [] }`
is how an app says "captions off". Ids are manifest ordinals (`'0'`, `'1'`, …) in playlist order.

The kit does not parse DASH manifests, encrypted or byte-range playlists, or live/EVENT refreshes; a source
that is already a media playlist simply reports no text tracks. If the master playlist cannot be fetched
(CORS, auth, offline), the kit reports a **non-fatal** `HLS_MASTER` error through `onError` and falls back to
whatever the player itself exposes — playback is unaffected.

### Deprecated: `source.headers['x-kit-text-urls']`

Before the kit parsed master playlists, apps passed a JSON id→url map in `source.headers['x-kit-text-urls']`.
That header is **deprecated and will be removed in the next minor release**. It is still honoured for one
release, merged *after* the manifest tracks — so an entry overrides a manifest URL for the same id, and adds
an id the manifest did not produce — and it warns once per process with a link back to this section.

Migrate by deleting it and selecting by the ids in `onTracks` (usually by `(kind, language)`), as above. It
is worth doing promptly: `source.headers` is forwarded verbatim to the CDN by `react-native-video`, and on
web a custom request header forces a CORS preflight that a CDN without
`Access-Control-Allow-Headers: x-kit-text-urls` rejects. The kit's own master-playlist request always strips
the header.

## Scale
Sizes in the kit are "px at 1920×1080". Fire OS renders at 960×540 dp → pass `scale={0.5}`; Vega apps usually pass `1`. Multiply by the user's caption-size setting through `theme.userScale`.
