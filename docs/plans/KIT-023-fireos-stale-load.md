# KIT-023 — Fire OS: a superseded load touches nothing

**Role chain:** Planner (fable, this document) → Implementer (opus) → Reviewer (fable) → device check (human with the stick).
**Protocol:** `docs/ORCHESTRATOR.md` §3.2, §4. **Decisions:** 0001 §5 (Fire OS primary; this ticket is next after KIT-022), 0004 (one `onTracks`, after the manifest), 0005 §3–§4 (adapter-side cancellation stays required; KIT-022 amendment).
**Status:** ready for an implementer. No product decision is involved (§10). Every source and test text below was run in a scratch worktree of `75b4bf5` (repo untouched): the 8 stale-load tests are red against HEAD's adapter logic and green on the change; typecheck clean; full suite 168/168.

Goal in one sentence: on Fire OS, a load that has been superseded by a `source.uri` change — whether its manifest is still in flight, its native `onLoad` is dispatched late, or the app came back to the same uri — publishes nothing, reports nothing and overwrites nothing, so the next title can never fetch the previous title's playlists or carry its audio pick.

Ticket text (`TASKS.md`): "Fire OS stale load (`fireos.tsx:54-63, 69-88`): `onLoad` awaits the shared `hlsText.current` with no cancel; after a switch A publishes `onTracks` + a second `ready` and overwrites `textUrls.current` (:78) / `tracks.current` (:83), so B's `selectText` fetches A's playlists through B's live handler — A's captions on B, permanently. Superseded `HLS_MASTER` `onError` (:58). KIT-022 fixes the publish; the ref overwrite needs an adapter-side cancel (pair with KIT-020)."

---

## 0. Verdict at a glance

1. **Mechanism: one record per load, replaced whole.** `fireos.tsx` keeps a `load` ref holding `{ uri, started, manifest, textUrls, tracks }`. A `useLayoutEffect` keyed on `source.uri` swaps in a fresh record (and clears the audio index and position) in the same commit as KitPlayer's own reset. `onLoad` captures the record before its await and, after it, returns unless `l === load.current`. A continuation that lost the race cannot even reach the live source's urls: it only ever writes to *its* record (§2.3). This is the "load token" the KIT-022 plan asked for, with the state it protects bundled into the token.
2. **Dispatch-after-switch is closed twice.** (a) `if (!l.started) return` at the top of `onLoad`: react-native-video emits `onLoad` only after its own `onLoadStart` for the same source (`ReactExoplayerView.java:894-895`, `:2844-2845` set `loadVideoStarted`; `videoLoaded()` `:1485-1487` requires it), so an `onLoad` that reaches a record whose `onLoadStart` has not happened is the previous source's. (b) `key={props.source.uri}` on `<Video>`: one ExoPlayer per source; the old instance is released with its view (`cleanUpResources` `:399-404` → `releasePlayer` `:1221-1230`, `player.release(); player.removeListener(this)`) and React Native delivers nothing for a tag without an instance (Paper `ReactNativeRenderer-dev.js:1247-1249`; Fabric `EventEmitter.cpp:131`). (b) also removes an ExoPlayer-internal race that no JS check can see (§2.4).
3. **KIT-020's Fire OS half folds in — it is the same edit.** The record swap *is* the tracks/urls reset; `setAudioIndex(undefined)` and `position.current = startAt ?? 0` sit in the same effect. The web/vega halves of KIT-020 stay in KIT-020 (§7).
4. **KIT-029 folds in (3 lines, one test); KIT-028 does not.** `selectAudio` now marks the pick `active` on the record it already owns. `ready`-after-`playing` for the *live* load is the tracks→ready contract (KIT-015) and is untouched; the *superseded* load's second `ready` disappears as a consequence of (1) — §7 states the boundary.
5. **Test infrastructure: `vi.mock('react-native-video')` cannot reach the adapter's lazy `require`** (verified: the real `lib/index.js` loads and throws `Unexpected token 'typeof'`). The `require` moves to a one-function module `src/player/adapters/rnv.ts`; the test mocks that ES import. Not a public change (not exported from any `index.ts`).
6. **Guard of record: `test/fireos-adapter.test.tsx` renders the real `KitPlayer` + the real `FireOsAdapter`** under jsdom, with react-native-video replaced by a component that exposes its props so the test fires `onLoadStart`/`onLoad`/`onError`/`onProgress` in chosen orders, and `fetch` stubbed to hold every request until released. 8 `it`s red on HEAD (§4, with the observed failures), 2 controls green on both. Mutation matrix M1–M9 run and recorded (§5).
7. **Two structural guards in `test/hls-load.test.ts` retire** (they pinned `await hlsText.current` and `urls.set(` counts — adapter internals that this change renames); their intent is now behaviour in the new file. One tiny structural `it` stays (one `onTracks` call site). Vitest 159 → 168.
8. **No public type change.** `src/player/types.ts`, `src/player/index.ts`, `src/core/**`, `web.tsx`, `vega.tsx`, `selection.ts` untouched. `KitPlayer.tsx` gets a one-clause comment fix (its `handleTracks` comment says "fireos has no cancel (KIT-023)").
9. **Device evidence is required** (harness cannot run Fire OS; decision 0001 §6): a "Switch src" button in the sample app's `KitSpikeScreen` and a logcat script (§6).

---

## 1. The defects, verified on HEAD (`src/player/adapters/fireos.tsx` @ `75b4bf5`)

| # | Defect | Lines | What the change does | Guard |
|---|---|---|---|---|
| D1 | `onLoad` awaits `hlsText.current` with no cancel; after a switch A's continuation overwrites `textUrls.current` and `tracks.current`. Permanent when A's manifest outlives B's whole load: every later `selectText` on B fetches A's playlists through B's live handler; `getTracks()` answers A. The kit cannot see this (KIT-022 §6.1). | `:28`, `:71`, `:78`, `:83` | Per-record state: A's continuation writes A's record; the live record is B's. Plus the post-await identity check, so it publishes nothing either. | T1, T2 |
| D2 | A second `onState('ready')` from the superseded continuation. | `:85` | Same post-await check. | T1 (`states()` has no `ready`) |
| D3 | A stale `HLS_MASTER` `onError` from `onLoadStart`'s catch for a source the app has left. | `:56-60` | The catch reports only if its record is still live. | T3 |
| D4 | Dispatch-after-switch: a native `onLoad` for A that reaches JS after B's render runs the *current* `onLoad` (B's props), with A's ExoPlayer tracks and whatever `hlsText.current` holds; the kit's gate passes it (B is live). | `:69-88` | `started` gate + `key` per uri (§2.4). | T4 |
| D5 | A→B→A within one load's latency: A's first load publishes through a handler whose `sourceUri` is live again; the kit accepts it (KIT-022 R3). | `:69-88` | Record identity, not uri comparison (M9 shows why). | T5 |
| D6 (KIT-020) | `tracks.current` keeps A's list until B's `onTracks`; `audioIndex` survives a switch and is applied to B's ExoPlayer; adapter `position` is A's until B's first `onProgress` (and `api.getPosition()` prefers the adapter). | `:23-25` | Layout effect keyed on `source.uri`. | T6 |
| D7 (KIT-029) | `selectAudio` sets the index only; `getTracks()` keeps the old track `active` (device-verified in the spike). | `:35` | Mark the pick on the record. | T7 |

