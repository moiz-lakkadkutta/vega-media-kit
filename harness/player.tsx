import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { KitPlayer } from '../src/player'
import type { KitPlayerRef } from '../src/player'
import { CueOverlay } from '../src/cues'
import type { Cue, PlayerState, Tracks } from '../src/core'

/** KitPlayer + the real WebAdapter + CueOverlay on top; specs drive it through `window.__kit` (plan §4.4). */
;(globalThis as { KIT_FORCE_ADAPTER?: string }).KIT_FORCE_ADAPTER = 'web'

type Ev = { type: 'state'; state: PlayerState } | { type: 'tracks'; tracks: Tracks } | { type: 'cue'; ids: string[] }
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
}
window.__kit = kit
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
        renderControls={(ctx) => {
          refs.add(ctx.ref)
          renders++
          return null
        }}
        testID="kit-video"
      />
      <CueOverlay active={cues} primaryTrackId={primary} scale={1} testID="overlay" />
    </>
  )
}
createRoot(document.getElementById('stage')!).render(<App />)
