// @vitest-environment jsdom
/**
 * KIT-017 §5.1: the real `CueOverlay`, rendered through react-native-web under jsdom (the harness aliases
 * `react-native` the same way). Pins the two-line clamp on every cue (selectable included), the ARIA-style
 * props (`aria-label` on words, no role on cue text) and `style.pointerEvents` on the root.
 * The Playwright harness (specs 10–11) is the guard of record for layout and the hit test.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Cue } from '../src/core'
import { CueOverlay, type CueOverlayProps } from '../src/cues'
// @ts-expect-error -- react-native-web ships no type declarations; the harness aliases it the same way
vi.mock('react-native', () => import('react-native-web'))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Installed once and never cleared: RNW's warnOnce fires once per module instance, so only the first render
// in this file can show a deprecation warning (spec 6 reads every call made so far).
const warn = vi.spyOn(console, 'warn')

const cue = (id: string, text: string, extra: Partial<Cue> = {}): Cue => ({ trackId: 'de', id, start: 0, end: 5, text, ...extra })
const CUE3L = cue('l3', 'Line one of three\nLine two of three\nLine three is clipped')
const WORDS = cue('s1', 'Hello brave new world')
const DE = cue('d1', 'Hallo Welt')
const EN = cue('e1', 'Hello world', { trackId: 'en' })
const TOP3 = cue('t3', 'a\nb\nc', { line: 'top' })

let root: Root | undefined
let host: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
})

function render(props: Omit<CueOverlayProps, 'scale' | 'testID'>) {
  if (!root) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  act(() => root!.render(<CueOverlay scale={1} testID="overlay" {...props} />))
  return host.querySelector<HTMLElement>('[data-testid="overlay"]')!
}

const cueRoots = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('div[dir="auto"]'))
const clamps = (el: HTMLElement) => cueRoots(el).map((c) => c.style.webkitLineClamp)
const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('span[aria-label]')).map((s) => s.getAttribute('aria-label'))

describe('CueOverlay (react-native-web)', () => {
  it('a selectable primary cue is clamped to two lines, like a non-selectable one', () => {
    expect(clamps(render({ active: [CUE3L], selectable: { focusedIndex: null } }))).toEqual(['2'])
    expect(clamps(render({ active: [CUE3L] }))).toEqual(['2'])
  })

  it('a selectable top-line cue is clamped to two lines', () => {
    expect(clamps(render({ active: [TOP3], selectable: { focusedIndex: null } }))).toEqual(['2'])
  })

  it('clamping is visual only: every word of a clamped selectable cue keeps its aria-label', () => {
    const el = render({ active: [CUE3L], selectable: { focusedIndex: 11 } })
    expect(labels(el)).toEqual(['Line', 'one', 'of', 'three', 'Line', 'two', 'of', 'three', 'Line', 'three', 'is', 'clipped'])
  })

  it('words carry aria-label; whitespace and speaker label do not', () => {
    const el = render({ active: [{ ...WORDS, speaker: 'Maria' }], selectable: { focusedIndex: null } })
    const cueRoot = cueRoots(el)[0]!
    const spans = Array.from(cueRoot.children).filter((c) => c.tagName === 'SPAN')
    expect(spans.map((s) => s.getAttribute('aria-label'))).toEqual(['Hello', null, 'brave', null, 'new', null, 'world'])
    expect(cueRoot.textContent).toBe('[Maria] Hello brave new world')
  })

  it('no cue element exposes a role (the old accessibilityRole="text" had no web role)', () => {
    expect(render({ active: [DE, EN], primaryTrackId: 'de' }).querySelectorAll('[role]')).toHaveLength(0)
    expect(render({ active: [WORDS], selectable: { focusedIndex: 0 } }).querySelectorAll('[role]')).toHaveLength(0)
  })

  // Keep last: it reads every console.warn call made by the renders above.
  it('the root is pointer-events none through style, with no deprecation warning', () => {
    const el = render({ active: [DE] })
    expect(getComputedStyle(el).pointerEvents).toBe('none')
    const deprecations = warn.mock.calls.filter((args) => args.some((a) => /deprecated/.test(String(a))))
    expect(deprecations).toEqual([])
  })
})
