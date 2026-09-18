import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CueOverlay } from '../src/cues'
import type { CueOverlayProps } from '../src/cues'
import type { Cue } from '../src/core'

/** Overlay-only page: no video, no scheduler. Specs inject cues through `window.__setCues` (plan §4.3). */
type Extra = Omit<CueOverlayProps, 'active' | 'scale' | 'testID'>
declare global {
  interface Window {
    __setCues(cues: Cue[], props?: Extra): void
    __focusCalls: [string, number][]
  }
}
window.__focusCalls = []

function App() {
  const [s, set] = useState<{ cues: Cue[]; props: Extra }>({ cues: [], props: {} })
  // flushSync: the DOM is committed before page.evaluate() returns, so a spec can measure right away.
  window.__setCues = (cues, props = {}) => flushSync(() => set({ cues, props }))
  const sel = s.props.selectable
    ? { ...s.props.selectable, onFocusWord: (w: string, i: number) => { window.__focusCalls.push([w, i]) } }
    : undefined
  return <CueOverlay active={s.cues} scale={1} testID="overlay" {...s.props} selectable={sel} />
}
createRoot(document.getElementById('stage')!).render(<App />)
