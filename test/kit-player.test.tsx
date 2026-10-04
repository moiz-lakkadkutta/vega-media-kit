// @vitest-environment jsdom
/**
 * Guard of record for KIT-022 (docs/plans/KIT-022-tracks-origin-gate.md §7.1): the real `KitPlayer` — its
 * scheduler, `selectText`, source-change reset and `handleTracks` — rendered under jsdom with a *platform
 * double* in place of the adapter. The double publishes through captured handlers and does **not** cancel —
 * the shape of the Fire OS adapter before KIT-023 (`onLoad` publishing through the props it closed over when
 * the native event was dispatched, across its manifest await) — kept because the kit's gate must hold without
 * adapter cooperation (decision 0005 §3 amendment). It re-implements no kit logic. Since KIT-015 the state gate
 * is asserted here too (#5–#7; docs/decisions/0008).
 *
 * Also the guard of record for KIT-014 / decision 0007 on the real component: an empty `preferredText` selects
 * nothing and description text is opt-in.
 */
import { act, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Cue, PlayerError, PlayerState, Tracks } from '../src/core'
import type { AdapterProps, KitPlayerProps, KitPlayerRef } from '../src/player/types'

const fake = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))
vi.mock('../src/player/adapters', () => ({ resolveAdapter: () => fake.current }))

import { KitPlayer } from '../src/player/KitPlayer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---- the platform double (Fire OS contract) --------------------------------------------------------------

/**
 * The latest render's props — what a captured-handler `onLoad` (`useCallback(…, [props])`) closes over, as the
 * Fire OS adapter did before KIT-023. The double does not cancel: the kit's gate must hold without it (0005 §3).
 */
let latest: { props: AdapterProps | null } = { props: null }
/** One shared url map, overwritten by every *completed* load before it publishes — pre-KIT-023 Fire OS shape. */
let textUrls = new Map<string, string>()
const selectTextCalls: string[][] = []
const selectAudioCalls: string[] = []
const setVolumeCalls: number[] = []
/** KIT-016: when set, the double's `selectText` returns what this returns; it gets *this render's* props. */
let selectTextImpl: ((ids: string[], props: AdapterProps) => unknown) | null = null

/** A one-cue VTT whose text is the playlist url, so the cue on screen says which source's bytes landed. */
const vttFor = (url: string) => `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${url}\n`

const Double = forwardRef<KitPlayerRef, AdapterProps>(function Double(props, ref) {
  latest.props = props
  // Re-created every render (no deps), as the real adapters' handles are (`FireOsAdapter`'s `useImperativeHandle`): `selectText`
  // delivers through *this render's* `onTextTrackData` — the handler live when `selectText` is called.
  useImperativeHandle(ref, () => ({
    play: () => {},
    pause: () => {},
    seek: () => {},
    setRate: () => {},
    setVolume: (v: number) => {
      setVolumeCalls.push(v)
    },
    selectAudio: (id: string) => {
      selectAudioCalls.push(id)
    },
    selectText: (ids: string[]) => {
      selectTextCalls.push([...ids])
      if (selectTextImpl) return selectTextImpl(ids, props) // KIT-016: a controlled promise / an onError report
      for (const id of ids) {
        const url = textUrls.get(id)
        if (url) props.onTextTrackData?.(id, vttFor(url))
      }
    },
    getPosition: () => 0,
    getTracks: () => ({ audio: [], text: [] }),
  }))
  return null
})

/**
 * "The native `onLoad` was dispatched now": captures the handlers of the render that is current at call time
 * and holds them across the manifest await. `complete` is the continuation after the await.
 */
function beginLoad() {
  const p = latest.props
  if (!p) throw new Error('the platform double never rendered — is the adapters mock applied?')
  const onTracks = p.onTracks
  const onState = p.onState
  return {
    complete(t: Tracks) {
      act(() => {
        textUrls = new Map(t.text.flatMap((x) => (x.url ? [[x.id, x.url] as const] : [])))
        onTracks?.(t)
        onState?.('ready')
      })
    },
  }
}

