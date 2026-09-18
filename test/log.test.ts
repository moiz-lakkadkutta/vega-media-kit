import { deprecateOnce, DEPRECATION_DOCS } from '../src/platform/log'

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
