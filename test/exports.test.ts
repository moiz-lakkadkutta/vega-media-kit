import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// KIT-027: Metro (and Node) pick the FIRST matching condition in key order.
// `types` must lead for TypeScript; `react-native` must precede `import`/`require`
// so React Native bundlers get the source entry, not dist/.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  exports: Record<string, Record<string, string>>
}
const entries = Object.entries(pkg.exports)

describe('package.json exports condition order', () => {
  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('%s lists types, react-native, import, require in that order', (_, conds) => {
    const keys = Object.keys(conds)
    expect(keys[0]).toBe('types')
    const rn = keys.indexOf('react-native')
    expect(rn).toBeGreaterThan(-1)
    for (const k of ['import', 'require']) {
      if (keys.includes(k)) expect(rn).toBeLessThan(keys.indexOf(k))
    }
    if (keys.includes('default')) expect(keys[keys.length - 1]).toBe('default')
  })

  it.each(entries)('%s react-native target is an existing file in ./src', (_, conds) => {
    const target = conds['react-native'] ?? ''
    expect(target).toMatch(/^\.\/src\//)
    expect(existsSync(resolve(root, target))).toBe(true)
  })

  it.each(entries)('%s import/require targets point into ./dist', (_, conds) => {
    for (const k of ['import', 'require']) {
      if (k in conds) expect(conds[k]).toMatch(/^\.\/dist\//)
    }
  })
})
