import type { Cue } from './types'

/**
 * Minimal, forgiving WebVTT parser.
 * Handles: header, NOTE/STYLE/REGION blocks (skipped), optional cue identifiers,
 * "HH:MM:SS.mmm" and "MM:SS.mmm" timestamps, cue settings (line:), <v Speaker>,
 * <c.sound> / bracketed sounds, <i>/<b> kept, other tags stripped, trailing {k=v} metadata.
 */
export interface ParseOptions {
  trackId: string
  /** Extend cues shorter than this (seconds) to this duration. Netflix minimum is 5/6 s. Default 0.833. */
  minDuration?: number
  /** Merge a gap smaller than this (seconds) into the previous cue's end. Default 0.04 (1 frame at 25fps). */
  mergeGap?: number
}

const TIME_RE = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{3})/

export function parseTimestamp(s: string): number | null {
  const m = TIME_RE.exec(s.trim())
  if (!m) return null
  const h = m[1] ? parseInt(m[1], 10) : 0
  const min = parseInt(m[2]!, 10)
  const sec = parseInt(m[3]!, 10)
  const ms = parseInt(m[4]!, 10)
  return h * 3600 + min * 60 + sec + ms / 1000
}

export function formatTimestamp(t: number): string {
  const total = Math.max(0, t)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
}

const META_RE = /\{([^{}]*=[^{}]*)\}\s*$/
const SPEAKER_TAG_RE = /^<v(?:\.[^\s>]*)?\s+([^>]+)>/i
const BRACKET_SPEAKER_RE = /^\[([^\]]{1,40})\]\s+(?=\S)/
const SOUND_ONLY_RE = /^\s*\[[^\]]+\]\s*$/

function cleanText(raw: string): { text: string; speaker?: string; sound?: boolean } {
  let text = raw.trim()
  let speaker: string | undefined
  let sound = false

  const v = SPEAKER_TAG_RE.exec(text)
  if (v) {
    speaker = v[1]!.trim()
    text = text.slice(v[0].length)
  }
  if (/<c\.sound[^>]*>/i.test(text)) sound = true

  // Keep <i>, <b>; drop every other tag (<c>, <u>, <ruby>, <v>, </v>, timestamps).
  text = text
    .replace(/<\/?(?:c|u|ruby|rt|v|lang)(?:[.\s][^>]*)?>/gi, '')
    .replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{3}>/g, '')
    .replace(/\s+\n/g, '\n')
    .trim()

  if (!speaker) {
    const b = BRACKET_SPEAKER_RE.exec(text)
    // "[Maria] Are you coming?" → speaker Maria; but "[door slams]" alone is a sound.
    if (b && !SOUND_ONLY_RE.test(text) && /^[A-ZÀ-Ý]/.test(b[1]!)) {
      speaker = b[1]!.trim()
      text = text.slice(b[0].length)
    }
  }
  if (SOUND_ONLY_RE.test(text)) sound = true
  return { text, speaker, sound: sound || undefined }
}

function parseMeta(raw: string): { text: string; meta?: Record<string, string> } {
  const m = META_RE.exec(raw)
  if (!m) return { text: raw }
  const meta: Record<string, string> = {}
  for (const pair of m[1]!.split(';')) {
    const [k, ...rest] = pair.split('=')
    if (k && rest.length) meta[k.trim()] = rest.join('=').trim()
  }
  return { text: raw.slice(0, m.index).trimEnd(), meta }
}