---

## 2. Design

### 2.1 The record

```ts
interface Load {
  uri: string
  /** Set by this source's `onLoadStart`. An `onLoad` that arrives before it belongs to the previous source. */
  started: boolean
  /** The master-playlist read, started at onLoadStart so it overlaps ExoPlayer's own load. */
  manifest: Promise<TextTrack[]> | null
  textUrls: Map<string, string>
  tracks: Tracks
}
const newLoad = (uri: string): Load => ({ uri, started: false, manifest: null, textUrls: new Map(), tracks: { audio: [], text: [] } })
```

`hlsText`, `textUrls` and `tracks` (HEAD `:25-28`) collapse into `load = useRef<Load>(newLoad(props.source.uri))`.

### 2.2 Where each check lives

| Site | Reads | Does |
|---|---|---|
| `useLayoutEffect([props.source.uri, props.startAt])` | `load.current.uri` | If the uri changed: `load.current = newLoad(uri)`, `position.current = startAt ?? 0`, `setAudioIndex(undefined)`. Compares against the record, so it is a no-op on mount and under StrictMode's double invocation (same reasoning as KitPlayer's reset, 0005 §6). Child layout effects run before the parent's, so this precedes KitPlayer's reset inside the same commit — and nothing native can call back before the commit ends. It calls no kit callback (the `AdapterProps` JSDoc forbids `onTracks` from layout effects; not relevant here). |
| `onLoadStart` | `load.current` | `l.started = true`; `l.manifest = loadHlsTextTracks(l.uri, { headers }).catch(e => { if (l === load.current) onError(HLS_MASTER); return [] })`; `onState('loading')`. |
| `onLoad` | `load.current` **once, before the await** | `if (!l.started) return`; `await l.manifest`; `if (l !== load.current) return`; then write `l.textUrls`, `l.tracks`; `props.onTracks(l.tracks)`; `props.onState('ready')`. The `props` are the dispatch-time closure, as on HEAD — which is what the KIT-022 gate relies on (`AdapterProps` JSDoc). |
| `selectText` | `load.current` at call time | `l.textUrls.get(id)` → `fetchHlsVtt` → the `onTextTrackData` captured at call time (0005 §4 contract, unchanged). |
| `selectAudio` | `load.current` | `setAudioIndex(Number(id))` and `l.tracks = { ...l.tracks, audio: audio.map(a => ({ ...a, active: a.id === id })) }`. |
| `getTracks` / `getPosition` | `load.current.tracks` / `position.current` | — |
| `<Video key={props.source.uri}>` | — | Fresh react-native-video instance per source (§2.4). |

### 2.3 Why a record, not a counter — and why the effect, not `onLoadStart`

- **A bare `loadId` counter** would stop the publish but a careless continuation could still write the shared refs before or after the check. Bundling the state into the token makes the stale write structurally harmless: under mutation M1 (post-await check deleted) T2 — "A's playlists on B" — *stays green*, because A's continuation wrote A's record. The check is still needed for D2/D5 (M1 turns T1 and T5 red).
- **Compare identity, not uri** (`l !== load.current`, never `l.uri !== load.current.uri`): A→B→A gives the second A load the same uri; M9 turns T5 red.
- **Create the record in the layout effect, not in `onLoadStart`.** The tempting "simpler" shape — new record when the native load starts — leaves the previous record live between B's render and B's `onLoadStart`: `getTracks()` answers A (KIT-020), a late `onLoad` for A finds `started === true` and publishes as B (D4), and A→B→A's first continuation still matches. Mutation M8b: T4, T5, T6 red.
- **`onLoadStart`'s `e.uri` was considered and rejected as a gate.** react-native-video's `OnLoadStartData` carries `uri` (`src/specs/VideoNativeComponent.ts:185-189`), but gating on string equality with a natively round-tripped uri risks a systematic mismatch (percent-encoding) whose failure mode is "no source ever loads". With `key` per uri a stale `onLoadStart` cannot arrive at all.

### 2.4 Why `key={props.source.uri}` on `<Video>`

react-native-video reuses one ExoPlayer across `setSrc` (`ReactExoplayerView.java:2040-2067`: `playerNeedsSource = true; initializePlayer()` posts a runnable that calls `player.setMediaSource(B)` on the same player, `:880-895`). ExoPlayer delivers listener callbacks through a handler-queued `ListenerSet`, so — by reading, not reproduced — A's `onPlaybackStateChanged(READY)` can be delivered *after* `initializePlayerSource(B)` has already set `loadVideoStarted = true` (`:894-895`). `videoLoaded()` (`:1485-1487`) then consumes B's flag and emits an `onLoad` that carries B's still-empty track list, and B's own READY emits no `onLoad` at all. That race is inside react-native-video; no JS token can see it, and the `started` gate would accept the malformed event as B's. A fresh instance per uri makes it impossible: A's player is released and its listener removed with the view (`cleanUpResources` `:399-404`, `releasePlayer` `:1221-1230`), and an event for a dropped tag has no instance to reach (Paper: `ReactNativeRenderer-dev.js:1247-1249`, `inst = getInstanceFromTag(rootNodeID)`, null → no target; Fabric: `ReactCommon/react/renderer/core/EventEmitter.cpp:131` `setEnabled`). The sample app runs Paper (`apps/expo-multi-tv/app.json:62` `newArchEnabled: false`).

Cost: ExoPlayer re-creation per title instead of `setMediaSource` on the same player — a title change already shows the shutter view; the device check measures switch→`ready` (§6.4). `paused`, `rate`, `selectedTextTrack`, `resizeMode` are re-applied to the new instance by React; `selectedAudioTrack` is reset on purpose (KIT-020).

