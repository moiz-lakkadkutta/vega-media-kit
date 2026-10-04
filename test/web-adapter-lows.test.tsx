// @vitest-environment jsdom
/**
 * KIT-025 (docs/plans/KIT-025-web-adapter-lows.md §6.1): the REAL `KitPlayer` + the REAL `WebAdapter` under jsdom.
 * Element events are dispatched by hand; `play()`/`pause()` are stubbed (jsdom does not implement them); `v.error` and
 * `v.paused` are set per element; the master-playlist `fetch` is held per uri until a test releases it. Every test
 * asserts that no promise rejection went unhandled. The Playwright harness (specs 34–42) is the guard in Chromium.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PlayerError, PlayerState, Tracks } from '../src/core'
import type { KitPlayerProps, KitPlayerRef } from '../src/player/types'

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))

import { KitPlayer } from '../src/player/KitPlayer'
import { WebAdapter, mediaElementError, playRejection } from '../src/player/adapters/web'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A = 'https://cdn.example/a/master.m3u8'
const B = 'https://cdn.example/b/master.m3u8'
const MASTER = [
  '#EXTM3U',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Deutsch",LANGUAGE="de",URI="subs/de/index.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en/index.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=200000,SUBTITLES="subs"',
  'video/index.m3u8',
  '',
].join('\n')

const MEDIA_MESSAGES: Record<number, string> = {
  1: 'Media loading was aborted',
  2: 'A network error stopped the media download',
  3: 'The media could not be decoded',
  4: 'The media source is not supported or could not be loaded',
}

// ---- fetch: the master playlist is held per uri until released; anything else (subtitle playlists) hangs ----------

let manifestGates: Map<string, () => void>
let fetched: string[]
function stubFetch() {
  manifestGates = new Map()
  fetched = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      fetched.push(url)
      if (url !== A && url !== B) return new Promise(() => {})
      return new Promise((resolve) => {
        manifestGates.set(url, () => resolve({ ok: true, status: 200, url, text: async () => MASTER }))
      })
    }),
  )
}
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
async function releaseManifest(uri: string) {
  const go = manifestGates.get(uri)
  if (!go) throw new Error(`no manifest fetch for ${uri}`)
  go()
  await flush()
}

// ---- play()/pause() --------------------------------------------------------------------------------------------

let playImpl: () => unknown
const realPlay = HTMLMediaElement.prototype.play
const realPause = HTMLMediaElement.prototype.pause
const dom = (name: string) => new DOMException('play() failed', name)

// ---- the page ----------------------------------------------------------------------------------------------

let root: Root
let host: HTMLDivElement
let api: KitPlayerRef | null = null
const setApi = (r: KitPlayerRef | null) => {
  api = r
}
let log: string[]
const onError = vi.fn<(e: PlayerError) => void>((e) => void log.push(`error:${e.code}`))
const onState = vi.fn<(s: PlayerState) => void>((s) => void log.push(`state:${s}`))
const onTracks = vi.fn<(t: Tracks) => void>(() => void log.push('tracks'))
const ctx: { state: PlayerState | null; tracks: Tracks | null } = { state: null, tracks: null }
const renderControls = (c: { state: PlayerState; tracks: Tracks }) => {
  ctx.state = c.state
  ctx.tracks = c.tracks
  return null
}
const video = () => host.querySelector('video') as HTMLVideoElement
const fire = (type: string) => act(() => void video().dispatchEvent(new Event(type)))
function setPaused(paused: boolean) {
  Object.defineProperty(video(), 'paused', { configurable: true, get: () => paused })
}
function fail(code: number) {
  Object.defineProperty(video(), 'error', { configurable: true, get: () => ({ code, message: `DEMUXER ${code}` }) })
  return fire('error')
}
const states = () => log.filter((x) => x.startsWith('state:')).map((x) => x.slice(6))

function render(uri: string, extra: Partial<KitPlayerProps> = {}) {
  act(() =>
    root.render(
      <KitPlayer
        ref={setApi}
        source={{ uri, type: 'hls' }}
        onError={onError}
        onState={onState}
        onTracks={onTracks}
        renderControls={renderControls}
        testID="v"
        {...extra}
      />,
    ),
  )
}

let unhandled: unknown[]
const onUnhandled = (r: unknown) => void unhandled.push(r)

beforeEach(() => {
  stubFetch()
  log = []
  ctx.state = null
  ctx.tracks = null
  onError.mockClear()
  onState.mockClear()
  onTracks.mockClear()
  playImpl = () => Promise.resolve()
  // Plain functions, not `vi.spyOn`: a vitest spy attaches its own `.then` to a returned promise (`settledResults`),
  // which marks a rejection handled and would hide exactly the unhandled rejection these tests are about.
  HTMLMediaElement.prototype.play = function () {
    return playImpl() as Promise<void>
  }
  HTMLMediaElement.prototype.pause = () => {}
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
  host = document.createElement('div')
  root = createRoot(host)
})

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0)) // let a rejection that is going to go unhandled be reported
  process.off('unhandledRejection', onUnhandled)
  act(() => root.unmount())
  HTMLMediaElement.prototype.play = realPlay
  HTMLMediaElement.prototype.pause = realPause
  vi.unstubAllGlobals()
  expect(unhandled).toEqual([])
})

// ---- pure ---------------------------------------------------------------------------------------------------

describe('mediaElementError / playRejection (KIT-025, pure)', () => {
  it('maps each MediaError code 1–4 to a fatal MEDIA with the per-code message and the MediaError as cause', () => {
    for (const code of [1, 2, 3, 4]) {
      const err = { code, message: 'detail' }
      expect(mediaElementError(err)).toEqual({ code: 'MEDIA', fatal: true, message: MEDIA_MESSAGES[code], cause: err })
      expect(mediaElementError(err)!.cause).toBe(err)
    }
    const odd = { code: 99, message: '' }
    expect(mediaElementError(odd)).toEqual({ code: 'MEDIA', fatal: true, message: 'Playback error', cause: odd })
  })

  it('returns null for an error event with no MediaError', () => {
    expect(mediaElementError(null)).toBeNull()
  })

  it('swallows AbortError and NotSupportedError', () => {
    expect(playRejection(dom('AbortError'))).toBeNull()
    expect(playRejection(dom('NotSupportedError'))).toBeNull()
    expect(playRejection(Object.assign(new Error('x'), { name: 'AbortError' }))).toBeNull() // read structurally
  })

  it('reports NotAllowedError as a non-fatal PLAY_REJECTED with the autoplay message', () => {
    const e = dom('NotAllowedError')
    expect(playRejection(e)).toEqual({
      code: 'PLAY_REJECTED',
      fatal: false,
      message: 'Playback was blocked by the browser (autoplay policy)',
      cause: e,
    })
  })

  it('reports any other rejection reason (incl. a non-Error value) as a non-fatal PLAY_REJECTED', () => {
    for (const e of [new Error('boom'), 'nope', undefined, null, 42, { name: 7 }]) {
      expect(playRejection(e)).toEqual({ code: 'PLAY_REJECTED', fatal: false, message: 'Playback could not start', cause: e })
    }
  })
})

// ---- media errors ---------------------------------------------------------------------------------------------

describe('WebAdapter media errors (KIT-025, real KitPlayer + WebAdapter)', () => {
  it("an element error reports one fatal MEDIA through onError, then onState('error'), in that order", async () => {
    render(A)
    await fail(4)

    expect(log).toEqual(['state:loading', 'error:MEDIA', 'state:error'])
    expect(onError).toHaveBeenCalledTimes(1)
    const e = onError.mock.calls[0]![0]
    expect(e).toEqual({ code: 'MEDIA', fatal: true, message: MEDIA_MESSAGES[4], cause: { code: 4, message: 'DEMUXER 4' } })
  })

  it("a failed load with no metadata publishes no onTracks and no ready, and renderControls' state is 'error'", async () => {
    render(A)
    await fail(2)
    await releaseManifest(A)

    expect(onTracks).not.toHaveBeenCalled()
    expect(states()).toEqual(['loading', 'error'])
    expect(ctx.state).toBe('error')
  })

  it('an error after loadedmetadata, then the manifest: onTracks is published but ready is dropped', async () => {
    render(A)
    await fire('loadedmetadata')
    await fail(3)
    await releaseManifest(A)

    expect(log).toEqual(['state:loading', 'error:MEDIA', 'state:error', 'tracks'])
    expect(ctx.state).toBe('error')
  })

  it("an error after a source switch is reported once, as the new source's (the old listener is gone)", async () => {
    render(A)
    render(B)
    log = []
    await fail(4)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(log).toEqual(['error:MEDIA', 'state:error'])
    expect(ctx.state).toBe('error')
  })

  it('after a failed load, a switch reports loading, onTracks and ready for the new source', async () => {
    render(A)
    await fail(4)
    Object.defineProperty(video(), 'error', { configurable: true, get: () => null }) // the load algorithm clears it
    log = []
    render(B)
    await fire('loadedmetadata')
    await releaseManifest(B)

    expect(log).toEqual(['state:loading', 'tracks', 'state:ready'])
    expect(ctx.state).toBe('ready')
  })

  it('an error event with no MediaError reports nothing', async () => {
    render(A)
    Object.defineProperty(video(), 'error', { configurable: true, get: () => null })
    await fire('error')

    expect(log).toEqual(['state:loading'])
  })
})

// ---- play() rejections ------------------------------------------------------------------------------------------

describe('WebAdapter play() rejections (KIT-025)', () => {
  it('autoplay: an AbortError rejection reports nothing and leaves no unhandled rejection', async () => {
    playImpl = () => Promise.reject(dom('AbortError'))
    render(A, { autoplay: true })
    await flush()

    expect(onError).not.toHaveBeenCalled()
    expect(log).toEqual(['state:loading'])
  })

  it('autoplay: a NotSupportedError rejection reports nothing (the element error reports MEDIA)', async () => {
    playImpl = () => Promise.reject(dom('NotSupportedError'))
    render(A, { autoplay: true })
    await flush()

    expect(onError).not.toHaveBeenCalled()
    await fail(4)
    expect(onError.mock.calls.map(([e]) => e.code)).toEqual(['MEDIA'])
  })

  it('autoplay: a NotAllowedError rejection reports one non-fatal PLAY_REJECTED and the load still reports ready', async () => {
    const blocked = dom('NotAllowedError')
    playImpl = () => Promise.reject(blocked)
    render(A, { autoplay: true })
    await flush()

    expect(onError.mock.calls).toEqual([
      [{ code: 'PLAY_REJECTED', fatal: false, message: 'Playback was blocked by the browser (autoplay policy)', cause: blocked }],
    ])
    await fire('loadedmetadata')
    await releaseManifest(A)
    expect(states()).toEqual(['loading', 'ready'])
    expect(ctx.state).toBe('ready')
  })

  it('ref.play(): NotAllowedError reports PLAY_REJECTED; AbortError reports nothing', async () => {
    render(A)
    playImpl = () => Promise.reject(dom('NotAllowedError'))
    act(() => api!.play())
    await flush()
    expect(onError.mock.calls.map(([e]) => [e.code, e.fatal])).toEqual([['PLAY_REJECTED', false]])

    playImpl = () => Promise.reject(dom('AbortError'))
    act(() => api!.play())
    await flush()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('an autoplay rejection that settles after a source switch is not reported', async () => {
    let rejectA!: (e: unknown) => void
    playImpl = () => new Promise((_, rej) => (rejectA = rej))
    render(A, { autoplay: true })
    playImpl = () => Promise.resolve()
    render(B, { autoplay: true })
    await act(async () => {
      rejectA(dom('NotAllowedError'))
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onError).not.toHaveBeenCalled()
  })

  it('a play() that returns undefined does not throw', async () => {
    playImpl = () => undefined
    expect(() => render(A, { autoplay: true })).not.toThrow()
    expect(() => act(() => api!.play())).not.toThrow()
    await flush()
    expect(onError).not.toHaveBeenCalled()
  })

  it('an app onError that throws on PLAY_REJECTED leaves no unhandled rejection', async () => {
    const thrower = vi.fn<(e: PlayerError) => void>(() => {
      throw new Error('app onError threw')
    })
    playImpl = () => Promise.reject(dom('NotAllowedError'))
    render(A, { autoplay: true, onError: thrower })
    await flush()
    act(() => api!.play())
    await flush()

    expect(thrower).toHaveBeenCalledTimes(2) // autoplay + ref.play()
  })
})

// ---- element states -----------------------------------------------------------------------------------------

describe('WebAdapter element states (KIT-025)', () => {
  it("reports 'playing' on the element's playing event and nothing on play", async () => {
    render(A)
    await fire('play')
    expect(states()).toEqual(['loading'])
    await fire('playing')
    expect(states()).toEqual(['loading', 'playing'])
  })

  it("reports 'buffering' on waiting while not paused, and nothing on waiting while paused", async () => {
    render(A)
    setPaused(true)
    await fire('waiting') // a seek while paused: Chromium fires waiting, and nothing would ever leave `buffering`
    expect(states()).toEqual(['loading'])
    setPaused(false)
    await fire('waiting')
    expect(states()).toEqual(['loading', 'buffering'])
    expect(ctx.state).toBe('buffering')
  })

  it('an autoplay load whose join completes before playing reports loading → ready → playing', async () => {
    render(A, { autoplay: true })
    await fire('loadedmetadata')
    await releaseManifest(A)
    setPaused(false)
    await fire('playing')

    expect(log).toEqual(['state:loading', 'tracks', 'state:ready', 'state:playing'])
    expect(ctx.state).toBe('playing')
  })

  it('an autoplay load that plays before the manifest lands reports loading → playing, onTracks, and no ready (0008 §2)', async () => {
    render(A, { autoplay: true })
    await fire('loadedmetadata')
    setPaused(false)
    await fire('playing')
    await releaseManifest(A)

    expect(log).toEqual(['state:loading', 'state:playing', 'tracks'])
    expect(ctx.state).toBe('playing')
  })
})

// ---- inline callbacks ------------------------------------------------------------------------------------------

describe('WebAdapter + KitPlayer: inline callbacks are never stale (KIT-025 × KIT-012)', () => {
  it('a re-render with a new inline onState: the next element state reaches the new callback, not the old one', async () => {
    const first = vi.fn<(s: PlayerState) => void>()
    const second = vi.fn<(s: PlayerState) => void>()
    render(A, { onState: (s) => first(s) })
    render(A, { onState: (s) => second(s) })
    await fire('pause')

    expect(first.mock.calls).toEqual([['loading']])
    expect(second.mock.calls).toEqual([['paused']])
  })

  it('a re-render with a new inline onPosition: the next timeupdate reaches the new callback, not the old one', async () => {
    const first = vi.fn<(s: number) => void>()
    const second = vi.fn<(s: number) => void>()
    render(A, { onPosition: (s) => first(s) })
    render(A, { onPosition: (s) => second(s) })
    await fire('timeupdate')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('a re-render with a new inline onTracks before the join completes: the tracks reach the new callback', async () => {
    const first = vi.fn<(t: Tracks) => void>()
    const second = vi.fn<(t: Tracks) => void>()
    render(A, { onTracks: (t) => first(t) })
    render(A, { onTracks: (t) => second(t) })
    await fire('loadedmetadata')
    await releaseManifest(A)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(second.mock.calls[0]![0].text.map((t) => t.language)).toEqual(['de', 'en'])
  })

  it('a re-render with a new preferredText before the join completes: the new preference is applied', async () => {
    render(A, { preferredText: { languages: ['de'] } })
    render(A, { preferredText: { languages: ['en'] } })
    await fire('loadedmetadata')
    await releaseManifest(A)

    const subs = fetched.filter((u) => u.includes('/subs/'))
    expect(subs).toEqual(['https://cdn.example/a/subs/en/index.m3u8'])
  })
})

// ---- KIT-020: tracks never outlive their source --------------------------------------------------------------

describe('WebAdapter + KitPlayer: tracks never outlive their source (KIT-020)', () => {
  const EMPTY: Tracks = { audio: [], text: [] }
  const textUrls = (t: Tracks | null | undefined) => (t ? t.text.map((x) => x.url) : null)
  const A_URLS = ['https://cdn.example/a/subs/de/index.m3u8', 'https://cdn.example/a/subs/en/index.m3u8']
  const B_URLS = ['https://cdn.example/b/subs/de/index.m3u8', 'https://cdn.example/b/subs/en/index.m3u8']
  const fetchedUnder = (prefix: string) => fetched.filter((u) => u.startsWith(prefix))
  async function completeA(extra: Partial<KitPlayerProps> = {}) {
    render(A, extra)
    await fire('loadedmetadata')
    await releaseManifest(A)
    expect(textUrls(api!.getTracks())).toEqual(A_URLS) // sanity: A's list is in
  }

  it("getTracks() is empty right after a switch while the new manifest is held, equals renderControls' tracks, and is the new source's list once it lands", async () => {
    await completeA()
    render(B)

    expect(api!.getTracks()).toEqual(EMPTY)
    expect(ctx.tracks).toEqual(EMPTY)
    await fire('loadedmetadata')
    expect(api!.getTracks()).toEqual(EMPTY) // the manifest is still held
    await releaseManifest(B)
    expect(textUrls(api!.getTracks())).toEqual(B_URLS)
    expect(api!.getTracks()).toEqual(ctx.tracks)
  })

  it("selectText(['0']) during the new source's load fetches nothing of the previous source's and delivers no cue", async () => {
    const onCue = vi.fn<(c: unknown[]) => void>()
    await completeA({ onCue })
    render(B, { onCue })
    act(() => api!.selectText(['0']))
    await flush()

    expect(fetchedUnder('https://cdn.example/a/subs/')).toEqual([])
    expect(onCue.mock.calls.filter(([c]) => c.length > 0)).toEqual([])
  })

  it('after a switch to a source whose media fails before metadata (MEDIA), getTracks() and renderControls stay empty and selectText fetches nothing of the previous source', async () => {
    await completeA()
    render(B)
    await fail(4)
    await releaseManifest(B)
    await flush()

    expect(api!.getTracks()).toEqual(EMPTY)
    expect(ctx.tracks).toEqual(EMPTY)
    expect(onTracks).toHaveBeenCalledTimes(1) // A's
    act(() => api!.selectText(['0']))
    await flush()
    expect(fetchedUnder('https://cdn.example/a/subs/')).toEqual([])
  })

  it("a load that fails after loadedmetadata keeps its own published tracks: getTracks() equals renderControls' tracks", async () => {
    render(A)
    await fire('loadedmetadata')
    await fail(3)
    await releaseManifest(A)

    expect(ctx.state).toBe('error')
    expect(textUrls(api!.getTracks())).toEqual(A_URLS)
    expect(api!.getTracks()).toEqual(ctx.tracks)

    // And an error after the join (tracks already published) does not clear them either (R-W3/R-K5).
    Object.defineProperty(video(), 'error', { configurable: true, get: () => null }) // the load algorithm clears it
    render(B)
    await fire('loadedmetadata')
    await releaseManifest(B)
    await fail(3)
    expect(ctx.state).toBe('error')
    expect(textUrls(api!.getTracks())).toEqual(B_URLS)
    expect(api!.getTracks()).toEqual(ctx.tracks)
  })

  it('WebAdapter alone: getTracks() is empty right after source.uri changes, without KitPlayer', async () => {
    let adapter: KitPlayerRef | null = null
    const setAdapter = (r: KitPlayerRef | null) => {
      adapter = r
    }
    const handlers = { onTracks: vi.fn(), onState: vi.fn(), onError: vi.fn(), onTextTrackData: vi.fn() }
    const renderAdapter = (uri: string) =>
      act(() => root.render(<WebAdapter ref={setAdapter} source={{ uri, type: 'hls' }} testID="v" {...handlers} />))
    renderAdapter(A)
    await fire('loadedmetadata')
    await releaseManifest(A)
    expect(textUrls(adapter!.getTracks())).toEqual(A_URLS)

    renderAdapter(B)
    expect(adapter!.getTracks()).toEqual(EMPTY)
    await act(async () => {
      await adapter!.selectText(['0'])
    })
    expect(fetchedUnder('https://cdn.example/a/subs/')).toEqual([])
    expect(handlers.onTextTrackData).not.toHaveBeenCalled()
  })

  it("getTracks() inside onTracks and inside onState('ready') answers the new source's list after a switch", async () => {
    const inTracks: unknown[] = []
    const inReady: unknown[] = []
    const extra: Partial<KitPlayerProps> = {
      onTracks: () => void inTracks.push(textUrls(api!.getTracks())),
      onState: (s) => {
        if (s === 'ready') inReady.push(textUrls(api!.getTracks()))
      },
    }
    render(A, extra)
    await fire('loadedmetadata')
    await releaseManifest(A)
    render(B, extra)
    await fire('loadedmetadata')
    await releaseManifest(B)

    expect(inTracks).toEqual([A_URLS, B_URLS])
    expect(inReady).toEqual([A_URLS, B_URLS])
  })
})
