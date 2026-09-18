import { mapKey, toTransport } from '../src/platform/remote'
describe('remote mapping', () => {
  it('maps Android keycodes and RN TV event names', () => {
    expect(mapKey(4)).toBe('back'); expect(mapKey('85')).toBe('playPause'); expect(mapKey('select')).toBe('select')
    expect(mapKey('nope')).toBeUndefined()
  })
  it('maps Vega TVEventHandler eventType names', () => {
    // https://developer.amazon.com/docs/react-native-vega/0.72/using_tveventhandler.html
    expect(mapKey('playpause')).toBe('playPause')
    expect(mapKey('skip_backward')).toBe('rewind')
    expect(mapKey('skip_forward')).toBe('fastForward')
    // D-pad / system names Vega shares with RN TV
    expect(mapKey('up')).toBe('up'); expect(mapKey('down')).toBe('down')
    expect(mapKey('left')).toBe('left'); expect(mapKey('right')).toBe('right')
    expect(mapKey('back')).toBe('back'); expect(mapKey('menu')).toBe('menu')
  })
  it('leaves unknown names undefined', () => {
    expect(mapKey('nope')).toBeUndefined()
    // Vega names with no RemoteKey equivalent are deliberately unmapped
    expect(mapKey('page_up')).toBeUndefined(); expect(mapKey('info')).toBeUndefined(); expect(mapKey('more')).toBeUndefined()
  })
  it('maps media keys to transport controls', () => {
    expect(toTransport('playPause')).toBe('togglePlayPause'); expect(toTransport('up')).toBeUndefined()
  })
})
