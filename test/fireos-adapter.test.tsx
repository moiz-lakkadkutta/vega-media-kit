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
/** What `renderControls` was last handed — the `state` a HUD reads (KIT-028). */
const ctx: { state: PlayerState | null } = { state: null }
function render(uri: string, headers?: Record<string, string>, opts?: { autoplay?: boolean }) {
  act(() =>
    root.render(
      <KitPlayer
        ref={setApi}
        source={{ uri, type: 'hls', headers }}
        autoplay={opts?.autoplay}
        renderControls={(c) => {
          ctx.state = c.state
          return null
        }}
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
/** react-native-video's `onBuffer` / `onPlaybackStateChanged`, as the adapter maps them (`fireos.tsx` `<Video>`). */
const buffer = (isBuffering: boolean) => act(() => rig.props!.onBuffer({ isBuffering }))
const playbackState = (isPlaying: boolean) => act(() => rig.props!.onPlaybackStateChanged({ isPlaying }))

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
  ctx.state = null
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

    // Since KIT-015 the kit's origin gate on handleState (decision 0008 §3) also drops A's stale `ready`, so this
    // test stays green if the adapter's post-await cancel is deleted (KIT-023 M1); the A→B→A test below still
    // goes red on that mutation and remains the guard of the adapter's own cancel.
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

describe('FireOsAdapter — tracks before ready; ready never overwrites playing (KIT-015 / KIT-028)', () => {
  it('reports onTracks before ready for the live load, from the same continuation', async () => {
    render(A)
    await loadStart()
    await load()
    await release(0, MASTER_A)

    expect(onTracks).toHaveBeenCalledTimes(1)
    expect(states()).toEqual(['loading', 'ready'])
    expect(onTracks.mock.invocationCallOrder[0]!).toBeLessThan(onState.mock.invocationCallOrder[1]!) // the `ready` call
  })

  it("ready does not overwrite playing: loading → buffering → playing → tracks leaves state 'playing' and reports no ready (KIT-028, the device sequence)", async () => {
    // Replays spike-evidence/fireos-kit023-switch.log (autoplay on): loading, buffering, playing (onBuffer false),
    // playing (onPlaybackStateChanged), then the manifest-gated onLoad continuation — tracks, then `ready`.
    render(A, undefined, { autoplay: true })
    await loadStart()
    await buffer(true)
    await buffer(false) // not paused → 'playing'
    await playbackState(true) // 'playing' again, as the stick reports it
    await load()
    await release(0, MASTER_A)

    expect(states()).toEqual(['loading', 'buffering', 'playing', 'playing'])
    expect(onTracks).toHaveBeenCalledTimes(1)
    expect(ctx.state).toBe('playing')
    expect(urls(api!.getTracks())).toEqual(['https://a/en.vtt', 'https://a/de.vtt'])
  })

  it('ready is still reported after buffering and paused (autoplay off): loading → buffering → paused → tracks → ready', async () => {
    render(A)
    await loadStart()
    await buffer(true)
    await buffer(false) // paused → 'paused'
    await load()
    await release(0, MASTER_A)

    expect(states()).toEqual(['loading', 'buffering', 'paused', 'ready'])
    expect(ctx.state).toBe('ready')
  })

  it("a source switched away from while playing does not swallow the new source's ready", async () => {
    render(A, undefined, { autoplay: true })
    await loadStart()
    await playbackState(true)
    await load()
    await release(0, MASTER_A) // A was already playing: no ready
    render(B)
    await loadStart()
    await load()
    expect(fetched()[2]).toBe(B) // held[1] is A's de.vtt, fetched by preferredText
    await release(2, MASTER_B)

    expect(states()).toEqual(['loading', 'playing', 'loading', 'ready'])
    expect(ctx.state).toBe('ready')
  })
})

describe('FireOsAdapter — setVolume (DESC-006)', () => {
  const setVolume = (v: number) => act(() => api!.setVolume(v))

  it("passes react-native-video's `volume` prop, full volume by default", () => {
    render(A)
    expect(rig.props!.volume).toBe(1)
    setVolume(0.4)
    expect(rig.props!.volume).toBe(0.4)
  })

  it('clamps to [0, 1] and ignores NaN', () => {
    render(A)
    setVolume(2)
    expect(rig.props!.volume).toBe(1)
    setVolume(-0.5)
    expect(rig.props!.volume).toBe(0)
    setVolume(0.6)
    setVolume(Number.NaN)
    expect(rig.props!.volume).toBe(0.6)
  })

  it('is a prop update on the same player: no re-mount, no new load, no state report', async () => {
    render(A)
    await loadStart()
    await load()
    await release(0, MASTER_A)
    const statesBefore = states()
    const fetchesBefore = fetched().length

    for (const v of [0.8, 0.6, 0.4, 0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]) setVolume(v) // a crossfade's steps

    expect(rig.mounts).toBe(1)
    expect(rig.unmounts).toBe(0)
    expect(rig.props!.source.uri).toBe(A)
    expect(fetched()).toHaveLength(fetchesBefore)
    expect(states()).toEqual(statesBefore)
    expect(rig.props!.volume).toBe(1)
  })

  it('is kept across a source change: the new <Video> mounts at the same volume', async () => {
    render(A)
    setVolume(0.3)
    render(B)
    expect(rig.mounts).toBe(2) // a fresh react-native-video instance for B
    expect(rig.props!.source.uri).toBe(B)
    expect(rig.props!.volume).toBe(0.3)
  })

  it('works when called unbound (`const set = ref.setVolume; set(v)`)', () => {
    render(A)
    const set = api!.setVolume
    act(() => set(0.3))
    expect(rig.props!.volume).toBe(0.3)
  })
})
