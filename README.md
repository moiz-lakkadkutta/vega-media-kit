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
import type { Cue, KitPlayerRef } from '@moizp/vega-media-kit'

export function Player() {
  const ref = useRef<KitPlayerRef>(null)
  const [cues, setCues] = useState<Cue[]>([])
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <KitPlayer
        ref={ref}
        source={{ uri: 'https://…/master.m3u8', type: 'hls' }}
        autoplay
        preferredAudio={{ role: 'description' }}          // Described: AD rendition on by default
        preferredText={{ languages: ['de', 'en'] }}        // Lingo: two languages at once
        onCue={setCues}
      />
      <CueOverlay active={cues} primaryTrackId="de" scale={0.5} />
    </View>
  )
}
```

## What's inside

| Subpath | Contents |
|---|---|
| `core` | `Cue`, `AudioTrack`, `TextTrack` types · WebVTT parser/serializer (`<v Speaker>`, `[sounds]`, `<i>`, trailing `{k=v}` meta) · `CueScheduler` (position-driven active-cue set, seek-safe) · track normalization from Shaka and ExoPlayer · `lintCues` (Netflix Timed Text limits: 2 lines × 42 chars, 20 cps) · **no React Native imports** — runs in Node and in media pipelines |
| `player` | `<KitPlayer>` + adapters for Fire OS, Vega, web. `selectText([...])` takes **multiple** tracks. Cues arrive from the adapter or from the kit's scheduler over fetched VTT — the app can't tell which |
| `cues` | `<CueOverlay>` with 10-foot defaults (5 % safe zone, 44 px primary / 32 px secondary at 1080p, boxed off-white text), speaker/sound rendering, `selectable` word focus |
| `platform` | `contentLauncher`, `personalization`, `mediaControls`, `parentalControls`, `useRemote` (typed keys, long-press). No-ops warn once with a doc link |
| `focus` | `useFocusMemory`, `useDpad` (key-repeat throttle), `FocusRow` |

## Status

Week-0 scaffold. `core` is implemented and tested (`pnpm test`). Adapters follow the patterns in Amazon's samples and carry `TODO(spike)` markers where the exact Vega API name is confirmed on the Vega Virtual Device — see [docs/spike.md](docs/spike.md) for the acceptance tests and [docs/device-matrix.md](docs/device-matrix.md) for what has been verified on which device.

## Docs

- [Getting started](docs/getting-started.md) · [One UI package on Fire OS and Vega](docs/fire-os-and-vega-one-codebase.md) · [Cue overlay & styling](docs/cue-overlay.md) · [Platform bindings](docs/platform-bindings.md) · [Friction log index](docs/friction.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Rule of thumb: if it has a colour, it belongs in an app, not here.
