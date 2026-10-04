/**
 * DESC-006: on Vega `setVolume` is a no-op (Vega is experimental — decision 0001; the w3cmedia `volume` field is not
 * confirmed). It must not throw for any input and, like every Vega no-op (KIT-018), says so once at debug level.
 * The Vega adapter cannot render under vitest (it `require`s w3cmedia and shaka-player inside the component), so
 * the no-op is a named function: called here, and pinned as the handle's `setVolume` by source.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('react-native', () => ({ Platform: { OS: 'kepler' } }))

import { setVolumeUnsupported } from '../src/player/adapters/vega'

const VEGA_DOC = 'https://github.com/moiz-lakkadkutta/vega-media-kit/blob/main/docs/decisions/0001-week0-gates.md'

describe('VegaAdapter — setVolume is a documented no-op (DESC-006)', () => {
  let logged: string[]
  const real = { debug: console.debug, warn: console.warn, log: console.log, info: console.info }
  beforeEach(() => {
    logged = []
    const capture = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
    console.debug = capture; console.warn = capture; console.log = capture; console.info = capture
  })
  afterEach(() => { Object.assign(console, real) })

  // First in the file: the warning is once per module load.
  it('warns once, naming "experimental" and linking the Vega status doc', () => {
    setVolumeUnsupported(0.5)
    setVolumeUnsupported(0.2)
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('KitPlayerRef.setVolume')
    expect(logged[0]).toContain('experimental')
    expect(logged[0]).toContain(VEGA_DOC)
  })

  it('does not throw for any value and returns nothing', () => {
    for (const v of [0, 0.5, 1, -1, 2, Number.NaN, Infinity]) expect(setVolumeUnsupported(v)).toBeUndefined()
  })

  it("is the Vega handle's setVolume (source pin)", () => {
    const vega = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/player/adapters/vega.tsx'), 'utf8')
    expect(vega).toMatch(/setVolume: setVolumeUnsupported,/)
  })
})