export function parseVtt(input: string, opts: ParseOptions): Cue[] {
  const minDuration = opts.minDuration ?? 0.833
  const mergeGap = opts.mergeGap ?? 0.04
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const cues: Cue[] = []
  let i = 0
  // header
  while (i < lines.length && lines[i]!.trim() === '') i++
  if (lines[i] && !/^WEBVTT/.test(lines[i]!)) {
    // tolerate missing header (SRT-ish files): don't throw
  } else i++

  let autoId = 0
  while (i < lines.length) {
    // skip blank
    while (i < lines.length && lines[i]!.trim() === '') i++
    if (i >= lines.length) break
    const first = lines[i]!
    if (/^(NOTE|STYLE|REGION)\b/.test(first)) {
      while (i < lines.length && lines[i]!.trim() !== '') i++
      continue
    }
    let id: string | undefined
    let timing = first
    if (!first.includes('-->')) {
      id = first.trim()
      i++
      timing = lines[i] ?? ''
    }
    const arrow = timing.split('-->')
    if (arrow.length !== 2) {
      i++
      continue
    }
    const start = parseTimestamp(arrow[0]!)
    const rest = arrow[1]!.trim().split(/\s+/)
    const end = parseTimestamp(rest[0] ?? '')
    if (start === null || end === null) {
      i++
      continue
    }
    let line: Cue['line'] | undefined
    for (const setting of rest.slice(1)) {
      const [k, v] = setting.split(':')
      if (k === 'line' && v !== undefined) {
        const n = parseFloat(v)
        line = v.endsWith('%') ? (n < 50 ? 'top' : 'bottom') : n >= 0 && n <= 3 ? 'top' : 'bottom'
      }
    }
    i++
    const body: string[] = []
    while (i < lines.length && lines[i]!.trim() !== '') body.push(lines[i++]!)
    const { text: withoutMeta, meta } = parseMeta(body.join('\n'))
    const cleaned = cleanText(withoutMeta)
    if (!cleaned.text) continue
    cues.push({
      trackId: opts.trackId,
      id: id ?? `c${++autoId}`,
      start,
      end: Math.max(end, start + minDuration),
      text: cleaned.text,
      ...(line ? { line } : {}),
      ...(cleaned.speaker ? { speaker: cleaned.speaker } : {}),
      ...(cleaned.sound ? { sound: true } : {}),
      ...(meta ? { meta } : {}),
    })
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end)
  // merge tiny gaps and prevent overlaps created by minDuration extension
  for (let k = 0; k < cues.length - 1; k++) {
    const a = cues[k]!
    const b = cues[k + 1]!
    if (b.start - a.end > 0 && b.start - a.end < mergeGap) a.end = b.start
    if (a.end > b.start && a.start !== b.start) a.end = b.start
  }
  return cues
}

export function serializeVtt(cues: Cue[]): string {
  const out = ['WEBVTT', '']
  for (const c of cues) {
    out.push(c.id)
    out.push(`${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}${c.line === 'top' ? ' line:1' : ''}`)
    let text = c.text
    if (c.speaker) text = `<v ${c.speaker}>${text}`
    if (c.meta && Object.keys(c.meta).length) text += ` {${Object.entries(c.meta).map(([k, v]) => `${k}=${v}`).join(';')}}`
    out.push(text, '')
  }
  return out.join('\n')
}

/** Reading-speed and line-length checks (Netflix Timed Text: ≤2 lines, ≤42 chars/line, ≤20 cps). */
export interface CueLint { id: string; problem: 'cps' | 'lines' | 'lineLength' | 'duration'; value: number }
export function lintCues(cues: Cue[], limits = { cps: 20, lines: 2, lineLength: 42, minDuration: 0.833 }): CueLint[] {
  const out: CueLint[] = []
  for (const c of cues) {
    const plain = c.text.replace(/<[^>]+>/g, '')
    const lines = plain.split('\n')
    const dur = c.end - c.start
    const cps = plain.replace(/\n/g, '').length / Math.max(dur, 0.001)
    if (cps > limits.cps) out.push({ id: c.id, problem: 'cps', value: Math.round(cps * 10) / 10 })
    if (lines.length > limits.lines) out.push({ id: c.id, problem: 'lines', value: lines.length })
    const longest = Math.max(...lines.map((l) => l.length))
    if (longest > limits.lineLength) out.push({ id: c.id, problem: 'lineLength', value: longest })
    if (dur < limits.minDuration - 1e-6) out.push({ id: c.id, problem: 'duration', value: Math.round(dur * 1000) / 1000 })
  }
  return out
}
