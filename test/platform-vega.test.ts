/**
 * KIT-018: on Vega every platform binding is a no-op (KIT-007 deferred) and must say so once, naming
 * "experimental" and linking the doc that explains the status (decision 0001). Calls the real exported bindings.
 */
vi.mock('react-native', () => ({ Platform: { OS: 'kepler' } }))

import { contentLauncher, mediaControls, parentalControls, personalization } from '../src/platform'
import { isVega } from '../src/platform/os'

const VEGA_DOC = 'https://github.com/moiz-lakkadkutta/vega-media-kit/blob/main/docs/decisions/0001-week0-gates.md'

const bindings: Array<[string, () => unknown]> = [
  ['contentLauncher.registerCatalog', () => contentLauncher.registerCatalog([{ id: 'a', title: 'A', uri: 'app://a' }])],
  ['personalization.reportPlayback', () => personalization.reportPlayback('a', 10, 100)],
  ['personalization.setWatchlist', () => personalization.setWatchlist('a', true)],
  ['mediaControls.setNowPlaying', () => mediaControls.setNowPlaying({ title: 'A', playing: true })],
  ['parentalControls.isRestricted', () => parentalControls.isRestricted('12')],
  ['parentalControls.requestPin', () => parentalControls.requestPin()],
]

describe('Vega platform no-ops warn once (KIT-018)', () => {
  let logged: string[]
  const real = { debug: console.debug, warn: console.warn, log: console.log, info: console.info }
  beforeEach(() => {
    logged = []
    const capture = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
    console.debug = capture; console.warn = capture; console.log = capture; console.info = capture
  })
  afterEach(() => { Object.assign(console, real) })

  it('runs as Vega', () => { expect(isVega()).toBe(true) })

  it.each(bindings)('%s warns once, names "experimental" and links the Vega status doc', async (name, call) => {
    await call()
    await call()
    const mine = logged.filter((l) => l.includes(name))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toContain('experimental')
    expect(mine[0]).toContain(VEGA_DOC)
    // nothing else logged: in particular not the Fire OS catalog dump
    expect(logged).toHaveLength(1)
  })

  it('still no-ops: return values are unchanged', async () => {
    await expect(contentLauncher.registerCatalog([])).resolves.toBeUndefined()
    await expect(personalization.reportPlayback('a', 1, 2)).resolves.toBeUndefined()
    await expect(personalization.setWatchlist('a', false)).resolves.toBeUndefined()
    expect(mediaControls.setNowPlaying({ title: 'A', playing: false })).toBeUndefined()
    await expect(parentalControls.isRestricted('18')).resolves.toBe(false)
    await expect(parentalControls.requestPin()).resolves.toBe(true)
  })
})
