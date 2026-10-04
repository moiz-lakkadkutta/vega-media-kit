// @vitest-environment jsdom
/**
 * DESC-006: `setVolume` on the REAL `KitPlayer` + the REAL `WebAdapter` under jsdom. jsdom's `HTMLMediaElement.volume`
 * behaves like a browser's: it throws `IndexSizeError` outside [0, 1]
 * (https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume), so clamping is observable here.
 * `fetch` never resolves: the master-playlist read is irrelevant to volume.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { KitPlayerRef } from '../src/player/types'

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))

import { KitPlayer } from '../src/player/KitPlayer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let api: KitPlayerRef | null = null
const setApi = (r: KitPlayerRef | null) => {
  api = r
}
const video = () => host.querySelector('video') as HTMLVideoElement
const setVolume = (v: number) => act(() => api!.setVolume(v))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  host = document.createElement('div')
  root = createRoot(host)
  render('https://a/master.m3u8')
})
const render = (uri: string) => act(() => root.render(<KitPlayer ref={setApi} source={{ uri, type: 'hls' }} testID="v" />))
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

describe('WebAdapter — setVolume (DESC-006)', () => {
  it('sets the video element volume', () => {
    expect(video().volume).toBe(1)
    setVolume(0.25)
    expect(video().volume).toBe(0.25)
  })

  it('clamps to [0, 1] instead of throwing IndexSizeError', () => {
    expect(() => setVolume(1.5)).not.toThrow()
    expect(video().volume).toBe(1)
    expect(() => setVolume(-1)).not.toThrow()
    expect(video().volume).toBe(0)
  })

  it('ignores NaN', () => {
    setVolume(0.5)
    expect(() => setVolume(Number.NaN)).not.toThrow()
    expect(video().volume).toBe(0.5)
  })

  it('is kept across a source change', () => {
    setVolume(0.3)
    render('https://b/master.m3u8')
    expect(video().src).toBe('https://b/master.m3u8')
    expect(video().volume).toBe(0.3)
  })

  it('leaves the source alone: same element, same src', () => {
    const el = video()
    const src = el.src
    setVolume(0.1)
    expect(video()).toBe(el)
    expect(el.src).toBe(src)
  })
})