// ---- fixtures -------------------------------------------------------------------------------------------

const main = { id: 'a0', language: 'en', label: 'English', roles: ['main' as const], active: true }
const TRACKS_A: Tracks = {
  audio: [main],
  text: [{ id: '0', language: 'de', label: 'Deutsch', kind: 'subtitles', active: false, url: 'A/0' }],
}
// Ids collide with A's and `de` moves, as 0004 ordinals do.
const TRACKS_B: Tracks = {
  audio: [main],
  text: [
    { id: '0', language: 'en', label: 'English', kind: 'subtitles', active: false, url: 'B/0' },
    { id: '1', language: 'de', label: 'Deutsch', kind: 'subtitles', active: false, url: 'B/1' },
  ],
}
/** A source with an audio-description text rendition (`CHARACTERISTICS="public.accessibility.describes-video"` → 'descriptions'). */
const TRACKS_D: Tracks = {
  audio: [main],
  text: [
    { id: '0', language: 'en', label: 'English', kind: 'subtitles', active: false, url: 'D/0' },
    { id: '1', language: 'de', label: 'Deutsch', kind: 'subtitles', active: false, url: 'D/1' },
    { id: '2', language: 'en', label: 'Audio description', kind: 'descriptions', active: false, url: 'D/2' },
  ],
}

// Load-bearing: module-level, stable identities. An inline `preferredText={{…}}` re-creates `handleTracks` on
// every render through that dep and masks a missing `sourceUri` dep (plan §7.4 M2).
const PREF = { languages: ['de'] }
type Pref = NonNullable<KitPlayerProps['preferredText']>
const PREF_EMPTY: Pref = {}
const PREF_LANGS_UNDEFINED: Pref = { languages: undefined }
const PREF_EN: Pref = { languages: ['en'] }
const PREF_EN_DESCRIPTIONS: Pref = { languages: ['en'], kinds: ['descriptions'] }
const PREF_OFF: Pref = { kinds: [] }
const onTracks = vi.fn<(t: Tracks) => void>()
const onState = vi.fn<(s: PlayerState) => void>()
const onCue = vi.fn<(c: Cue[]) => void>()
const onError = vi.fn<(e: PlayerError) => void>()
const ctx: { tracks: Tracks | null; state: PlayerState | null } = { tracks: null, state: null }
const renderControls = (c: { tracks: Tracks; state: PlayerState }) => {
  ctx.tracks = c.tracks
  ctx.state = c.state
  return null
}

let root: Root
let api: KitPlayerRef | null = null
const setApi = (r: KitPlayerRef | null) => {
  api = r
}

function render(uri: string, pref: Pref = PREF, errorHandler: KitPlayerProps['onError'] = onError) {
  act(() =>
    root.render(
      <KitPlayer
        ref={setApi}
        source={{ uri, type: 'hls' }}
        preferredText={pref}
        onTracks={onTracks}
        onState={onState}
        onCue={onCue}
        onError={errorHandler}
        renderControls={renderControls}
      />,
    ),
  )
}

const urls = (t: Tracks | null | undefined) => (t ? t.text.map((x) => x.url) : null)
const lastCueTexts = () => (onCue.mock.calls.at(-1)?.[0] ?? []).map((c) => c.text)
function seek(s: number) {
  act(() => api!.seek(s))
}
const selectText = (ids: string[]) => act(() => api!.selectText(ids))

beforeEach(() => {
  fake.current = Double
  latest = { props: null }
  textUrls = new Map()
  selectTextCalls.length = 0
  selectAudioCalls.length = 0
  setVolumeCalls.length = 0
  selectTextImpl = null
  onError.mockClear()
  onTracks.mockClear()
  onState.mockClear()
  onCue.mockClear()
  ctx.tracks = null
  ctx.state = null
  root = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => root.unmount())
})

