// @vitest-environment jsdom
/**
 * KIT-034 (docs/plans/KIT-034-error-state.md §6.2): the REAL `VegaAdapter`, rendered directly with spies (as
 * `vega-adapter-tracks.test.tsx`; the kit's gates are covered elsewhere), with both Vega peers replaced through the
 * `adapters/w3c` seam. Vega is experimental (decision 0001): these pin the adapter's error discipline against a fake,
 * not Shaka-on-w3cmedia behaviour.
 */
import { act, forwardRef, type Ref } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PlayerError, PlayerState, Tracks } from '../src/core'

type Listener = (e: Event) => void
type ShakaErr = { code: number; severity?: number; message?: string }

const rig = vi.hoisted(() => ({ w3c: null as unknown, shaka: null as unknown }))
vi.mock('react-native', () => ({ Platform: { OS: 'kepler' } }))
vi.mock('../src/player/adapters/w3c', () => ({ requireW3cMedia: () => rig.w3c, requireShaka: () => rig.shaka }))

import { VegaAdapter } from '../src/player/adapters/vega'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A = 'https://cdn.example/a/master.m3u8'
const B = 'https://cdn.example/b/master.m3u8'
const CRITICAL = 2
const RECOVERABLE = 1
const BAD_HTTP: ShakaErr = { code: 1001, severity: CRITICAL, message: 'BAD_HTTP_STATUS' }

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** shaka.Player as the adapter uses it. attach/load settle — or load rejects — when the test says so. */
class FakePlayer {
  static instances: FakePlayer[] = []
  readonly attached = deferred()
  readonly loaded = deferred()
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
  load() {
    return this.loaded.promise
  }
  getVariantTracks() {
    return [{ id: 1, language: 'en', active: true }]
  }
  getTextTracks() {
    return []
  }
  destroy() {
    return Promise.resolve()
  }
  /** Dispatch a Shaka event (a `FakeEvent` with `detail`) to this instance's listeners. */
  fire(type: string, detail?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(new CustomEvent(type, { detail }))
  }
}

rig.shaka = { Player: FakePlayer }
rig.w3c = {
  VideoPlayer: forwardRef(function VideoPlayer(_props: Record<string, unknown>, ref: Ref<HTMLVideoElement>) {
    return <video ref={ref} />
  }),
}

const tick = () => new Promise((r) => setTimeout(r, 0))
let root: Root
const handlers = {
  onTracks: vi.fn<(t: Tracks) => void>(),
  onState: vi.fn<(s: PlayerState) => void>(),
  onError: vi.fn<(e: PlayerError) => void>(),
}
const render = (uri: string) => act(() => root.render(<VegaAdapter source={{ uri, type: 'hls' }} {...handlers} />))
const player = (i: number) => FakePlayer.instances[i]!
const states = () => handlers.onState.mock.calls.map(([s]) => s)
const errors = () => handlers.onError.mock.calls.map(([e]) => [e.code, e.fatal])
/** `onError` and `onState` interleaved in call order. */
const log = () =>
  [
    ...handlers.onError.mock.calls.map(([e], i) => [handlers.onError.mock.invocationCallOrder[i]!, ['error', e.code]] as const),
    ...handlers.onState.mock.calls.map(([s], i) => [handlers.onState.mock.invocationCallOrder[i]!, ['state', s]] as const),
  ]
    .sort((a, b) => a[0] - b[0])
    .map(([, entry]) => entry)
async function attach(i: number) {
  await act(async () => {
    player(i).attached.resolve()
    await tick()
  })
}
async function rejectLoad(i: number, e: unknown) {
  await act(async () => {
    player(i).loaded.reject(e)
    await tick()
  })
}
const fire = (i: number, type: string, detail?: unknown) => act(() => player(i).fire(type, detail))

beforeEach(() => {
  FakePlayer.instances = []
  for (const h of Object.values(handlers)) h.mockClear()
  root = createRoot(document.createElement('div'))
})
afterEach(() => {
  act(() => root.unmount())
})

describe('VegaAdapter — fatal errors report error (KIT-034)', () => {
  it('a CRITICAL Shaka error reports a fatal SHAKA_<code> through onError, then onState(error)', async () => {
    render(A)
    await attach(0)
    fire(0, 'error', BAD_HTTP)

    expect(log()).toEqual([['state', 'loading'], ['error', 'SHAKA_1001'], ['state', 'error']])
    expect(handlers.onError.mock.calls[0]![0]).toEqual({ code: 'SHAKA_1001', message: 'BAD_HTTP_STATUS', fatal: true, cause: BAD_HTTP })
  })

  it('a RECOVERABLE Shaka error reports a non-fatal SHAKA_<code> and no state', async () => {
    render(A)
    await attach(0)
    fire(0, 'error', { code: 1002, severity: RECOVERABLE })

    expect(errors()).toEqual([['SHAKA_1002', false]])
    expect(states()).toEqual(['loading'])
  })

  it('a rejected load() reports a fatal SHAKA_<code> then error, and no onTracks or ready', async () => {
    render(A)
    await attach(0)
    await rejectLoad(0, { code: 4000, severity: RECOVERABLE }) // a failed load is fatal whatever its severity

    expect(log()).toEqual([['state', 'loading'], ['error', 'SHAKA_4000'], ['state', 'error']])
    expect(errors()).toEqual([['SHAKA_4000', true]])
    expect(handlers.onTracks).not.toHaveBeenCalled()
  })

  it('a load() rejected with LOAD_INTERRUPTED or OPERATION_ABORTED reports nothing', async () => {
    render(A)
    await attach(0)
    await rejectLoad(0, { code: 7000, severity: CRITICAL })
    render(B)
    await attach(1)
    await rejectLoad(1, { code: 7001, severity: CRITICAL })

    expect(handlers.onError).not.toHaveBeenCalled()
    expect(states()).toEqual(['loading', 'loading'])
  })

  it('a load failure reported by both the error event and the load() rejection is reported once', async () => {
    render(A)
    await attach(0)
    fire(0, 'error', BAD_HTTP)
    await rejectLoad(0, BAD_HTTP)
    fire(0, 'error', BAD_HTTP) // and a second CRITICAL event for the same load

    expect(errors()).toEqual([['SHAKA_1001', true]])
    expect(states()).toEqual(['loading', 'error'])
  })

  it("a superseded player's error or load rejection after a source switch reports nothing", async () => {
    render(A)
    await attach(0)
    render(B) // A's cleanup runs; its load is still pending
    fire(0, 'error', BAD_HTTP)
    await rejectLoad(0, BAD_HTTP)

    expect(handlers.onError).not.toHaveBeenCalled()
    expect(states()).toEqual(['loading'])
  })

  it('no unhandled rejection when load() rejects', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      render(A)
      await attach(0)
      await rejectLoad(0, BAD_HTTP)
      await act(async () => {
        await tick()
        await tick()
      })
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(unhandled).toEqual([])
    expect(errors()).toEqual([['SHAKA_1001', true]])
  })
})