Both (a) and (b) ship. (a) is testable with the real adapter under vitest (T4); (b) is the platform-level isolation that also covers what (a) cannot see. Neither alone is the plan.

### 2.5 Deliberately not done

- No post-await record check in `selectText`: VTT for a superseded source is already refused kit-side (0005 §4, `handleTextTrackData`); the only residue is a possible `TEXT_FETCH` `onError` for a title the user left — noise, same class as KIT-016, not a correctness issue. Adding the check would add untested code.
- No gating of `onProgress`/`onBuffer`/`onPlaybackStateChanged`/`onError(EXO)`: with `key` per uri they cannot come from a previous instance.
- No change to when the live load emits `ready` (KIT-028/KIT-015, §7).
- No change to the web or Vega adapters.

---

## 3. The change — exact files

### 3.1 New: `src/player/adapters/rnv.ts`

```ts
import type React from 'react'

/** The react-native-video component as the Fire OS adapter uses it. */
export type RnvVideo = React.ComponentType<Record<string, unknown>>

/**
 * The one place the optional peer is loaded. A lazy `require`, so the kit imports cleanly where
 * react-native-video is not installed (Vega, Node). A module of its own so the Fire OS adapter can render
 * under vitest with the component replaced: `vi.mock` intercepts this ES import, but not a `require`
 * inside the adapter (test/fireos-adapter.test.tsx).
 */
export function requireVideo(): RnvVideo {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-video').default as RnvVideo
}
```

Not exported from `src/player/index.ts` or `src/index.ts`. Metro resolves a static `require('react-native-video')` string wherever it sits; the sample app's `resolveRequest` already routes bare imports from kit files to the app's copy (`apps/expo-multi-tv/metro.config.js:48-56`).

### 3.2 Replace `src/player/adapters/fireos.tsx` with

```tsx
import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { fromRnvAudio, fromRnvText } from '../../core'
import type { TextTrack, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'
import { deprecatedTextUrls, fetchHlsVtt, loadHlsTextTracks } from '../hls'
import { requireVideo } from './rnv'

/**
 * Everything the adapter holds for one load of one `source.uri`. Replaced whole when the uri changes, so a
 * continuation that still holds the previous record can tell it has been superseded (`l !== load.current`)
 * and touch nothing — refs, props, nothing (KIT-023).
 */
interface Load {
  uri: string
  /** Set by this source's `onLoadStart`. An `onLoad` that arrives before it belongs to the previous source. */
  started: boolean
  /** The master-playlist read, started at onLoadStart so it overlaps ExoPlayer's own load. */
  manifest: Promise<TextTrack[]> | null
  textUrls: Map<string, string>
  tracks: Tracks
}
const newLoad = (uri: string): Load => ({ uri, started: false, manifest: null, textUrls: new Map(), tracks: { audio: [], text: [] } })

/**
 * Fire OS adapter over react-native-video (ExoPlayer).
 * Native text rendering is disabled; cues are delivered by fetching the subtitle playlists and handing
 * WebVTT to the kit's scheduler through onTextTrackData. This keeps multi-track captions identical to Vega.
 *
 * ExoPlayer does not expose a text track's playlist URL, so the kit reads the HLS master playlist itself
 * (docs/decisions/0004) and `TextTrack.url` comes from `#EXT-X-MEDIA:TYPE=SUBTITLES`.
 *
 * react-native-video is an optional peer dependency and is required lazily (./rnv) so the kit imports cleanly on Vega.
 */