describe('KitPlayer origin gate on onTracks (KIT-022)', () => {
  it('drops a report that arrives through a handler created for a source that is no longer live', () => {
    render('A')
    const loadA = beginLoad()
    render('B')
    loadA.complete(TRACKS_A)

    expect(onTracks).not.toHaveBeenCalled()
    expect(selectTextCalls).toEqual([])
    expect(selectAudioCalls).toEqual([])
    expect(ctx.tracks).toEqual({ audio: [], text: [] })
  })

  it("accepts the live source's own report afterwards and applies preferredText to its ids", () => {
    render('A')
    const loadA = beginLoad()
    render('B')
    const loadB = beginLoad() // dispatched while B is live; both loads in flight
    loadA.complete(TRACKS_A)
    loadB.complete(TRACKS_B)
    seek(2)

    expect(onTracks).toHaveBeenCalledTimes(1)
    expect(onTracks).toHaveBeenCalledWith(TRACKS_B)
    expect(selectTextCalls).toEqual([['1']])
    expect(urls(ctx.tracks)).toEqual(['B/0', 'B/1'])
    expect(lastCueTexts()).toEqual(['B/1'])
  })

  it("a stale report that lands after the live source's does not overwrite it", () => {
    render('A')
    const loadA = beginLoad()
    render('B')
    const loadB = beginLoad()
    loadB.complete(TRACKS_B)
    loadA.complete(TRACKS_A)
    seek(2)

    expect(onTracks.mock.calls).toEqual([[TRACKS_B]])
    expect(urls(ctx.tracks)).toEqual(['B/0', 'B/1'])
    expect(selectTextCalls).toEqual([['1']])
    expect(lastCueTexts()).toEqual(['B/1'])
  })

  it('a report for the live source through the current handler is accepted on first mount', () => {
    render('A')
    beginLoad().complete(TRACKS_A)
    seek(2)

    expect(onTracks.mock.calls).toEqual([[TRACKS_A]])
    expect(selectTextCalls).toEqual([['0']])
    expect(lastCueTexts()).toEqual(['A/0'])
  })

  it("drops a superseded load's onState: a report through a handler created for a source that is no longer live is not forwarded", () => {
    // KIT-015 / decision 0008 §3: the gate on `handleTracks` extends to `handleState`, for every state. The double
    // deliberately does not cancel superseded loads, so this tests the kit alone.
    render('A')
    const loadA = beginLoad()
    render('B')
    loadA.complete(TRACKS_A)

    expect(onState).not.toHaveBeenCalled()
    expect(ctx.state).toBe('idle')

    // B's own load, through B's handler: accepted. Catches a `handleState` that is not re-created per source.
    beginLoad().complete(TRACKS_B)
    expect(onState.mock.calls).toEqual([['ready']])
    expect(ctx.state).toBe('ready')
  })
})

describe('KitPlayer state gate: ready never overwrites playing (KIT-015 / KIT-028)', () => {
  it("ready does not overwrite playing: a load whose tracks arrive after playback began stays 'playing'", () => {
    render('A')
    const loadA = beginLoad()
    act(() => latest.props!.onState?.('playing'))
    loadA.complete(TRACKS_A)

    expect(onState.mock.calls).toEqual([['playing']])
    expect(ctx.state).toBe('playing')
    expect(onTracks.mock.calls).toEqual([[TRACKS_A]]) // the tracks still land; only `ready` is dropped
  })

  it("a source change forgets that the previous source was playing: the new source's ready is reported", () => {
    render('A')
    beginLoad().complete(TRACKS_A)
    act(() => latest.props!.onState?.('playing'))
    render('B')
    beginLoad().complete(TRACKS_B)

    expect(onState.mock.calls).toEqual([['ready'], ['playing'], ['ready']])
    expect(ctx.state).toBe('ready')
  })
})

