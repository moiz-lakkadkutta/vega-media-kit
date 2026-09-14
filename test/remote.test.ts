import { mapKey, toTransport } from '../src/platform/remote'
describe('remote mapping', () => {
  it('maps Android keycodes and RN TV event names', () => {
    expect(mapKey(4)).toBe('back'); expect(mapKey('85')).toBe('playPause'); expect(mapKey('select')).toBe('select')
    expect(mapKey('nope')).toBeUndefined()
  })
  it('maps media keys to transport controls', () => {
    expect(toTransport('playPause')).toBe('togglePlayPause'); expect(toTransport('up')).toBeUndefined()
  })
})
