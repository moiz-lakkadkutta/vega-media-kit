# vega-media-kit

**One player API, one cue model, one set of Fire TV platform bindings** for React Native apps that run on both **Fire OS** (ExoPlayer via `react-native-video`) and **Vega OS** (`@amazon-devices/react-native-w3cmedia` + Shaka Player).

Built during the [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Sept–Oct 2026) as the shared foundation of two Fire TV apps — [Described](https://github.com/moiz-lakkadkutta/described) (AI audio description) and [Lingo](https://github.com/moiz-lakkadkutta/lingo) (learn a language from TV). MIT.

```
pnpm add @moizp/vega-media-kit
# Fire OS:  pnpm add react-native-video
# Vega:     @amazon-devices/react-native-w3cmedia ships with the Vega SDK; install Shaka per AmazonAppDev/vega-video-sample's post-install step
```

## Ten minutes to a playing video

```tsx
import { KitPlayer, CueOverlay } from '@moizp/vega-media-kit'
import type { Cue, KitPlayerRef, TextTrack } from '@moizp/vega-media-kit'

export function Player() {
  const ref = useRef<KitPlayerRef>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [tracks, setTracks] = useState<TextTrack[]>([])
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <KitPlayer
        ref={ref}
        source={{ uri: 'https://…/master.m3u8', type: 'hls' }}
        autoplay
        preferredAudio={{ role: 'description' }}          // Described: AD rendition on by default
        preferredText={{ languages: ['de', 'en'] }}        // Lingo: two languages at once
        onTracks={(t) => setTracks(t.text)}                // ids come from the manifest, not from you
        onCue={setCues}
      />
      <CueOverlay active={cues} primaryTrackId={tracks.find((x) => x.language === 'de')?.id} scale={0.5} />
    </View>
  )
}
```

## What's inside

| Subpath | Contents |
|---|---|
| `core` | `Cue`, `AudioTrack`, `TextTrack` types · WebVTT parser/serializer (`<v Speaker>`, `[sounds]`, `<i>`, trailing `{k=v}` meta) · `CueScheduler` (position-driven active-cue set, seek-safe) · track normalization from Shaka and ExoPlayer · HLS master-playlist parser (`parseHlsMaster`) · `lintCues` (Netflix Timed Text limits: 2 lines × 42 chars, 20 cps) · **no React Native imports** — runs in Node and in media pipelines |
| `player` | `<KitPlayer>` + adapters for Fire OS, Vega, web. Text tracks come from the HLS master playlist (`#EXT-X-MEDIA:TYPE=SUBTITLES`; `CHARACTERISTICS` decides captions vs descriptions) and are reported through `onTracks`. `selectText([...])` takes **multiple** tracks. Cues arrive from the adapter or from the kit's scheduler over fetched VTT — the app can't tell which |
| `cues` | `<CueOverlay>` with 10-foot defaults (5 % safe zone, 44 px primary / 32 px secondary at 1080p, boxed off-white text), speaker/sound rendering, `selectable` word focus |
| `platform` | `contentLauncher`, `personalization`, `mediaControls`, `parentalControls`, `useRemote` (typed keys, long-press). No-ops warn once with a doc link |
| `focus` | `useFocusMemory`, `useDpad` (key-repeat throttle), `FocusRow` |

## Status

Pre-release (`0.1.0-alpha.0`). `core` is implemented and tested (110 vitest cases, `pnpm test`). HLS master-playlist parsing has shipped: text tracks come from the manifest, not from anything the app passes (decision 0004). The Fire OS adapter works against ExoPlayer via `react-native-video`. The web adapter is exercised by a Playwright harness in CI (`pnpm harness`: 16 specs that render the real `CueOverlay` and `KitPlayer` against a real `<video>` in Chromium). The Vega adapter is a rewrite pending device evidence (KIT-010, decision 0002: `VideoPlayer` is a class rather than a component, the surface is `KeplerVideoSurfaceView`, Shaka is vendored into the app and attached with `new shaka.Player(el)`) — the `vega.tsx` scaffold does not work as written. The platform bindings on Vega are silent no-ops until KIT-007 (`TODO(spike KIT-007)`); on Fire OS and web they warn once with a doc link. Nothing in the device matrix has been ticked yet — see [docs/spike.md](docs/spike.md) for the acceptance tests and [docs/device-matrix.md](docs/device-matrix.md) for what has been verified on which device.

## Docs

- [Getting started](docs/getting-started.md) · [One UI package on Fire OS and Vega](docs/fire-os-and-vega-one-codebase.md) · [Cue overlay & styling](docs/cue-overlay.md) · [Platform bindings](docs/platform-bindings.md) · [Friction log index](docs/friction.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Checks: `pnpm typecheck && pnpm test` (vitest) and `pnpm harness` (Playwright, needs Chromium: `pnpm exec playwright install chromium`). Rule of thumb: if it has a colour, it belongs in an app, not here.