describe('KitPlayer preferredText: an empty preference selects nothing, descriptions are opt-in (KIT-014, decision 0007)', () => {
  it('preferredText={{}} selects no text track: the adapter is not told and no cue is emitted, while preferredAudio is still applied and the report still reaches onTracks', () => {
    render('D', PREF_EMPTY)
    beginLoad().complete(TRACKS_D)
    seek(2)

    expect(selectTextCalls).toEqual([])
    expect(lastCueTexts()).toEqual([])
    expect(selectAudioCalls).toEqual(['a0'])
    expect(onTracks).toHaveBeenCalledWith(TRACKS_D)
    expect(urls(ctx.tracks)).toEqual(['D/0', 'D/1', 'D/2'])
  })

  it('preferredText={{ languages: undefined }} selects nothing either', () => {
    render('D', PREF_LANGS_UNDEFINED)
    beginLoad().complete(TRACKS_D)
    seek(2)

    expect(selectTextCalls).toEqual([])
    expect(lastCueTexts()).toEqual([])
  })

  it('{ kinds: [] } (captions off) selects nothing on the real component', () => {
    render('D', PREF_OFF)
    beginLoad().complete(TRACKS_D)
    seek(2)

    expect(selectTextCalls).toEqual([])
  })

  it("{ languages: ['en'] } selects the English subtitles and leaves the English descriptions track out", () => {
    render('D', PREF_EN)
    beginLoad().complete(TRACKS_D)
    seek(2)

    expect(selectTextCalls).toEqual([['0']])
    expect(lastCueTexts()).toEqual(['D/0'])
  })

  it("{ languages: ['en'], kinds: ['descriptions'] } selects only the English descriptions track", () => {
    render('D', PREF_EN_DESCRIPTIONS)
    beginLoad().complete(TRACKS_D)
    seek(2)

    expect(selectTextCalls).toEqual([['2']])
    expect(lastCueTexts()).toEqual(['D/2'])
  })

  it('selectText with a description id is honoured after an empty preference selected nothing', () => {
    render('D', PREF_EMPTY)
    beginLoad().complete(TRACKS_D)
    selectText(['2'])
    seek(2)

    expect(selectTextCalls).toEqual([['2']])
    expect(lastCueTexts()).toEqual(['D/2'])
  })

  it('selectText with several ids, one a description, delivers every track’s cues (multi-track unchanged)', () => {
    render('D', PREF_EN)
    beginLoad().complete(TRACKS_D)
    selectText(['0', '2'])
    seek(2)

    expect(lastCueTexts().sort()).toEqual(['D/0', 'D/2'])
  })

  it('a source switch re-applies an empty preference as nothing: the second source’s first onTracks selects no text either', () => {
    render('A', PREF_EMPTY)
    beginLoad().complete(TRACKS_A)
    render('D', PREF_EMPTY)
    beginLoad().complete(TRACKS_D)
    seek(2)

    expect(selectTextCalls).toEqual([])
    expect(selectAudioCalls).toEqual(['a0', 'a0'])
    expect(urls(ctx.tracks)).toEqual(['D/0', 'D/1', 'D/2'])
    expect(lastCueTexts()).toEqual([])
  })
})

describe('KitPlayer setVolume: clamped to [0, 1], NaN ignored, before any adapter sees it (DESC-006)', () => {
  it('forwards an in-range volume unchanged', () => {
    render('A')
    act(() => api!.setVolume(0.35))
    expect(setVolumeCalls).toEqual([0.35])
  })

  it('clamps out-of-range values and infinities', () => {
    render('A')
    act(() => {
      api!.setVolume(1.2)
      api!.setVolume(-0.1)
      api!.setVolume(Infinity)
      api!.setVolume(-Infinity)
    })
    expect(setVolumeCalls).toEqual([1, 0, 1, 0])
  })

  it('does not call the adapter for NaN', () => {
    render('A')
    act(() => api!.setVolume(Number.NaN))
    expect(setVolumeCalls).toEqual([])
  })

  it('is on the stable ref renderControls is handed, and works unbound', () => {
    render('A')
    const set = api!.setVolume
    act(() => set(0.5))
    expect(setVolumeCalls).toEqual([0.5])
  })
})

