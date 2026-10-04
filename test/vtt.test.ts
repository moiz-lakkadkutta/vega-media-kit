import { readFileSync } from 'node:fs'
import { parseVtt, serializeVtt, lintCues, parseTimestamp, formatTimestamp, joinVttSegments } from '../src/core'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url).pathname, 'utf8')

// KIT-030: cue times are the decimal value rounded to milliseconds, summed in integer ms and divided once.
const fmt = (ms: number, hours = true) => {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${hours ? pad(h) + ':' : ''}${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`
}

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

  it('parses 00:00:03.837 to exactly 3.837', () => {
    expect(parseTimestamp('00:00:03.837')).toBe(3.837)
  })
  it('parses hour timestamps ms-exact', () => {
    expect(parseTimestamp('01:02:03.837')).toBe(3723.837)
    expect(parseTimestamp('10:59:59.999')).toBe(39599.999)
    expect(parseTimestamp('99:59:59.999')).toBe(359999.999)
  })
  it('mm:ss.ttt without hours is ms-exact', () => {
    expect(parseTimestamp('00:03.837')).toBe(3.837)
    expect(parseTimestamp('59:59,999')).toBe(3599.999)
  })
  it('every millisecond parses to ms / 1000 exactly, with and without hours', () => {
    const bad: string[] = []
    const check = (ms: number) => {
      for (const hours of [true, false]) {
        if (!hours && ms >= 3_600_000) continue
        const got = parseTimestamp(fmt(ms, hours))
        if (got !== ms / 1000) bad.push(`${fmt(ms, hours)} → ${got}`)
      }
    }
    for (let ms = 0; ms <= 10_000; ms++) check(ms)
    for (const h of [1, 2, 10, 23, 99]) for (let ms = 0; ms < 2000; ms++) check(h * 3_600_000 + 1_234_000 + ms)
    expect(bad).toEqual([])
  })
  it('formatTimestamp(ms / 1000) prints the same millisecond (no .1000 carry)', () => {
    const bad: string[] = []
    for (let ms = 0; ms <= 10_000; ms++) if (formatTimestamp(ms / 1000) !== fmt(ms)) bad.push(fmt(ms))
    expect(bad).toEqual([])
    expect(formatTimestamp(1.9996)).toBe('00:00:02.000')
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
    expect([cues[2]!.start, cues[2]!.end]).toEqual([5, 5.833])
  })
  it('cue start/end are ms-exact, including minDuration-extended ends (KIT-030)', () => {
    const c = parseVtt('WEBVTT\n\n00:00:03.837 --> 00:00:03.900\nShort\n\n01:00:00.001 --> 01:00:04.837\nLong', { trackId: 't' })
    expect([c[0]!.start, c[0]!.end]).toEqual([3.837, 4.67])
    expect([c[1]!.start, c[1]!.end]).toEqual([3600.001, 3604.837])
    const bad: string[] = []
    for (let ms = 0; ms <= 10_000; ms += 7) {
      const [x] = parseVtt(`WEBVTT\n\n${fmt(ms)} --> ${fmt(ms + 1)}\nX`, { trackId: 't' })
      if (x!.start !== ms / 1000 || x!.end !== (ms + 833) / 1000) bad.push(`${fmt(ms)}: ${x!.start} ${x!.end}`)
    }
    expect(bad).toEqual([])
  })
  it('merges a gap below mergeGap and never one of exactly mergeGap, by whole milliseconds', () => {
    const bad: string[] = []
    for (let ms = 1000; ms <= 10_000; ms += 3) {
      for (const gap of [39, 40]) {
        const v = `WEBVTT\n\n${fmt(ms - 1000)} --> ${fmt(ms)}\nA\n\n${fmt(ms + gap)} --> ${fmt(ms + 2000)}\nB`
        const [a] = parseVtt(v, { trackId: 't' })
        const want = gap < 40 ? (ms + gap) / 1000 : ms / 1000
        if (a!.end !== want) bad.push(`end ${fmt(ms)} gap ${gap}: ${a!.end}`)
      }
    }
    expect(bad).toEqual([])
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

describe('joinVttSegments', () => {
  const HDR = 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n'
  const seg = (...blocks: string[]) => HDR + blocks.join('\n\n')
  const blocks = (out: string) => (out.match(/-->/g) ?? []).length

  it('writes one WEBVTT header and drops every per-segment header block, including X-TIMESTAMP-MAP and extra header lines', () => {
    const a = seg('00:00:01.000 --> 00:00:02.000\nA')
    const b = 'WEBVTT\nKind: captions\nLanguage: en\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n00:00:05.000 --> 00:00:06.000\nB'
    const out = joinVttSegments([a, b])
    expect(out).toMatch(/^WEBVTT\n\n/)
    expect(out).not.toContain('X-TIMESTAMP-MAP')
    expect(out).not.toContain('Kind:')
    expect(out.match(/WEBVTT/g)).toHaveLength(1)
    expect(out).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\n00:00:05.000 --> 00:00:06.000\nB\n')
  })

  it('keeps a cue that follows the header without a blank line', () => {
    const a = '00:00:01.000 --> 00:00:02.000\nA'
    const b = '00:00:05.000 --> 00:00:06.000\nB'
    const noBlank = 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n' + b + '\n\n' + a
    expect(joinVttSegments([seg(a), noBlank])).toBe(`WEBVTT\n\n${a}\n\n${b}\n`)
    const repeatFirst = 'WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n' + a + '\n\n' + b
    expect(joinVttSegments([seg(a), repeatFirst])).toBe(`WEBVTT\n\n${a}\n\n${b}\n`)
  })

  it('drops a cue block repeated verbatim by the next segment (RFC 8216 §3.5 boundary repeat)', () => {
    const two = '00:00:04.000 --> 00:00:06.500\nTwo'
    const three = '00:00:07.000 --> 00:00:09.500\nThree'
    const four = '00:00:10.000 --> 00:00:12.500\nFour'
    const out = joinVttSegments([seg(two, three), seg(three, four)])
    expect(out).toBe('WEBVTT\n\n' + [two, three, four].join('\n\n') + '\n')
    const cues = parseVtt(out, { trackId: 't' })
    expect(cues).toHaveLength(3)
    expect(cues.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('drops a cue repeated across three consecutive segments once per extra segment, keeping one', () => {
    const long = '00:00:43.794 --> 00:00:49.174\nA long line'
    const out = joinVttSegments([seg(long), seg(long), seg(long)])
    expect(out).toBe(`WEBVTT\n\n${long}\n`)
    expect(blocks(out)).toBe(1)
  })

  it('drops a repeat whose start was clipped to the segment boundary (same end and text, later start)', () => {
    const first = '00:00:03.837 --> 00:00:07.300\nJournal'
    const out = joinVttSegments([seg(first), seg('00:00:04.000 --> 00:00:07.300\nJournal')])
    expect(out).toBe(`WEBVTT\n\n${first}\n`)
    const cues = parseVtt(out, { trackId: 't' })
    expect(cues).toHaveLength(1)
    expect(cues[0]!.start).toBe(3.837)
    expect([cues[0]!.end, cues[0]!.text]).toEqual([7.3, 'Journal'])
  })

  it('keeps a same-text cue whose interval is not contained (split cues are not merged)', () => {
    const out = joinVttSegments([seg('00:00:03.500 --> 00:00:04.000\nSame'), seg('00:00:04.000 --> 00:00:06.500\nSame')])
    expect(blocks(out)).toBe(2)
    expect(out).toBe('WEBVTT\n\n00:00:03.500 --> 00:00:04.000\nSame\n\n00:00:04.000 --> 00:00:06.500\nSame\n')
  })

  it('never de-duplicates within a single segment', () => {
    const cue = '00:00:07.000 --> 00:00:09.500\nTwice'
    const out = joinVttSegments([seg(cue, cue)])
    expect(out).toBe(`WEBVTT\n\n${cue}\n\n${cue}\n`)
  })

  it('ignores cue identifiers when matching a repeat', () => {
    const a = '1\n00:00:07.000 --> 00:00:09.500\nX'
    const same = joinVttSegments([seg(a), seg('1\n00:00:07.000 --> 00:00:09.500\nX')])
    expect(same).toBe(`WEBVTT\n\n${a}\n`)
    const other = joinVttSegments([seg(a), seg('7\n00:00:07.000 --> 00:00:09.500\nX')])
    expect(other).toBe(`WEBVTT\n\n${a}\n`)
    expect(parseVtt(other, { trackId: 't' }).map((c) => c.id)).toEqual(['1'])
  })

  it('treats a cue with different settings or different text as a different cue', () => {
    const settings = joinVttSegments([
      seg('00:00:07.000 --> 00:00:09.500 align:center\nX'),
      seg('00:00:07.000 --> 00:00:09.500 align:start\nX'),
    ])
    expect(blocks(settings)).toBe(2)
    const text = joinVttSegments([seg('00:00:07.000 --> 00:00:09.500\nX'), seg('00:00:07.000 --> 00:00:09.500\nX.')])
    expect(blocks(text)).toBe(2)
  })

  it('compares timestamps in whole milliseconds, so 00:07.000 and 00:00:07.000 are the same time', () => {
    const out = joinVttSegments([seg('00:07.000 --> 00:09.500\nX'), seg('00:00:07.000 --> 00:00:09.500\nX')])
    expect(out).toBe('WEBVTT\n\n00:07.000 --> 00:09.500\nX\n')
    // 3.837 is a float that does not round-trip exactly; its ms value must still be stable.
    const clipped = joinVttSegments([seg('00:00:03.837 --> 00:00:07.300\nY'), seg('00:03.837 --> 00:07.300\nY')])
    expect(blocks(clipped)).toBe(1)
  })

  it('passes NOTE, STYLE and unparseable blocks through verbatim, in order', () => {
    const note = 'NOTE x'
    const style = 'STYLE\n::cue { color: inherit }'
    const junk = 'garbage --> more\nG'
    const cueA = '00:00:01.000 --> 00:00:02.000\nA'
    const cueB = '00:00:05.000 --> 00:00:06.000\nB'
    const out = joinVttSegments([seg(note, style, junk, cueA), seg(note, junk, cueB)])
    expect(out).toBe('WEBVTT\n\n' + [note, style, junk, cueA, note, junk, cueB].join('\n\n') + '\n')
  })

  it('returns "WEBVTT\\n" for no segments and for segments with only headers', () => {
    expect(joinVttSegments([])).toBe('WEBVTT\n')
    expect(joinVttSegments([HDR, 'WEBVTT\n', '﻿WEBVTT\r\nKind: captions\r\n\r\n'])).toBe('WEBVTT\n')
  })

  describe('Shaka Packager v3.9.3 fixture', () => {
    const dir = 'hls/shaka-packager-3.9.3-captions'
    const names = fx(`${dir}/captions.m3u8`)
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.slice(l.lastIndexOf('/') + 1))
    const segments = names.map((n) => fx(`${dir}/${n}`))

    it('Shaka Packager v3.9.3 fixture: 15 segments carry 24 cue blocks and join to the 15 source cues', () => {
      expect(names).toEqual(Array.from({ length: 15 }, (_, i) => `${i + 1}.vtt`))
      const out = joinVttSegments(segments)
      expect((out.match(/-->/g) ?? []).length).toBe(15)
      expect(parseVtt(out, { trackId: '0' }).map((c) => [c.start, c.end, c.text])).toEqual([
        [1, 3.5, 'CAP 1 (1.0–3.5s)'],
        [4, 6.5, 'CAP 2 (4.0–6.5s)'],
        [7, 9.5, 'CAP 3 (7.0–9.5s) ⟂ boundary'],
        [10, 12.5, 'CAP 4 (10.0–12.5s)'],
        [13, 15.5, 'CAP 5 (13.0–15.5s)'],
        [19, 21.5, 'CAP 6 (19.0–21.5s) ⟂ boundary'],
        [22, 24.5, 'CAP 7 (22.0–24.5s)'],
        [25, 27.5, 'CAP 8 (25.0–27.5s)'],
        [31, 33.5, 'CAP 9 (31.0–33.5s) ⟂ boundary'],
        [34, 36.5, 'CAP 10 (34.0–36.5s)'],
        [37, 39.5, 'CAP 11 (37.0–39.5s)'],
        [43, 45.5, 'CAP 12 (43.0–45.5s) ⟂ boundary'],
        [46, 48.5, 'CAP 13 (46.0–48.5s)'],
        [49, 51.5, 'CAP 14 (49.0–51.5s)'],
        [55, 57.5, 'CAP 15 (55.0–57.5s) ⟂ boundary'],
      ])
    })

    it('the fixture is what the packager wrote: the same 15 segments concatenated hold 24 cue blocks', () => {
      expect(segments).toHaveLength(15)
      expect((segments.join('\n').match(/-->/g) ?? []).length).toBe(24)
      expect(segments.every((s) => s.startsWith('WEBVTT\n\n'))).toBe(true)
    })
  })
})

