import { deprecateOnce, DEPRECATION_DOCS, DOCS, VEGA_DOCS, VEGA_EXPERIMENTAL, warnOnce } from '../src/platform/log'

describe('deprecateOnce', () => {
  it('deprecateOnce warns once per subject with the doc link', () => {
    const real = console.warn
    const calls: string[] = []
    console.warn = (...args: unknown[]) => { calls.push(args.join(' ')) }
    try {
      deprecateOnce('x-kit-text-urls', DEPRECATION_DOCS)
      deprecateOnce('x-kit-text-urls', DEPRECATION_DOCS)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toContain('x-kit-text-urls')
      expect(calls[0]).toContain('deprecated')
      expect(calls[0]).toContain(DEPRECATION_DOCS)

      deprecateOnce('some-other-subject', DEPRECATION_DOCS)
      expect(calls).toHaveLength(2)
      expect(calls[1]).toContain('some-other-subject')
    } finally {
      console.warn = real
    }
  })
})

describe('warnOnce', () => {
  it('without a reason keeps the Fire OS / web message; with one, appends it before the doc link', () => {
    const real = console.debug
    const calls: string[] = []
    console.debug = (...args: unknown[]) => { calls.push(args.join(' ')) }
    try {
      warnOnce('x.plain', 'android', DOCS)
      expect(calls).toEqual([`[vega-media-kit] x.plain is a no-op on android. See ${DOCS}`])
      warnOnce('x.vega', 'kepler', VEGA_DOCS, VEGA_EXPERIMENTAL)
      warnOnce('x.vega', 'kepler', VEGA_DOCS, VEGA_EXPERIMENTAL)
      expect(calls).toHaveLength(2)
      expect(calls[1]).toBe(`[vega-media-kit] x.vega is a no-op on kepler — ${VEGA_EXPERIMENTAL}. See ${VEGA_DOCS}`)
    } finally {
      console.debug = real
    }
  })
})
