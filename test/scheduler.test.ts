import { CueScheduler, parseVtt } from '../src/core'
import { readFileSync } from 'node:fs'

const fx = readFileSync(new URL('./fixtures/basic.vtt', import.meta.url).pathname, 'utf8')

describe('CueScheduler', () => {
  it('emits only on changes and handles seeks', () => {
    const emitted: string[][] = []
    const s = new CueScheduler((active) => emitted.push(active.map((c) => c.id)))
    s.setTrack('t1', parseVtt(fx, { trackId: 't1' }))
    for (const p of [0, 0.5, 1.0, 1.5, 3.0, 3.6, 4.9, 5.2, 6.0, 7.5, 12, 22, 25]) s.update(p)
    expect(emitted).toEqual([['1'], ['2'], ['3'], [], ['c1'], ['c2'], ['c3'], []])
    // seek backwards → full re-evaluation
    s.update(1.2)
    expect(emitted.at(-1)).toEqual(['1'])
  })
  it('merges multiple tracks and sorts by start', () => {
    const emitted: string[][] = []
    const s = new CueScheduler((active) => emitted.push(active.map((c) => `${c.trackId}:${c.id}`)))
    s.setTrack('de', parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHallo', { trackId: 'de' }))
    s.setTrack('en', parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello', { trackId: 'en' }))
    s.update(2)
    expect(emitted.at(-1)).toEqual(['de:c1', 'en:c1'])
    s.removeTrack('en')
    s.update(2.1)
    expect(emitted.at(-1)).toEqual(['de:c1'])
  })
  it('reports the next boundary', () => {
    const s = new CueScheduler(() => {})
    s.setTrack('t1', parseVtt(fx, { trackId: 't1' }))
    expect(s.nextBoundary(0)).toBe(1)
    expect(s.nextBoundary(1)).toBe(3.52)
  })
})
