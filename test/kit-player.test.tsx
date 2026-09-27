// @vitest-environment jsdom
/**
 * Guard of record for KIT-022 (docs/plans/KIT-022-tracks-origin-gate.md §7.1): the real `KitPlayer` — its
 * scheduler, `selectText`, source-change reset and `handleTracks` — rendered under jsdom with a *platform
 * double* in place of the adapter. The double follows the Fire OS adapter's handler contract
 * (`src/player/adapters/fireos.tsx`): `onLoad` publishes through the props it closed over when the native
 * event was dispatched, across its manifest await, and has no cancel (KIT-023). It re-implements no kit logic.
 */
import { act, forwardRef, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Cue, PlayerState, Tracks } from '../src/core'
import type { AdapterProps, KitPlayerRef } from '../src/player/types'

const fake = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }))
vi.mock('../src/player/adapters', () => ({ resolveAdapter: () => fake.current }))

import { KitPlayer } from '../src/player/KitPlayer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---- the platform double (Fire OS contract) --------------------------------------------------------------

/** The latest render's props — what `onLoad`'s `useCallback(…, [props])` closes over (fireos.tsx:69-88). */
let latest: { props: AdapterProps | null } = { props: null }
/** fireos.tsx:26 — overwritten by every *completed* load (:78) before it publishes (:84). */
let textUrls = new Map<string, string>()
const selectTextCalls: string[][] = []
const selectAudioCalls: string[] = []

/** A one-cue VTT whose text is the playlist url, so the cue on screen says which source's bytes landed. */
const vttFor = (url: string) => `WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n${url}\n`

const Double = forwardRef<KitPlayerRef, AdapterProps>(function Double(props, ref) {
  latest.props = props
  // Re-created every render (no deps), as the real adapters' handles are (fireos.tsx:36-49): `selectText`
  // delivers through *this render's* `onTextTrackData` — the handler live when `selectText` is called.
  useImperativeHandle(ref, () => ({
    play: () => {},
    pause: () => {},
    seek: () => {},
    setRate: () => {},
    selectAudio: (id: string) => {
      selectAudioCalls.push(id)
    },
    selectText: (ids: string[]) => {
      selectTextCalls.push([...ids])
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

// Load-bearing: module-level, stable identities. An inline `preferredText={{…}}` re-creates `handleTracks` on
// every render through that dep and masks a missing `sourceUri` dep (plan §7.4 M2).
const PREF = { languages: ['de'] }
const onTracks = vi.fn<(t: Tracks) => void>()
const onState = vi.fn<(s: PlayerState) => void>()
const onCue = vi.fn<(c: Cue[]) => void>()
const ctx: { tracks: Tracks | null } = { tracks: null }
const renderControls = (c: { tracks: Tracks }) => {
  ctx.tracks = c.tracks
  return null
}

let root: Root
let api: KitPlayerRef | null = null
const setApi = (r: KitPlayerRef | null) => {
  api = r
}

function render(uri: string) {
  act(() =>
    root.render(
      <KitPlayer
        ref={setApi}
        source={{ uri, type: 'hls' }}
        preferredText={PREF}
        onTracks={onTracks}
        onState={onState}
        onCue={onCue}
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

beforeEach(() => {
  fake.current = Double
  latest = { props: null }
  textUrls = new Map()
  selectTextCalls.length = 0
  selectAudioCalls.length = 0
  onTracks.mockClear()
  onState.mockClear()
  onCue.mockClear()
  ctx.tracks = null
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

  it("pins: a superseded load's onState('ready') still reaches the app — KIT-015 decides", () => {
    // PINNED, NOT ENDORSED (plan §5): `handleState` is not source-scoped. KIT-015 decides whether the gate
    // extends to `loading`/`ready` or KIT-023's adapter-side cancel removes this; either way this goes red.
    render('A')
    const loadA = beginLoad()
    render('B')
    loadA.complete(TRACKS_A)

    expect(onState.mock.calls.map(([s]) => s)).toEqual(['ready'])
  })
})