export const FireOsAdapter = forwardRef<KitPlayerRef, AdapterProps>(function FireOsAdapter(props, ref) {
  const Video = requireVideo()
  const videoRef = useRef<{ seek(s: number): void } | null>(null)
  const [paused, setPaused] = useState(!props.autoplay)
  const [rate, setRate] = useState(1)
  const [audioIndex, setAudioIndex] = useState<number | undefined>()
  const position = useRef(props.startAt ?? 0)
  const load = useRef<Load>(newLoad(props.source.uri))

  /**
   * A uri change starts a new load record and forgets the previous source's tracks, urls, position and audio
   * pick (KIT-020) in the same commit as KitPlayer's own reset — before the new <Video> can emit anything.
   * Compares against the record, so it is a no-op on mount and under StrictMode's double invocation.
   */
  useLayoutEffect(() => {
    if (load.current.uri === props.source.uri) return
    load.current = newLoad(props.source.uri)
    position.current = props.startAt ?? 0
    setAudioIndex(undefined)
  }, [props.source.uri, props.startAt])

  useImperativeHandle(ref, () => ({
    play: () => setPaused(false),
    pause: () => setPaused(true),
    seek: (s) => videoRef.current?.seek(s),
    setRate: (r) => setRate(r),
    selectAudio: (id) => {
      setAudioIndex(Number(id))
      // ExoPlayer publishes no track event after a switch, so the adapter's own view marks the pick (KIT-029).
      const l = load.current
      l.tracks = { ...l.tracks, audio: l.tracks.audio.map((a) => ({ ...a, active: a.id === id })) }
    },
    selectText: async (ids) => {
      // Fetch VTT for each selected track; the URL came from the master playlist (or, for one more release,
      // from the deprecated header override). Read from the live record at call time.
      const l = load.current
      for (const id of ids) {
        const url = l.textUrls.get(id)
        if (!url) continue
        try {
          const vtt = await fetchHlsVtt(url)
          props.onTextTrackData?.(id, vtt)
        } catch (e) {
          props.onError?.({ code: 'TEXT_FETCH', message: `Could not load text track ${id}`, fatal: false, cause: e })
        }
      }
    },
    getPosition: () => position.current,
    getTracks: () => load.current.tracks,
  }))

  const onLoadStart = useCallback(() => {
    const l = load.current
    l.started = true
    if (props.source.type === 'hls') {
      l.manifest = loadHlsTextTracks(l.uri, { headers: props.source.headers }).catch((e) => {
        // Non-fatal: without the manifest the adapter falls back to ExoPlayer's own text track list.
        // Not reported for a source the app has since left.
        if (l === load.current) props.onError?.({ code: 'HLS_MASTER', message: 'Could not read the master playlist', fatal: false, cause: e })
        return [] as TextTrack[]
      })
    }
    props.onState?.('loading')
  }, [props])

  /**
   * One `onTracks` call, after the manifest promise resolves. KitPlayer's `appliedPrefs` latches on the
   * first call, so publishing manifest-less tracks first would leave `preferredText` never applied.
   */
  const onLoad = useCallback(
    async (e: { audioTracks?: Parameters<typeof fromRnvAudio>[0]; textTracks?: Parameters<typeof fromRnvText>[0] }) => {
      const l = load.current
      // react-native-video emits onLoad only after its own onLoadStart for the same source, so an onLoad that
      // reaches a record whose onLoadStart has not happened is the previous source's, dispatched after the switch.
      if (!l.started) return
      const manifestText = (await l.manifest) ?? []
      if (l !== load.current) return // superseded during the await: publish nothing, overwrite nothing
      const urls = new Map<string, string>(
        manifestText.filter((t) => t.url).map((t): [string, string] => [t.id, t.url as string]),
      )
      // The deprecated header is merged last, so an entry overrides a manifest URL for the same id and
      // adds a fetchable id the manifest did not produce. It warns once and goes away in the next minor.
      for (const [id, url] of Object.entries(deprecatedTextUrls(props.source.headers))) urls.set(id, url)
      l.textUrls = urls
      l.tracks = {
        audio: fromRnvAudio(e.audioTracks ?? []),
        text: manifestText.length ? manifestText : fromRnvText(e.textTracks ?? []),
      }
      props.onTracks?.(l.tracks)
      props.onState?.('ready')
    },
    [props],
  )

  return (
    <Video
      // One ExoPlayer per source: the previous instance is released with its view, and React Native drops
      // events from an unmounted view, so nothing of the previous source can reach the new one's handlers.
      key={props.source.uri}
      ref={videoRef}
      source={{ uri: props.source.uri, type: props.source.type === 'hls' ? 'm3u8' : 'mpd', headers: props.source.headers }}
      paused={paused}
      rate={rate}
      style={props.style ?? { flex: 1 }}
      resizeMode="contain"
      selectedAudioTrack={audioIndex !== undefined ? { type: 'index', value: audioIndex } : undefined}
      selectedTextTrack={{ type: 'disabled' }}
      onLoadStart={onLoadStart}
      onLoad={onLoad}
      onProgress={(e: { currentTime: number }) => { position.current = e.currentTime; props.onPosition?.(e.currentTime) }}
      onBuffer={(e: { isBuffering: boolean }) => props.onState?.(e.isBuffering ? 'buffering' : paused ? 'paused' : 'playing')}
      onPlaybackStateChanged={(e: { isPlaying: boolean }) => props.onState?.(e.isPlaying ? 'playing' : 'paused')}
      onEnd={() => props.onState?.('ended')}
      onError={(e: unknown) => props.onError?.({ code: 'EXO', message: 'Playback error', fatal: true, cause: e })}
      testID={props.testID}
    />
  )
})
```

Unchanged from HEAD on purpose: the `props`-keyed `useCallback`s (dispatch-time handlers are what the KIT-022 gate relies on); the header-merge statement shape (`Object.entries(deprecatedTextUrls(...))) urls.set(`); one `loadHlsTextTracks(` and one `deprecatedTextUrls(` call site; one `props.onTracks?.(` call site; `fetchHlsVtt` imported, not defined.

### 3.3 `src/player/KitPlayer.tsx` — comment only

Line 66, in `handleTracks`' doc comment, replace "fireos has no cancel (KIT-023)" with "fireos cancels its own superseded loads since KIT-023, but the kit does not depend on it". No code change; KIT-022 §6 keeps the two tickets independent.

### 3.4 New: `test/fireos-adapter.test.tsx` (guard of record — use verbatim)

```tsx
// @vitest-environment jsdom
/**
 * Guard of record for KIT-023: the REAL `KitPlayer` + the REAL `FireOsAdapter` under jsdom. Only the platform is
 * replaced: react-native-video is a component that records its props so the test can fire `onLoadStart` /
 * `onLoad` / `onError` in chosen orders, and `fetch` is a stub that holds every request until the test releases it.
 */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Cue, PlayerError, PlayerState, Tracks } from '../src/core'
import type { KitPlayerRef } from '../src/player/types'

const rig = vi.hoisted(() => ({
  Video: null as unknown,
  props: null as Record<string, any> | null,
  mounts: 0,
  unmounts: 0,
}))
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }))
vi.mock('../src/player/adapters/rnv', () => ({ requireVideo: () => rig.Video }))

import { KitPlayer } from '../src/player/KitPlayer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function MockVideo(props: Record<string, unknown>) {
  rig.props = props
  useEffect(() => {
    rig.mounts++
    return () => {
      rig.unmounts++
    }
  }, [])
  return null
}
rig.Video = MockVideo

// ---- held fetch ------------------------------------------------------------------------------------------
type Held = { url: string; resolve(body: string): void; reject(e: unknown): void }
const held: Held[] = []
const tick = () => new Promise((r) => setTimeout(r, 0))
async function release(i: number, body: string) {
  await act(async () => {
    held[i]!.resolve(body)
    await tick()
  })
}
async function fail(i: number) {
  await act(async () => {
    held[i]!.reject(new Error('503'))
    await tick()
  })
}
const fetched = () => held.map((h) => h.url)

// ---- fixtures --------------------------------------------------------------------------------------------
const A = 'https://a/master.m3u8'
const B = 'https://b/master.m3u8'
const master = (base: string) =>
  [
    '#EXTM3U',
    `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${base}/en.vtt"`,
    `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Deutsch",LANGUAGE="de",URI="${base}/de.vtt"`,
    '#EXT-X-STREAM-INF:BANDWIDTH=1000000,SUBTITLES="subs"',
    `${base}/v.m3u8`,
    '',
  ].join('\n')
const MASTER_A = master('https://a')
const MASTER_B = master('https://b')
const vtt = (text: string) => `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${text}\n`
const EXO = {
  audioTracks: [
    { index: 0, language: 'en', title: 'English', selected: true },
    { index: 1, language: 'de', title: 'Deutsch', selected: false },
  ],
  textTracks: [],
}
const PREF = { languages: ['de'] }
const onTracks = vi.fn<(t: Tracks) => void>()
const onState = vi.fn<(s: PlayerState) => void>()
const onError = vi.fn<(e: PlayerError) => void>()
const onCue = vi.fn<(c: Cue[]) => void>()
const states = () => onState.mock.calls.map(([s]) => s)
const lastCueTexts = () => (onCue.mock.calls.at(-1)?.[0] ?? []).map((c) => c.text)
const urls = (t: Tracks) => t.text.map((x) => x.url)

