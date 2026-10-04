// @vitest-environment jsdom
/**
 * KIT-016 §6.1.4: a fast jsdom mirror of the real `WebAdapter`'s per-track `selectText` error routing. `fetch` is
 * stubbed and `loadedmetadata` is dispatched by hand on the rendered `<video>` to complete the adapter's join.
 * The guard of record for the KitPlayer + WebAdapter wiring is the Playwright harness (specs 30–33).
 */
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PlayerError, Tracks } from '../src/core'
import type { KitPlayerRef } from '../src/player/types'
import { WebAdapter } from '../src/player/adapters/web'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BASE = 'https://cdn.example/s/'
const MASTER_URL = `${BASE}master.m3u8`
const MASTER = [
  '#EXTM3U',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Deutsch",LANGUAGE="de",URI="subs/de/index.m3u8"',
  '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en/index.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=200000,SUBTITLES="subs"',
  'video/index.m3u8',
  '',
].join('\n')
const PLAYLIST = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg-0.vtt\n#EXT-X-ENDLIST\n'
const SEG = (t: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${t}\n`

type Answer = { status: number; body: string } | 'throw'
let answers: Record<string, Answer>
let seen: string[]

beforeEach(() => {
  seen = []
  answers = {
    [MASTER_URL]: { status: 200, body: MASTER },
    [`${BASE}subs/de/index.m3u8`]: { status: 200, body: PLAYLIST },
    [`${BASE}subs/de/seg-0.vtt`]: { status: 200, body: SEG('Hallo') },
    [`${BASE}subs/en/index.m3u8`]: { status: 200, body: PLAYLIST },
    [`${BASE}subs/en/seg-0.vtt`]: { status: 200, body: SEG('Hello') },
  }
  vi.stubGlobal('fetch', async (url: string) => {
    seen.push(url)
    const a = answers[url] ?? { status: 404, body: 'Not Found' }
    if (a === 'throw') throw new TypeError('Failed to fetch')
    return { ok: a.status >= 200 && a.status < 300, status: a.status, url, text: async () => a.body }
  })
})

let root: Root
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

/** Render the real adapter, complete its join (manifest + a hand-dispatched loadedmetadata), return its handle. */
async function mount() {
  const ref = createRef<KitPlayerRef>()
  const onError = vi.fn<(e: PlayerError) => void>()
  const onTextTrackData = vi.fn<(id: string, vtt: string) => void>()
  const onTracks = vi.fn<(t: Tracks) => void>()
  const host = document.createElement('div')
  root = createRoot(host)
  act(() =>
    root.render(
      <WebAdapter ref={ref} source={{ uri: MASTER_URL, type: 'hls' }} onError={onError} onTextTrackData={onTextTrackData} onTracks={onTracks} />,
    ),
  )
  await act(async () => {
    host.querySelector('video')!.dispatchEvent(new Event('loadedmetadata'))
    for (let i = 0; i < 10 && onTracks.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 0))
  })
  expect(onTracks).toHaveBeenCalledTimes(1)
  seen.length = 0 // count only the subtitle requests below
  return { ref, onError, onTextTrackData }
}

describe('WebAdapter selectText error routing (KIT-016, fast mirror)', () => {
  it('selectText(["0","1"]) with track 0 answering 404 calls onError once with TEXT_FETCH for 0 and still delivers track 1 through onTextTrackData', async () => {
    answers[`${BASE}subs/de/index.m3u8`] = { status: 404, body: 'Not Found' }
    const { ref, onError, onTextTrackData } = await mount()
    await act(async () => {
      await ref.current!.selectText(['0', '1'])
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]![0]).toMatchObject({ code: 'TEXT_FETCH', message: 'Could not load text track 0', fatal: false })
    expect(onError.mock.calls[0]![0].cause).toBeInstanceOf(Error)
    expect(onTextTrackData.mock.calls.map(([id]) => id)).toEqual(['1'])
    expect(onTextTrackData.mock.calls[0]![1]).toContain('Hello')
  })

  it('a 200 HTML body for a subtitle playlist reports TEXT_FETCH after exactly one request for that track', async () => {
    answers[`${BASE}subs/en/index.m3u8`] = { status: 200, body: '<!doctype html>\n<html>\n<body>CDN error</body>\n</html>\n' }
    const { ref, onError, onTextTrackData } = await mount()
    await act(async () => {
      await ref.current!.selectText(['1'])
    })

    expect(seen).toEqual([`${BASE}subs/en/index.m3u8`])
    expect(onError.mock.calls.map(([e]) => [e.code, e.fatal])).toEqual([['TEXT_FETCH', false]])
    expect(onTextTrackData).not.toHaveBeenCalled()
  })

  it('selectText never rejects, whatever the fetch does', async () => {
    answers[`${BASE}subs/de/index.m3u8`] = 'throw'
    answers[`${BASE}subs/en/seg-0.vtt`] = { status: 500, body: 'oops' }
    const { ref, onError } = await mount()
    let outcome = 'pending'
    await act(async () => {
      await Promise.resolve(ref.current!.selectText(['0', '1'])).then(
        () => (outcome = 'resolved'),
        () => (outcome = 'rejected'),
      )
    })

    expect(outcome).toBe('resolved')
    expect(onError).toHaveBeenCalledTimes(2)
  })
})