describe('KitPlayer onError origin gate and selectText safety net (KIT-016)', () => {
  const ERR: PlayerError = { code: 'TEXT_FETCH', message: 'Could not load text track 0', fatal: false }
  /** A promise the test settles by hand. */
  function controlled() {
    let reject!: (e: unknown) => void
    const promise = new Promise<void>((_, rej) => {
      reject = rej
    })
    return { promise, reject }
  }

  it('forwards an adapter error for the live source to onError', () => {
    render('A', PREF_EMPTY)
    act(() => latest.props!.onError?.(ERR))

    expect(onError.mock.calls).toEqual([[ERR]])
  })

  it('drops an error reported through a handler created for a source that is no longer live', () => {
    render('A', PREF_EMPTY)
    const reportA = latest.props!.onError
    render('B', PREF_EMPTY)
    act(() => reportA?.(ERR))

    expect(onError).not.toHaveBeenCalled()

    // B's own handler is accepted: catches a gate that drops everything.
    const errB: PlayerError = { ...ERR, message: 'Could not load text track 1' }
    act(() => latest.props!.onError?.(errB))
    expect(onError.mock.calls).toEqual([[errB]])
  })

  it('routes a rejected adapter selectText promise to onError as one non-fatal TEXT_FETCH', async () => {
    const boom = new Error('boom')
    const d = controlled()
    selectTextImpl = () => d.promise
    render('A', PREF_EMPTY)
    beginLoad().complete(TRACKS_A)
    selectText(['0'])
    await act(async () => {
      d.reject(boom)
      await Promise.resolve()
    })

    expect(onError.mock.calls).toEqual([[{ code: 'TEXT_FETCH', message: 'Could not load text tracks', fatal: false, cause: boom }]])
  })

  it('drops a selectText rejection that settles after the source changed', async () => {
    const d = controlled()
    selectTextImpl = () => d.promise
    render('A', PREF_EMPTY)
    beginLoad().complete(TRACKS_A)
    selectText(['0'])
    selectTextImpl = null
    render('B', PREF_EMPTY)
    await act(async () => {
      d.reject(new Error('late'))
      await Promise.resolve()
    })

    expect(onError).not.toHaveBeenCalled()
  })

  it('delivers to the latest onError prop: an inline onError passed on a later render receives the error', () => {
    const first = vi.fn<(e: PlayerError) => void>()
    const second = vi.fn<(e: PlayerError) => void>()
    render('A', PREF_EMPTY, (e) => first(e))
    const report = latest.props!.onError // as an in-flight selectText of this render would hold it
    render('A', PREF_EMPTY, (e) => second(e)) // same source, a new inline identity
    act(() => report?.(ERR))

    expect(first).not.toHaveBeenCalled()
    expect(second.mock.calls).toEqual([[ERR]])
  })

  it('does not leave an unhandled rejection when onError throws', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (r: unknown) => unhandled.push(r)
    process.on('unhandledRejection', onUnhandled)
    try {
      // The web adapter's shape: an async selectText that reports through the onError it was handed. The app's
      // onError throws, so the adapter's promise rejects and the safety net reports again — that must not throw.
      selectTextImpl = async (_ids, props) => {
        props.onError?.(ERR)
      }
      const thrower = vi.fn<(e: PlayerError) => void>(() => {
        throw new Error('app onError threw')
      })
      render('A', PREF_EMPTY, thrower)
      beginLoad().complete(TRACKS_A)
      selectText(['0'])
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })
      await new Promise((r) => setTimeout(r, 10))

      expect(thrower).toHaveBeenCalled()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('does not report an error twice when the adapter both reports TEXT_FETCH and resolves', async () => {
    selectTextImpl = (ids, props) => {
      props.onError?.({ ...ERR, message: `Could not load text track ${ids[0]}` })
      return Promise.resolve()
    }
    render('A', PREF_EMPTY)
    beginLoad().complete(TRACKS_A)
    selectText(['0'])
    await act(async () => {
      await Promise.resolve()
    })

    expect(onError.mock.calls).toEqual([[ERR]])
  })
})

