import { readFileSync } from 'node:fs'
import { parseVtt, serializeVtt, lintCues, parseTimestamp, formatTimestamp } from '../src/core'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url).pathname, 'utf8')

describe('timestamps', () => {
  it('parses HH:MM:SS.mmm and MM:SS.mmm', () => {
    expect(parseTimestamp('00:01:02.500')).toBe(62.5)
    expect(parseTimestamp('01:02.500')).toBe(62.5)
    expect(parseTimestamp('01:02,500')).toBe(62.5)
    expect(parseTimestamp('garbage')).toBeNull()
  })
  it('round-trips', () => {
    expect(formatTimestamp(3723.042)).toBe('01:02:03.042')
  })
})

describe('parseVtt', () => {
  const cues = parseVtt(fx('basic.vtt'), { trackId: 't1' })
  it('parses identifiers and auto-ids', () => {
    expect(cues.map((c) => c.id)).toEqual(['1', '2', '3', 'c1', 'c2', 'c3'])
  })
  it('extracts speaker from <v> and from [Name] prefix', () => {
    expect(cues[0]).toMatchObject({ speaker: 'Maria', text: 'Are you coming?' })
    expect(cues[4]).toMatchObject({ speaker: 'Anna', text: 'I told you to wait.\nTwice.' })
  })
  it('marks sound cues from brackets and <c.sound>', () => {
    expect(cues[1]).toMatchObject({ sound: true, text: '[door slams]', line: 'top' })
    expect(cues[5]).toMatchObject({ sound: true, text: 'wind howls' })
  })
  it('keeps <i> and parses trailing meta', () => {
    expect(cues[3]!.text).toBe('Night. A rooftop. Words appear: <i>Berlin, 1989</i>')
    expect(cues[3]!.meta).toEqual({ extended: '1', words: '7' })
  })
  it('extends too-short cues to the minimum duration without overlapping the next', () => {
    expect(cues[2]!.end - cues[2]!.start).toBeCloseTo(0.833, 3)
    expect(cues[1]!.end).toBeLessThanOrEqual(cues[2]!.start)
  })
  it('merges one-frame gaps', () => {
    // cue 1 ends 3.500, cue 2 starts 3.520 → gap 0.02 < 0.04 → merged
    expect(cues[0]!.end).toBe(3.52)
  })
  it('keeps overlapping cues on the same track (two-language tracks)', () => {
    const o = parseVtt(fx('overlap.vtt'), { trackId: 'x' })
    expect(o).toHaveLength(3)
    expect(o[0]!.start).toBe(o[1]!.start)
  })
  it('tolerates missing header and junk blocks', () => {
    const c = parseVtt('00:00:01.000 --> 00:00:02.000\nHi\n\nnot a cue\n\n00:00:03.000 --> 00:00:04.000\nBye', { trackId: 'z' })
    expect(c.map((x) => x.text)).toEqual(['Hi', 'Bye'])
  })
})

describe('serializeVtt', () => {
  it('round-trips speaker, meta and line', () => {
    const cues = parseVtt(fx('basic.vtt'), { trackId: 't1' })
    const again = parseVtt(serializeVtt(cues), { trackId: 't1' })
    expect(again.map((c) => [c.text, c.speaker, c.meta, c.line])).toEqual(cues.map((c) => [c.text, c.speaker, c.meta, c.line]))
  })
})

describe('lintCues', () => {
  it('flags reading speed, lines and line length', () => {
    const fast = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n' + 'a'.repeat(43) + '\nb\nc', { trackId: 'l' })
    const problems = lintCues(fast).map((p) => p.problem)
    expect(problems).toEqual(expect.arrayContaining(['cps', 'lines', 'lineLength']))
  })
  it('passes a well-formed cue', () => {
    const ok = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nIch warte seit zwei Stunden.', { trackId: 'l' })
    expect(lintCues(ok)).toEqual([])
  })
})