let root: Root
let api: KitPlayerRef | null = null
const setApi = (r: KitPlayerRef | null) => {
  api = r
}
function render(uri: string, headers?: Record<string, string>) {
  act(() =>
    root.render(
      <KitPlayer
        ref={setApi}
        source={{ uri, type: 'hls', headers }}
        preferredText={PREF}
        onTracks={onTracks}
        onState={onState}
        onError={onError}
        onCue={onCue}
      />,
    ),
  )
}
/** "The native onLoadStart was dispatched now" — through whatever react-native-video instance is mounted. */
const loadStart = () => act(() => rig.props!.onLoadStart({ isNetwork: true, type: 'm3u8', uri: rig.props!.source.uri }))
/** "The native onLoad was dispatched now"; the adapter's handler awaits the manifest, so nothing is asserted here. */
const load = (e = EXO) => act(() => void rig.props!.onLoad(e))
const seek = (s: number) => act(() => api!.seek(s))
const selectText = (ids: string[]) => act(() => api!.selectText(ids))
const selectAudio = (id: string) => act(() => api!.selectAudio(id))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise((res, rej) =>
          held.push({ url, resolve: (body) => res({ ok: true, status: 200, url, text: async () => body }), reject: rej }),
        ),
    ),
  )
  held.length = 0
  rig.props = null
  rig.mounts = 0
  rig.unmounts = 0
  onTracks.mockClear()
  onState.mockClear()
  onError.mockClear()
  onCue.mockClear()
  root = createRoot(document.createElement('div'))
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

describe('FireOsAdapter — superseded loads (KIT-023)', () => {
  it("drops a superseded load's continuation: no onTracks, no ready, getTracks() stays empty", async () => {
    render(A)
    await loadStart()
    await load()
    render(B)
    await loadStart() // B's; held[1]
    await release(0, MASTER_A) // A's manifest lands after the switch

    expect(onTracks).not.toHaveBeenCalled()
    expect(states()).toEqual(['loading', 'loading'])
    expect(api!.getTracks()).toEqual({ audio: [], text: [] })
  })

  it("a superseded load's manifest cannot feed the live source's selectText (A's playlists on B)", async () => {
    render(A)
    await loadStart()
    await load()
    render(B)
    await loadStart()
    await load()
    await release(1, MASTER_B) // B completes first …
    expect(fetched().at(-1)).toBe('https://b/de.vtt') // preferredText de → '1'
    await release(2, vtt('B-de'))
    await release(0, MASTER_A) // … then A's slow manifest lands
    await selectText(['1']) // the user re-picks German on B

    expect(fetched().at(-1)).toBe('https://b/de.vtt')
    await release(3, vtt('B-de-again'))
    seek(2)
    expect(lastCueTexts()).toEqual(['B-de-again'])
    expect(urls(api!.getTracks())).toEqual(['https://b/en.vtt', 'https://b/de.vtt'])
  })

  it("a superseded load's master-playlist failure is not reported as HLS_MASTER; the live one's is", async () => {
    render(A)
    await loadStart()
    render(B)
    await loadStart()
    await fail(0)
    expect(onError).not.toHaveBeenCalled()
    await fail(1)
    expect(onError.mock.calls.map(([e]) => e.code)).toEqual(['HLS_MASTER'])
  })

  it("an onLoad dispatched after the switch but before the new source's onLoadStart is the previous source's and is dropped", async () => {
    render(A)
    await loadStart() // held[0]
    render(B)
    await load() // A's late onLoad, through the props that are current now
    await release(0, MASTER_A)
    expect(onTracks).not.toHaveBeenCalled()
    expect(states()).toEqual(['loading'])

    await loadStart() // held[1]
    await load()
    await release(1, MASTER_B)
    expect(onTracks).toHaveBeenCalledTimes(1)
    expect(urls(onTracks.mock.calls[0]![0])).toEqual(['https://b/en.vtt', 'https://b/de.vtt'])
  })

  it('A→B→A: the first A load is superseded by the second even though the uri is live again', async () => {
    render(A)
    await loadStart() // held[0], A's first load
    await load()
    render(B)
    render(A)
    await loadStart() // held[1], A's second load
    await release(0, master('https://a/v1'))
    expect(onTracks).not.toHaveBeenCalled()

    await load()
    await release(1, MASTER_A)
    expect(onTracks).toHaveBeenCalledTimes(1)
    expect(urls(onTracks.mock.calls[0]![0])).toEqual(['https://a/en.vtt', 'https://a/de.vtt'])
  })

  it('resets tracks, text urls, position and the audio index when source.uri changes (KIT-020)', async () => {
    render(A)
    await loadStart()
    await load()
    await release(0, MASTER_A)
    await selectAudio('1')
    expect(rig.props!.selectedAudioTrack).toEqual({ type: 'index', value: 1 })
    act(() => rig.props!.onProgress({ currentTime: 42 }))
    render(B)

    expect(api!.getTracks()).toEqual({ audio: [], text: [] })
    expect(api!.getPosition()).toBe(0)
    expect(rig.props!.selectedAudioTrack).toBeUndefined()
    await selectText(['1'])
    expect(fetched()).toHaveLength(2) // master A + A's de.vtt from preferredText; nothing for the re-pick on B
  })

  it('selectAudio marks the chosen audio track active in getTracks() (KIT-029)', async () => {
    render(A)
    await loadStart()
    await load()
    await release(0, MASTER_A)
    expect(api!.getTracks().audio.map((a) => a.active)).toEqual([true, false])
    await selectAudio('1')
    expect(api!.getTracks().audio.map((a) => a.active)).toEqual([false, true])
    expect(rig.props!.selectedAudioTrack).toEqual({ type: 'index', value: 1 })
  })

  it('mounts a fresh react-native-video instance per source.uri', () => {
    render(A)
    expect([rig.mounts, rig.unmounts]).toEqual([1, 0])
    render(B)
    expect([rig.mounts, rig.unmounts]).toEqual([2, 1])
    expect(rig.props!.source).toMatchObject({ uri: B, type: 'm3u8' })
  })
})

