import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { KitPlayer } from '../src/player'
import type { KitPlayerRef } from '../src/player'
import { CueOverlay } from '../src/cues'
import type { Cue, PlayerError, PlayerState, Tracks } from '../src/core'

/** KitPlayer + the real WebAdapter + CueOverlay on top; specs drive it through `window.__kit` (plan §4.4). */
;(globalThis as { KIT_FORCE_ADAPTER?: string }).KIT_FORCE_ADAPTER = 'web'

type Ev =
  | { type: 'state'; state: PlayerState }
  | { type: 'tracks'; tracks: Tracks }
  | { type: 'cue'; ids: string[] }
  | { type: 'error'; code: string; message: string; fatal: boolean }
declare global {
  interface Window {
    __kit: {
      ref: KitPlayerRef | null
      events: Ev[]
      active: Cue[]
      /** ref.seek(t) — synchronous scheduler.update — and the active set it produced. */
      seek(t: number): Cue[]
      /** seek(t), then the bottom-area boxes as the overlay committed them in that same task (spec 14). */
      seekSnapshot(t: number): { ids: string[]; boxes: { text: string; fontSize: string; top: number }[] }
      play(): void
      /** Re-render KitPlayer with a new `source.uri` (same callbacks, same preferredText); synchronous. */
      setSource(uri: string): void
      /** Re-render App (and so KitPlayer) with nothing else changed; synchronous. Under `?inlineCallbacks=1` every
       *  render hands KitPlayer fresh `onCue`/`onPosition` identities (KIT-012). */
      rerender(): void
      /** Distinct `ctx.ref` objects `renderControls` has been handed so far (KIT-012: must stay 1). */
      refIdentities(): number
      /** KitPlayer renders so far, counted in `renderControls`. */
      renders(): number
      /** `onPosition` calls so far — one per `timeupdate` while playing. */
      positionTicks: number
      /** `?hold=`: the held response has arrived and is waiting to be handed over (KIT-022 §7.2). */
      heldReady(): boolean
      /** `?hold=`: hand the held response to its caller; every hop after this is a microtask. */
      releaseHeld(): void
      /** Re-render with a new `source.uri` from a timer — a DefaultLane update, not `flushSync` — and arm App's
       *  layout effect to call `releaseHeld()` inside that switch's commit (after KitPlayer's reset). */
      setSourceDeferred(uri: string): void
      /** `<video src>` when the held response was released and when it was handed over. */
      diag: { releasedAt: { videoSrc: string | null } | null; handover: { rendered: string; videoSrc: string | null } | null }
      /** The state KitPlayer last handed to renderControls (spec 26). */
      state(): PlayerState
    }
  }
}
const q = new URLSearchParams(location.search)
// Extension-less on purpose: Chromium sniffs `.m3u8` in a media URL before demuxing, so the route-served
// WebM would never play at `/stream/master.m3u8` (plan §13). The adapter parses the body, not the extension.
const src = q.get('src') ?? '/stream/master'
const textUrls = q.get('textUrls') // JSON map → deprecated header (header-bridge spec only)
const preferred = q.get('preferred') // JSON → preferredText
const primary = q.get('primary') ?? '0'
// KIT-012: pass `onCue`/`onPosition` as inline arrows (a new identity every render) instead of the module-scope
// constants below, the way a README-naive app would. The kit must not rebuild its scheduler for that.
const inlineCallbacks = q.get('inlineCallbacks') === '1'
// KIT-022 §7.2: `?hold=<encodeURIComponent(pathname)>` — the first `fetch` of that path is made eagerly but handed
// to the caller only on `releaseHeld()`. Encoded, or routeStream's `**/stream/**` glob swallows the page itself.
const hold = q.get('hold')

const kit: Window['__kit'] = {
  ref: null,
  events: [],
  active: [],
  seek: (t) => {
    kit.ref?.seek(t)
    return kit.active
  },
  seekSnapshot: (t) => {
    kit.ref?.seek(t) // onCue → flushSync → the overlay DOM below is already committed
    const area = document.querySelector('[data-testid="overlay"]')!.children[1]!
    return {
      ids: kit.active.map((c) => `${c.trackId}:${c.id}`),
      boxes: [...area.children].map((el) => ({
        text: el.textContent ?? '',
        fontSize: getComputedStyle(el.querySelector('div[dir]')!).fontSize,
        top: el.getBoundingClientRect().top,
      })),
    }
  },
  play: () => {
    const v = document.querySelector('video')
    if (v) v.muted = true
    kit.ref?.play()
  },
  // flushSync so the kit's layout-effect reset (and its onCue([])) has run by the time evaluate() returns.
  setSource: (uri) => flushSync(() => setSrcState(uri)),
  rerender: () => flushSync(() => setBumpState((n) => n + 1)),
  refIdentities: () => refs.size,
  renders: () => renders,
  positionTicks: 0,
  heldReady: () => heldArrived,
  releaseHeld: () => releaseHeldFn(),
  setSourceDeferred: (uri) => {
    deferredTarget = uri
    setTimeout(() => setSrcState(uri), 0) // no flushSync, no event: React gives this update DefaultLane
  },
  diag: { releasedAt: null, handover: null },
  state: () => kitState,
}
window.__kit = kit