describe('KitPlayer latest-props callbacks and the origin gates (KIT-025)', () => {
  /** KitPlayer with per-render (inline) app callbacks, as an app that writes `onState={(s) => …}` passes them. */
  function renderInline(uri: string, cbs: Pick<KitPlayerProps, 'onState' | 'onPosition' | 'onTracks'>) {
    act(() =>
      root.render(
        <KitPlayer ref={setApi} source={{ uri, type: 'hls' }} preferredText={PREF_EMPTY} onError={onError} renderControls={renderControls} {...cbs} />,
      ),
    )
  }

  it('a state handler captured before a same-source re-render delivers to the latest app onState', () => {
    const first = vi.fn<(s: PlayerState) => void>()
    const second = vi.fn<(s: PlayerState) => void>()
    renderInline('A', { onState: (s) => first(s) })
    const report = latest.props!.onState // as the web adapter's per-load listener holds it
    renderInline('A', { onState: (s) => second(s) })
    act(() => report?.('paused'))

    expect(first).not.toHaveBeenCalled()
    expect(second.mock.calls).toEqual([['paused']])
    expect(ctx.state).toBe('paused')
  })

  it('a position handler captured before a re-render delivers to the latest app onPosition', () => {
    const first = vi.fn<(s: number) => void>()
    const second = vi.fn<(s: number) => void>()
    renderInline('A', { onPosition: (s) => first(s) })
    const report = latest.props!.onPosition
    renderInline('A', { onPosition: (s) => second(s) })
    act(() => report?.(3))

    expect(first).not.toHaveBeenCalled()
    expect(second.mock.calls).toEqual([[3]])
  })

  it('the same captured state handler is still refused after a source switch: the ref does not bypass the gate', () => {
    const first = vi.fn<(s: PlayerState) => void>()
    const second = vi.fn<(s: PlayerState) => void>()
    const third = vi.fn<(s: PlayerState) => void>()
    renderInline('A', { onState: (s) => first(s) })
    const reportA = latest.props!.onState
    renderInline('A', { onState: (s) => second(s) })
    renderInline('B', { onState: (s) => third(s) })
    act(() => reportA?.('paused'))

    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(third).not.toHaveBeenCalled()
    expect(ctx.state).toBe('idle')

    // B's own handler is accepted: catches a gate that drops everything.
    act(() => latest.props!.onState?.('paused'))
    expect(third.mock.calls).toEqual([['paused']])
  })

  it('the state, tracks and position handlers keep their identity across a same-source re-render with new inline callbacks', () => {
    renderInline('A', { onState: () => {}, onPosition: () => {}, onTracks: () => {} })
    const before = { s: latest.props!.onState, p: latest.props!.onPosition, t: latest.props!.onTracks, e: latest.props!.onError }
    renderInline('A', { onState: () => {}, onPosition: () => {}, onTracks: () => {} })
    const after = { s: latest.props!.onState, p: latest.props!.onPosition, t: latest.props!.onTracks, e: latest.props!.onError }

    expect(after.s).toBe(before.s)
    expect(after.p).toBe(before.p)
    expect(after.t).toBe(before.t)
    expect(after.e).toBe(before.e)
    // …and change on a source switch (the per-uri gates), except position, which has no gate.
    renderInline('B', { onState: () => {}, onPosition: () => {}, onTracks: () => {} })
    expect(latest.props!.onState).not.toBe(before.s)
    expect(latest.props!.onTracks).not.toBe(before.t)
    expect(latest.props!.onPosition).toBe(before.p)
  })

  it("ready is dropped after the live load reported error; the next source's ready is reported", () => {
    render('A')
    const loadA = beginLoad()
    act(() => latest.props!.onState?.('error'))
    loadA.complete(TRACKS_A)

    expect(onState.mock.calls).toEqual([['error']])
    expect(ctx.state).toBe('error')
    expect(onTracks.mock.calls).toEqual([[TRACKS_A]]) // the tracks are true; only `ready` is dropped

    render('B')
    beginLoad().complete(TRACKS_B)
    expect(onState.mock.calls).toEqual([['error'], ['ready']])
    expect(ctx.state).toBe('ready')
  })
})
