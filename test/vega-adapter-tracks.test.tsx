// @vitest-environment jsdom
/**
 * KIT-020 (docs/plans/KIT-020-adapter-tracks-reset.md §5.3): the REAL `VegaAdapter`, rendered directly (not through
 * KitPlayer, whose `getTracks` gate would mask the adapter's own reset), with both Vega peers replaced through the
 * `adapters/w3c` seam. Vega is experimental (decision 0001): these pin the adapter's ref discipline, not Shaka's
 * behaviour — KIT-010 re-derives them on the VVD and must keep all four behaviours (plan §6).
 */
import { act, forwardRef, type Ref } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Tracks } from '../src/core'
import type { KitPlayerRef } from '../src/player/types'

type Listener = (e: Event) => void
type Fixture = { variants: unknown[]; text: unknown[] }

const rig = vi.hoisted(() => ({ w3c: null as unknown, shaka: null as unknown }))
vi.mock('react-native', () => ({ Platform: { OS: 'kepler' } }))
vi.mock('../src/player/adapters/w3c', () => ({ requireW3cMedia: () => rig.w3c, requireShaka: () => rig.shaka }))

import { VegaAdapter } from '../src/player/adapters/vega'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---- the peers -------------------------------------------------------------------------------------------

const A = 'https://cdn.example/a/master.m3u8'
const B = 'https://cdn.example/b/master.m3u8'
// `fromShakaVariants` / `fromShakaText` input shapes.
const FIXTURES: Record<string, Fixture> = {
  [A]: { variants: [{ id: 1, language: 'en', active: true }], text: [{ id: 1, language: 'en', kind: 'subtitle', active: false }] },
  [B]: { variants: [{ id: 3, language: 'de', active: true }], text: [{ id: 7, language: 'de', kind: 'subtitle', active: false }] },
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/** shaka.Player as the adapter uses it. Every instance is recorded; attach/load settle when the test says so. */
class FakePlayer {
  static instances: FakePlayer[] = []
  readonly attached = deferred()
  readonly loaded = deferred()
  private uri: string | null = null
  private isLoaded = false
  private readonly listeners = new Map<string, Listener[]>()
  constructor() {
    FakePlayer.instances.push(this)
  }
  attach() {
    return this.attached.promise
  }
  configure() {
    return true
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  async load(uri: string) {
    this.uri = uri
    await this.loaded.promise
    this.isLoaded = true
  }
  getVariantTracks() {
    return this.isLoaded && this.uri ? FIXTURES[this.uri]!.variants : []
  }
  getTextTracks() {
    return this.isLoaded && this.uri ? FIXTURES[this.uri]!.text : []
  }
  selectVariantTrack() {}
  selectTextTrack() {}
  setTextTrackVisibility() {}
  destroy() {
    return Promise.resolve()
  }
  /** Dispatch a Shaka event to this instance's listeners. */
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn(new Event(type))
  }
}

rig.shaka = { Player: FakePlayer }
rig.w3c = {
  VideoPlayer: forwardRef(function VideoPlayer(_props: Record<string, unknown>, ref: Ref<HTMLVideoElement>) {
    return <video ref={ref} />
  }),
}

// ---- the page --------------------------------------------------------------------------------------------

const EMPTY: Tracks = { audio: [], text: [] }
const tick = () => new Promise((r) => setTimeout(r, 0))
let root: Root
let adapter: KitPlayerRef | null = null
const setAdapter = (r: KitPlayerRef | null) => {
  adapter = r
}
const handlers = { onTracks: vi.fn<(t: Tracks) => void>(), onState: vi.fn(), onError: vi.fn(), onPosition: vi.fn() }
const render = (uri: string) => act(() => root.render(<VegaAdapter ref={setAdapter} source={{ uri, type: 'hls' }} {...handlers} />))
const player = (i: number) => FakePlayer.instances[i]!
/** Let player `i`'s attach and load settle (the adapter's continuation runs). */
async function settle(i: number) {
  await act(async () => {
    player(i).attached.resolve()
    player(i).loaded.resolve()
    await tick()
  })
}
const langs = (t: Tracks) => [t.audio.map((a) => a.language), t.text.map((x) => x.language)]

beforeEach(() => {
  FakePlayer.instances = []
  for (const h of Object.values(handlers)) h.mockClear()
  root = createRoot(document.createElement('div'))
})
afterEach(() => {
  act(() => root.unmount())
})

describe('VegaAdapter: tracks never outlive their source (KIT-020; experimental, mocked Shaka)', () => {
  it('getTracks() is empty right after source.uri changes, before the new player has attached', async () => {
    render(A)
    await settle(0)
    expect(langs(adapter!.getTracks())).toEqual([['en'], ['en']]) // sanity: A's list is in

    render(B)
    expect(FakePlayer.instances).toHaveLength(2) // B's player exists; its attach is still pending
    expect(adapter!.getTracks()).toEqual(EMPTY)
  })

  it("a superseded load whose attach/load settle after the switch does not put the previous source's tracks back", async () => {
    render(A)
    render(B) // A's attach and load are still pending
    await settle(0)

    expect(adapter!.getTracks()).toEqual(EMPTY) // the new player's pre-load lists, never A's
  })

  it("a trackschanged from the previous source's player after the switch does not put its tracks back", async () => {
    render(A)
    await settle(0)
    render(B)
    act(() => player(0).fire('trackschanged'))

    expect(adapter!.getTracks()).toEqual(EMPTY)
  })

  it("the new source's tracks are what getTracks() answers once its load publishes", async () => {
    render(A)
    await settle(0)
    render(B)
    await settle(1)

    expect(langs(adapter!.getTracks())).toEqual([['de'], ['de']])
    expect(adapter!.getTracks().text.map((t) => t.id)).toEqual(['7'])
    expect(handlers.onTracks.mock.calls.at(-1)![0]).toEqual(adapter!.getTracks())
  })
})