const videoSrc = () => document.querySelector('video')?.getAttribute('src') ?? null
let renderedUri = src
let deferredTarget: string | null = null
let heldArrived = false
let releaseHeldFn: () => void = () => {}
if (hold) {
  // Installed only under `?hold=`; a single first-match gate, every other request passes straight through.
  const realFetch = window.fetch.bind(window)
  let armed = true
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!armed || new URL(href, location.href).pathname !== hold) return realFetch(input, init)
    armed = false
    return realFetch(input, init).then(async (res) => {
      const body = await res.text()
      // Duck-typed: `fetchHlsMaster` takes the structural `HlsFetch`, so no Response has to be rebuilt.
      const duck = { ok: res.ok, status: res.status, url: res.url, text: () => Promise.resolve(body) }
      await new Promise<void>((resolve) => {
        releaseHeldFn = resolve
        heldArrived = true
      })
      kit.diag.handover = { rendered: renderedUri, videoSrc: videoSrc() }
      return duck
    })
  }) as typeof window.fetch
}
const log = (e: Ev) => {
  kit.events.push(e)
  const pre = document.getElementById('events')
  if (pre) pre.textContent = JSON.stringify(kit.events, null, 1)
}

// Stable callbacks (module scope) by default; `?inlineCallbacks=1` wraps onCue/onPosition in per-render arrows
// (specs 19–20) to prove the kit no longer rebuilds its scheduler or its ref for an inline callback (KIT-012).
let setCuesState: (c: Cue[]) => void = () => {}
let setSrcState: (uri: string) => void = () => {}
let setBumpState: (f: (n: number) => number) => void = () => {}
const refs = new Set<KitPlayerRef>()
let renders = 0
let kitState: PlayerState = 'idle'
const onCue = (active: Cue[]) => {
  kit.active = active
  log({ type: 'cue', ids: active.map((c) => `${c.trackId}:${c.id}`) })
  // A source change emits onCue([]) from inside KitPlayer's layout effect, where flushSync is not allowed
  // (KIT-011 plan R2). Nothing reads the overlay DOM synchronously for an empty set, so a plain setState
  // is enough there; non-empty sets keep flushSync for seekSnapshot (spec 14).
  if (active.length === 0) setCuesState(active)
  else flushSync(() => setCuesState(active))
}
const onTracks = (t: Tracks) => log({ type: 'tracks', tracks: t })
const onState = (s: PlayerState) => log({ type: 'state', state: s })
/** KIT-016: `cause` is left out — an Error does not survive `page.evaluate` serialisation. */
const onError = (e: PlayerError) => log({ type: 'error', code: e.code, message: e.message, fatal: e.fatal })
const onPosition = (_s: number) => {
  kit.positionTicks++
}

function App() {
  const [cues, setCues] = useState<Cue[]>([])
  const [uri, setUri] = useState(src)
  const [, setBump] = useState(0)
  setCuesState = setCues
  setSrcState = setUri
  setBumpState = setBump
  renderedUri = uri
  // Parent layout effects run after the child's, so this runs inside the switch's commit after KitPlayer's
  // reset and before the adapter's passive effect — unless something flushed that effect already (the pin).
  useLayoutEffect(() => {
    if (deferredTarget === null || uri !== deferredTarget) return
    deferredTarget = null
    kit.diag.releasedAt = { videoSrc: videoSrc() }
    kit.releaseHeld()
  }, [uri])
  return (
    <>
      <KitPlayer
        ref={(r) => {
          kit.ref = r
        }}
        source={{ uri, type: 'hls', ...(textUrls ? { headers: { 'x-kit-text-urls': textUrls } } : {}) }}
        preferredText={preferred ? JSON.parse(preferred) : undefined}
        onCue={inlineCallbacks ? (c) => onCue(c) : onCue}
        onPosition={inlineCallbacks ? (s) => onPosition(s) : onPosition}
        onTracks={onTracks}
        onState={onState}
        onError={onError}
        renderControls={(ctx) => {
          refs.add(ctx.ref)
          renders++
          kitState = ctx.state
          return null
        }}
        testID="kit-video"
      />
      <CueOverlay active={cues} primaryTrackId={primary} scale={1} testID="overlay" />
    </>
  )
}
createRoot(document.getElementById('stage')!).render(<App />)