describe('FireOsAdapter — the live load (controls; green before and after KIT-023)', () => {
  it('publishes once after the manifest resolves, applies preferredText, and delivers cues', async () => {
    render(A)
    await loadStart()
    await load()
    expect(onTracks).not.toHaveBeenCalled()
    await release(0, MASTER_A)
    expect(onTracks).toHaveBeenCalledTimes(1)
    expect(urls(onTracks.mock.calls[0]![0])).toEqual(['https://a/en.vtt', 'https://a/de.vtt'])
    expect(fetched().at(-1)).toBe('https://a/de.vtt')
    await release(1, vtt('A-de'))
    seek(2)
    expect(lastCueTexts()).toEqual(['A-de'])
    expect(states()).toEqual(['loading', 'ready'])
  })

  it('the deprecated x-kit-text-urls header still overrides a manifest url for the same id and adds an id the manifest lacks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(A, { 'x-kit-text-urls': JSON.stringify({ '1': 'https://h/de.vtt', '9': 'https://h/x.vtt' }) })
    await loadStart()
    await load()
    await release(0, MASTER_A)
    expect(fetched().at(-1)).toBe('https://h/de.vtt') // preferredText de → '1', overridden
    await selectText(['9'])
    expect(fetched().at(-1)).toBe('https://h/x.vtt')
    warn.mockRestore()
  })
})
```

Notes for the implementer: `jsdom` is already a devDependency and `include: ['test/**/*.test.{ts,tsx}']` is already in `vitest.config.ts` (KIT-022); nothing to add. The mocked `react-native` makes the *real* `resolveAdapter('android')` pick `FireOsAdapter` — no adapters mock. React 19 hands `ref` to a function component as a plain prop, so `videoRef.current` stays null and `seek` is a no-op inside the adapter; the cue at `seek(2)` comes from KitPlayer's scheduler, which is the point. `fetch` is stubbed per test with a duck-typed response (`HlsFetch` is structural; `fetchHlsVtt` only calls `.text()`).

### 3.5 `test/hls-load.test.ts` — retire two structural guards, add one

In `describe('adapter wiring')`:

- Delete `it('the Fire OS adapter publishes tracks only after the manifest promise is awaited')` (it greps `await hlsText.current`, which no longer exists). Its intent — publish once, after the manifest — is the first control in 3.4.
- Delete `it('the Fire OS adapter writes the url map once, and that write is the header override')` together with its five-line leading comment. Its intent is the second control in 3.4 (behavioural, with the real adapter — the comment itself says structural was the only option at the time).
- Add, in their place:

```ts
  it('the Fire OS adapter has one onTracks call site', () => {
    // Where and when it publishes is behavioural now: test/fireos-adapter.test.tsx renders the real adapter
    // (publishes once, after the manifest; the deprecated header override; superseded loads publish nothing).
    expect(fireos().match(/props\.onTracks\?\.\(/g)).toHaveLength(1)
  })
```

The other four `adapter wiring` guards stay and pass against 3.2 (verified).

### 3.6 `test/kit-player.test.tsx` — comments only (KIT-022 R5)

The double there "follows the Fire OS adapter's handler contract … and has no cancel (KIT-023)". After 3.2 that is no longer a description of `fireos.tsx`. Reword the file comment (lines 5–7) and the `latest`/`textUrls` comments (23–25) to: *a double that publishes through captured handlers and does **not** cancel — the shape of the Fire OS adapter before KIT-023 — kept because the kit's gate must hold without adapter cooperation (decision 0005 §3 amendment).* Test #5 ("pins: a superseded load's `onState('ready')` still reaches the app — KIT-015 decides") stays as is: it pins `handleState`, through the double, and is unaffected by the adapter change.

### 3.7 Changeset — sequence with the Scribe

Append to `.changeset/release-0-1-0.md` (still `minor`, one file). **A Scribe is editing that file for KIT-031 right now**: the implementer must not touch it in the same pass; the orchestrator appends this paragraph after the KIT-031 commit lands (or hands it to the KIT-023 reviewer round). Text:

```
**Fire OS: switching `source` cancels the previous load.** The Fire OS adapter now keeps everything that
belongs to one load — the master-playlist read, the text-track urls, the reported tracks — in a per-load
record that a `source.uri` change replaces. A load that was still reading its master playlist when the
source changed no longer reports its tracks or a second `ready`, its playlist error is not reported, and its
urls can no longer be picked up by the next source's `selectText` (previously the next title could fetch
the previous title's captions after a slow manifest). `getTracks()` and `getPosition()` answer empty / the
start position for the new source at once, and the previous audio selection is not applied to it. A fresh
react-native-video instance is mounted per `source.uri`. `selectAudio` now marks the chosen track `active`
in `getTracks()`. Multi-track text selection is unchanged.
```

### 3.8 Not touched

`src/player/types.ts` (its `AdapterProps` JSDoc already says "an adapter should still cancel its own superseded loads (KIT-023)" — now true), `src/player/index.ts`, `src/index.ts`, `src/core/**`, `src/player/adapters/web.tsx`, `vega.tsx`, `index.ts`, `src/player/selection.ts`, `test/selection.test.ts` (its `KitPlayer wiring` guards read `KitPlayer.tsx` only; `useLayoutEffect(` ×1 there is unaffected by the adapter's own layout effect), `harness/**`.

---

## 4. Acceptance tests (`test/fireos-adapter.test.tsx`), with the observed HEAD failures

All eight below were run against HEAD's adapter (only the `rnv.ts` seam applied, no behaviour change) and failed as stated; all ten pass on 3.2.

| # | `it(...)` | RED on HEAD because |
|---|---|---|
| T1 | `drops a superseded load's continuation: no onTracks, no ready, getTracks() stays empty` | `expected ['loading','loading','ready'] to deeply equal ['loading','loading']` (D2); `getTracks()` is A's (D1) |
| T2 | `a superseded load's manifest cannot feed the live source's selectText (A's playlists on B)` | `expected 'https://a/de.vtt' to be 'https://b/de.vtt'` — the user's re-pick on B fetched A's playlist (D1, the headline) |
| T3 | `a superseded load's master-playlist failure is not reported as HLS_MASTER; the live one's is` | `onError` called once with `HLS_MASTER` for A after the switch (D3) |
| T4 | `an onLoad dispatched after the switch but before the new source's onLoadStart is the previous source's and is dropped` | `onTracks` called once — A's ExoPlayer audio + A's manifest text published as B (D4) |
| T5 | `A→B→A: the first A load is superseded by the second even though the uri is live again` | `onTracks` called once with the `v1` list before the second load finished (D5) |
| T6 | `resets tracks, text urls, position and the audio index when source.uri changes (KIT-020)` | `getTracks()` is A's full list right after `render(B)` (D6) |
| T7 | `selectAudio marks the chosen audio track active in getTracks() (KIT-029)` | `expected [true,false] to deeply equal [false,true]` (D7) |
| T8 | `mounts a fresh react-native-video instance per source.uri` | `expected [1, 0] to deeply equal [2, 1]` — HEAD reuses the instance |
| C1 | `publishes once after the manifest resolves, applies preferredText, and delivers cues` | control — green on HEAD and after; catches an over-eager cancel |
| C2 | `the deprecated x-kit-text-urls header still overrides a manifest url for the same id and adds an id the manifest lacks` | control — green on HEAD and after; replaces the retired structural guard |

Counts: vitest 159 → 168 (+10, −2 retired, +1 structural). Harness unchanged (25).

Done when: `pnpm typecheck && pnpm test` green (note: `pnpm lint` fails on HEAD for want of an `eslint.config.js` — pre-existing, not this ticket), the ten `it`s above exist by name, and §5's mutations behave as listed.

---

## 5. Mutations for the orchestrator (one at a time in `fireos.tsx` as per 3.2; revert; never commit)

Observed in the scratch run; the "must go red" column is what was seen.

| # | Mutation | Must go red |
|---|---|---|
| M1 | delete `if (l !== load.current) return` (post-await) | T1, T5. (T2 stays green — the record structure alone keeps A's urls off B; that is §2.3's point, not a gap) |
| M2 | delete `if (!l.started) return` | T4 |
| M3 | delete `key={props.source.uri}` | T8 |
| M4 | make the `HLS_MASTER` report unconditional (drop `if (l === load.current)`) | T3 |
| M5 | delete `setAudioIndex(undefined)` from the layout effect | T6 |
| M6 | delete the `l.tracks = …active…` line in `selectAudio` | T7 |
| M7 | delete `position.current = props.startAt ?? 0` from the layout effect | T6 |
| M8 | move record creation from the layout effect into `onLoadStart` (`if (load.current.uri !== props.source.uri) load.current = newLoad(...)` there; effect only clears audio/position) | T4, T5, T6 — the "simpler" design, §2.3 |
| M9 | compare `l.uri !== load.current.uri` instead of identity after the await | T5 |

Also run `pnpm typecheck` and the full `pnpm test` after each revert.

---

## 6. Device verification (Fire TV Stick `AFTSS`, Fire OS 7.7.1.6) — required before ticking the ticket

The harness cannot run Fire OS (0001 §6). The sample app at `~/hackathon/react-native-multi-tv-app-sample` loads the kit's `src/` live through Metro (`apps/expo-multi-tv/metro.config.js:41-47`), so no kit build is needed — Metro reloads on save.

### 6.1 Screen change: `packages/shared-ui/src/screens/KitSpikeScreen.tsx` (sample app, not the kit)

The screen has a single constant `URI` (`:15`). Give it two sources and a button:

```tsx
// Two titles with different hosts, captions and audio, so a stale report is identifiable by url/text in the log.
const URIS = [
  'https://dco7qa0c4m1pw.cloudfront.net/spike/hls/master.m3u8',          // own HLS: en Original + en AD; en Captions / Rich captions / Description text
  'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8', // Angel One: en/de/it/fr/es(+en) audio; en/el/fr/pt-BR WebVTT
]
const [uriIx, setUriIx] = useState(0)
const URI = URIS[uriIx]
const switched = useRef(false)
const switchSource = () => {
  const next = (uriIx + 1) % URIS.length
  log('switchSource', 'from', URIS[uriIx], 'to', URIS[next], 'atPos', pos)
  seeded.current = false            // let onTracks re-seed the HUD's selected ids for the new title
  switched.current = true
  setSelText([]); setCues([])
  setUriIx(next)
}
// KIT-023: what the adapter answers immediately after the switch, before any native event (KIT-020 half).
useEffect(() => {
  if (!switched.current) return
  log('tracksRightAfterSwitch', JSON.stringify(ref.current?.getTracks()), 'pos', ref.current?.getPosition())
}, [uriIx])
```

Buttons (in the `SpatialNavigationView` row): `<Btn label="Switch src" onPress={switchSource} />` and
`<Btn label="Switch ×2" onPress={() => { switchSource(); setTimeout(switchSource, 150) }} />` — the second models A→B→A inside one load's latency (the CloudFront master round-trip from the stick was ~100–300 ms in the spike). Pass `source={{ uri: URI, type: 'hls' }}` as today. Remove the `'ready'`-as-playing HUD workaround only when KIT-015 lands, not here.

### 6.2 Log capture

```
adb logcat -c
adb logcat -v time | grep KIT-SPIKE | tee ~/hackathon/spike-evidence/fireos-kit023-switch.log
```

### 6.3 Steps and pass criteria

1. **Baseline (control).** Open KitSpike. Expect `state loading` → one `tracks` line with `cloudfront.net` urls → `seedText` → `cue` lines → `state ready`/`playing`. As before KIT-023.
2. **Plain switch during playback.** Press *Switch src* after ~10 s. Expect, in order: `switchSource`; `tracksRightAfterSwitch {"audio":[],"text":[]} pos 0` (**HEAD prints the CloudFront list and the old position**); `state loading`; exactly **one** `tracks` line and its text urls are `storage.googleapis.com/...angel-one...`; `seedText` with the fr/en ids of *that* list (`'2'`,`'0'`); `cue` lines whose text is Angel One dialogue ("Captain's log…"); no `tracks` or `cue` line with CloudFront urls/text after `switchSource`; no `error HLS_MASTER`. Then *Switch src* back: same shape with hosts reversed.
3. **Switch while the first title is still loading (D1/D4 window).** Reload the screen (Menu → back → KitSpike, or `r` in Metro) and press *Switch src* as soon as the HUD appears, before the first `tracks` line. Expect: at most one `tracks` line after `switchSource`, and it is for the new host; **no** `state ready` between `switchSource` and that `tracks` line that is not immediately followed by the new host's `tracks`; the first `cue` after the switch is the new title's text. (HEAD: a `tracks`/`ready` pair for the abandoned title, and captions from it until a re-pick.)
4. **A→B→A.** Press *Switch ×2*. Expect: two `switchSource` lines 150 ms apart, then `state loading` (×1 or ×2), then exactly one `tracks` line (for the *first* host, since the sequence returns to it), one `seedText`, and cues from that title. No second `tracks` line for the same host within the next 5 s (HEAD may publish the abandoned first load's list a second time).
5. **KIT-020 audio index.** On Angel One press *Audio ▶* until `selectAudio 1 de …` and hear German; press *Switch src*. Expect on the CloudFront title: `tracksAfterSwitch`-style HUD shows `0:en*` (Original active), audio is English, not index 1 (AD). HEAD applies index 1 to the new title until `preferredAudio` re-selects.
6. **KIT-029.** After a switch, press *Audio ▶* once; the `tracksAfterSwitch` line 2 s later must show `active:true` on the new track only (spike test 2 showed `en` still active — that log line goes right).
7. **Cost of `key` per uri.** From each `switchSource` line to the next `state ready` (or first `pos` > 0 for the new title): record the ms. Acceptable if ≤ 1.5× the initial load time of the same title observed in step 1. Note any visible artefact (black frame longer than the shutter, frozen last frame of the previous title).
8. **Regression sweep** (spike tests 2, 4, 5 on one title after at least one switch): audio switch heard, two text tracks together, seek/pause/0.75×.

Evidence: the log file plus phone photos of the TV for steps 2 and 3 (`adb screencap` is black on this stick). Record the result in `docs/device-matrix.md` (a "Source switch" row) and the KIT-023 done-section in `TASKS.md`.

### 6.4 If it fails on the device

- Step 3/4 publish a stale `tracks`: capture the exact `state`/`tracks` order and hand it to a Fable reviewer with this plan — the most likely culprit is an event ordering §2.4 did not foresee, and the fix belongs in the adapter, not the kit.
- Step 7 shows an unacceptable switch cost: revert `key` alone (M3) and re-run steps 2–4 — the `started` gate still covers D4 by the ordering argument in §2.4; then open a ticket for the ExoPlayer-reuse race and note it in `docs/device-matrix.md`.
- Any platform surprise (react-native-video prop behaviour, Metro, adb) is a friction log the same day: `pnpm friction "<title>"` in `~/hackathon/described` (that repo has the script and the `docs/friction/` format; the sample app has neither), and a link from the kit's `docs/friction.md` index.

---

## 7. Boundaries with the neighbouring tickets

- **KIT-020.** Fire OS half done here (record swap, audio index, position). Remaining: `web.tsx:13` and `vega.tsx:21` keep `tracks.current` until the new `onTracks` (one line each in their load effects). Update the KIT-020 row: "fireos: done in KIT-023; web/vega remain". The web adapter's adapter-side `getTracks()` after a switch is also visible in the harness if anyone wants a spec.
- **KIT-028 / KIT-015.** Untouched: the live load still emits `ready` after its manifest, from the same continuation as `onTracks`, i.e. after `playing` when autoplay is on. The *superseded* load's second `ready` is gone as a side effect (T1) — which is the option (ii) the KIT-022 plan §5 named for KIT-015 ("rely on KIT-023's adapter-side cancel"); KIT-015's plan should now decide only whether `handleState` gets a `loading`/`ready` gate for the other adapters. `test/kit-player.test.tsx` #5 keeps pinning `handleState` through the double.
- **KIT-029.** Done here for `getTracks()`. No `onTracks` is re-published on an audio switch (0004: one per source); if an app needs a live "active audio changed" signal that is a new contract, not this ticket.
- **KIT-016.** `selectText` still discards a rejected fetch per track with a non-fatal `TEXT_FETCH`; a stale fetch for a left title may still produce that noise (§2.5).
- **KIT-022.** `KitPlayer.tsx` code untouched; the gate is now defence in depth for Fire OS, primary for any adapter that does not cancel. Its double's comments are updated (3.6) so R5 of that plan is closed.
- **KIT-024 / KIT-010 (Vega).** Same defect class; deferred with 0001. The record shape here is the pattern the Vega rewrite should copy.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | `if (!l.started) return` would drop every load if react-native-video ever emitted `onLoad` without a preceding `onLoadStart` on the same instance. | Not possible in 6.19 by construction (`loadVideoStarted`, `:894-895`, `:1486`); C1 guards the happy path; device step 1 shows `state loading` before every `tracks`. If a future RNV changes this, the failure is loud (no tracks at all), not silent. |
| R2 | `key` per uri re-creates ExoPlayer per title: slower switch, possible black frame; unknown interaction with react-native-tvos focus or the sample's `useExoplayerHls` rebuild. | Device step 7 with a numeric bar; fallback in §6.4 (revert M3 only). Both defences are independent, so the test suite stays green either way except T8. |
| R3 | The `rnv.ts` seam is a production module that exists for a test. | Eight lines, one function, not exported publicly; it is also the natural home for a friendlier "install react-native-video" error later. The alternative — injecting into Node's `require.cache` from the test — relies on loader internals and on the optional peer being installed in CI. |
| R4 | The React 19 "ref as prop" convenience in the mock (`videoRef.current` stays null) hides a broken `seek` wiring. | `seek` is one line unchanged from HEAD and exercised on the device (step 8). Not this ticket's surface. |
| R5 | `useLayoutEffect` deps include `props.startAt`; a `startAt`-only change re-runs the effect, which returns early on the uri compare. | Harmless by construction; T6 covers the uri path. An `eslint` exhaustive-deps rule would want both — there is no eslint config today. |
| R6 | ExoPlayer-internal READY/`setMediaSource` race (§2.4) is argued from source, not reproduced. | With `key` it is moot; it is recorded so nobody removes `key` as "cosmetic" without re-reading §2.4. |
| R7 | The Scribe's concurrent edit of `.changeset/release-0-1-0.md`. | 3.7: the implementer does not touch the file; the orchestrator appends after KIT-031 commits. |

---

## 9. Orchestrator notes (not questions)

- `TASKS.md`: KIT-023 done → also mark KIT-029 done (same commit) and amend KIT-020 to "web/vega halves remain". Progress-log tests: 168 + 25. Add a "Source switch" row to `docs/device-matrix.md` after §6.
- Model routing: implementation is mechanical (texts above are verified) → Opus. Review → Fable, with §5's mutations and a read of §2.4. Device run → human (hardware; §6 of the protocol).
- No new decision record is needed: no public type changes, no contract change; 0005 §3's amendment already requires adapter-side cancellation and this is its Fire OS implementation. If the orchestrator wants the `key`-per-uri choice on record, one line under 0005 §3 suffices.

## 10. Open questions for the human

None — no product decision. The only thing that needs a person is the Fire TV stick (§6).
