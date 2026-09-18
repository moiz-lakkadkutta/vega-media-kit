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
}
window.__kit = kit
const log = (e: Ev) => {
  kit.events.push(e)
  const pre = document.getElementById('events')
  if (pre) pre.textContent = JSON.stringify(kit.events, null, 1)
}

// Stable callbacks (module scope): an inline onCue would rebuild the scheduler every render (KIT-012).
let setCuesState: (c: Cue[]) => void = () => {}
const onCue = (active: Cue[]) => {
  kit.active = active
  log({ type: 'cue', ids: active.map((c) => `${c.trackId}:${c.id}`) })
  flushSync(() => setCuesState(active))
}
const onTracks = (t: Tracks) => log({ type: 'tracks', tracks: t })
const onState = (s: PlayerState) => log({ type: 'state', state: s })

function App() {
  const [cues, setCues] = useState<Cue[]>([])
  setCuesState = setCues
  return (
    <>
      <KitPlayer
        ref={(r) => {
          kit.ref = r
        }}
        source={{ uri: src, type: 'hls', ...(textUrls ? { headers: { 'x-kit-text-urls': textUrls } } : {}) }}
        preferredText={preferred ? JSON.parse(preferred) : undefined}
        onCue={onCue}
        onTracks={onTracks}
        onState={onState}
        testID="kit-video"
      />
      <CueOverlay active={cues} primaryTrackId={primary} scale={1} testID="overlay" />
    </>
  )
}
createRoot(document.getElementById('stage')!).render(<App />)
