import type { AudioTrack, TextTrack } from './types'
import { labelFor, normalizeRoles, textKindFromLabel, textKindFromRoles } from './tracks'

/**
 * Pure HLS master (multivariant) playlist parsing — RFC 8216.
 *
 * No I/O and no React Native: this runs in a media pipeline under plain Node as readily as on a device.
 * The fetch layer that feeds it lives in `src/player/hls.ts`.
 */

/** `TYPE` of an `#EXT-X-MEDIA` tag — RFC 8216 §4.3.4.1. */
export type HlsMediaType = 'AUDIO' | 'VIDEO' | 'SUBTITLES' | 'CLOSED-CAPTIONS'

/** One `#EXT-X-MEDIA` tag. Attribute semantics: RFC 8216 §4.3.4.1. */
export interface HlsRendition {
  type: HlsMediaType
  groupId: string
  /** NAME — required by the spec; '' if a broken playlist omits it. */
  name: string
  /** LANGUAGE (RFC 5646) as written, e.g. 'pt-BR'; undefined when absent. */
  language?: string
  /** URI resolved against `baseUrl` when one was given; undefined when absent (always for CLOSED-CAPTIONS). */
  uri?: string
  /** DEFAULT=YES. */
  default: boolean
  /** AUTOSELECT=YES. */
  autoselect: boolean
  /** FORCED=YES (SUBTITLES only). */
  forced: boolean
  /** CHARACTERISTICS split on ',', e.g. ['public.accessibility.describes-video']; [] when absent. */
  characteristics: string[]
  /** INSTREAM-ID (CLOSED-CAPTIONS only). */
  instreamId?: string
  /** CHANNELS as written, e.g. '6' or '16/JOC'. */
  channels?: string
  /** Every attribute as written (quotes stripped), including the ones mapped above. */
  attributes: Record<string, string>
}

/** One `#EXT-X-STREAM-INF` tag and the URI line that follows it — RFC 8216 §4.3.4.2. */
export interface HlsVariant {
  uri: string
  bandwidth?: number
  averageBandwidth?: number
  codecs: string[]
  resolution?: { width: number; height: number }
  /** GROUP-ID references into `HlsMaster.renditions`. */
  audio?: string
  subtitles?: string
  /** GROUP-ID, or 'NONE'. */
  closedCaptions?: string
  attributes: Record<string, string>
}

export interface HlsMaster {
  /** #EXT-X-VERSION, when present. */
  version?: number
  /** #EXT-X-INDEPENDENT-SEGMENTS present. */
  independentSegments: boolean
  /** In playlist order, all TYPEs. */
  renditions: HlsRendition[]
  /** In playlist order. I-frame variants are not included. */
  variants: HlsVariant[]
}

/** RFC 8216 §4.2 attribute list: `A=1,B="x,y",C=YES` → { A: '1', B: 'x,y', C: 'YES' }. Last duplicate wins. */
export function parseAttributeList(input: string): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < input.length) {
    const eq = input.indexOf('=', i)
    if (eq < 0) break
    const name = input.slice(i, eq).trim()
    let value: string
    let next: number
    if (input[eq + 1] === '"') {
      // A quoted-string may contain the list separator; CHARACTERISTICS is the attribute that does.
      const close = input.indexOf('"', eq + 2)
      const end = close < 0 ? input.length : close
      value = input.slice(eq + 2, end)
      const comma = input.indexOf(',', end + 1)
      next = comma < 0 ? input.length : comma + 1
    } else {
      const comma = input.indexOf(',', eq + 1)
      const end = comma < 0 ? input.length : comma
      value = input.slice(eq + 1, end).trim()
      next = end + 1
    }
    if (name) out[name] = value
    i = next
  }
  return out
}

/** RFC 3986 §5.2.4 remove_dot_segments, over a path that has already been merged. */
function removeDotSegments(path: string): string {
  const segments = path.split('/')
  const out: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const last = i === segments.length - 1
    if (seg === '.') {
      if (last) out.push('')
    } else if (seg === '..') {
      if (out.length > 1) out.pop()
      if (last) out.push('')
    } else {
      out.push(seg)
    }
  }
  return out.join('/')
}

/** Split a reference into path, query (with '?') and fragment (with '#'). */
function splitReference(ref: string): { path: string; query: string; fragment: string } {
  const hash = ref.indexOf('#')
  const fragment = hash < 0 ? '' : ref.slice(hash)
  const rest = hash < 0 ? ref : ref.slice(0, hash)
  const q = rest.indexOf('?')
  return { path: q < 0 ? rest : rest.slice(0, q), query: q < 0 ? '' : rest.slice(q), fragment }
}

const ABSOLUTE = /^[A-Za-z][A-Za-z0-9+\-.]*:/
const BASE_PARTS = /^([A-Za-z][A-Za-z0-9+\-.]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/

/**
 * RFC 3986 §5.2 reference resolution for the subset HLS needs: absolute, protocol-relative (`//`),
 * absolute-path (`/`), and relative-path references with `.`/`..` removal. The base's query and fragment
 * are dropped; the reference's query is kept.
 *
 * Deliberately hand-written: React Native's `URL` polyfill implements `new URL(ref, base)` as string
 * concatenation, so `new URL('s1/en/prog_index.m3u8', '…/master.m3u8')` yields
 * `…/master.m3u8/s1/en/prog_index.m3u8`. Never use `new URL()` here — the test cross-checks this
 * function against Node's WHATWG URL, which is the implementation the polyfill is not.
 */
export function resolveUrl(base: string, reference: string): string {
  const ref = reference.trim()
  if (ABSOLUTE.test(ref)) return ref
  const m = BASE_PARTS.exec(base)
  if (!m) return ref
  const scheme = m[1]!
  const authority = m[2]!
  const basePath = m[3] ?? ''
  const baseQuery = m[4] ?? ''

  if (ref.startsWith('//')) {
    // Network-path reference: the reference brings its own authority, the base lends only the scheme.
    const rest = ref.slice(2)
    const cut = rest.search(/[/?#]/)
    const refAuthority = cut < 0 ? rest : rest.slice(0, cut)
    const r = splitReference(cut < 0 ? '' : rest.slice(cut))
    return `${scheme}://${refAuthority}${removeDotSegments(r.path || '/')}${r.query}${r.fragment}`
  }

  const r = splitReference(ref)
  let path: string
  let query: string
  if (r.path === '') {
    path = basePath || '/'
    query = r.query || baseQuery
  } else if (r.path.startsWith('/')) {
    path = removeDotSegments(r.path)
    query = r.query
  } else {
    const slash = basePath.lastIndexOf('/')
    const merged = slash < 0 ? `/${r.path}` : `${basePath.slice(0, slash + 1)}${r.path}`
    path = removeDotSegments(merged)
    query = r.query
  }
  return `${scheme}://${authority}${path}${query}${r.fragment}`
}

/** Playlist lines: BOM stripped, CRLF tolerated, blank lines kept out. RFC 8216 §4.1. */
function playlistLines(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const out: string[] = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (line !== '') out.push(line)
  }
  return out
}

/** True for a master (multivariant) playlist: has #EXT-X-STREAM-INF or #EXT-X-MEDIA and no #EXTINF. */
export function isMasterPlaylist(text: string): boolean {
  let master = false
  for (const line of playlistLines(text)) {
    if (line.startsWith('#EXTINF')) return false
    if (line.startsWith('#EXT-X-STREAM-INF') || line.startsWith('#EXT-X-MEDIA')) master = true
  }
  return master
}

const MEDIA_TYPES: HlsMediaType[] = ['AUDIO', 'VIDEO', 'SUBTITLES', 'CLOSED-CAPTIONS']

const yes = (v: string | undefined): boolean => v === 'YES'

const int = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

const list = (v: string | undefined): string[] =>
  v === undefined ? [] : v.split(',').map((s) => s.trim()).filter((s) => s !== '')

const resolution = (v: string | undefined): { width: number; height: number } | undefined => {
  const m = v === undefined ? null : /^(\d+)x(\d+)$/i.exec(v)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined
}

/**
 * Parse a master playlist. Throws `Error` (message contains 'EXTM3U') when the first non-blank line
 * is not `#EXTM3U`. With `baseUrl`, every URI is made absolute; without it URIs are left as written.
 */
export function parseHlsMaster(text: string, baseUrl?: string): HlsMaster {
  const master: HlsMaster = { independentSegments: false, renditions: [], variants: [] }
  const abs = (uri: string): string => (baseUrl ? resolveUrl(baseUrl, uri) : uri)
  let seenHeader = false
  /** Attributes of an `#EXT-X-STREAM-INF` still waiting for its URI line. */
  let pending: Record<string, string> | null = null

  for (const line of playlistLines(text)) {
    if (!seenHeader) {
      if (line !== '#EXTM3U') throw new Error(`Not an HLS playlist: expected #EXTM3U, got ${JSON.stringify(line.slice(0, 40))}`)
      seenHeader = true
      continue
    }

    if (line.startsWith('#')) {
      if (!line.startsWith('#EXT')) continue // a plain comment, e.g. Shaka Packager's '## Generated with …'
      // Any tag before the URI line means that STREAM-INF has no URI; drop it (§4.3).
      pending = null
      const colon = line.indexOf(':')
      const tag = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? '' : line.slice(colon + 1)

      if (tag === '#EXT-X-VERSION') {
        master.version = int(value)
      } else if (tag === '#EXT-X-INDEPENDENT-SEGMENTS') {
        master.independentSegments = true
      } else if (tag === '#EXT-X-MEDIA') {
        const a = parseAttributeList(value)
        const type = a['TYPE'] as HlsMediaType | undefined
        if (!type || !MEDIA_TYPES.includes(type)) continue
        const uri = a['URI']
        master.renditions.push({
          type,
          groupId: a['GROUP-ID'] ?? '',
          name: a['NAME'] ?? '',
          language: a['LANGUAGE'],
          uri: uri === undefined ? undefined : abs(uri),
          default: yes(a['DEFAULT']),
          autoselect: yes(a['AUTOSELECT']),
          forced: yes(a['FORCED']),
          characteristics: list(a['CHARACTERISTICS']),
          instreamId: a['INSTREAM-ID'],
          channels: a['CHANNELS'],
          attributes: a,
        })
      } else if (tag === '#EXT-X-STREAM-INF') {
        pending = parseAttributeList(value)
      }
      // Everything else (#EXT-X-I-FRAME-STREAM-INF, #EXT-X-SESSION-DATA, #EXT-X-DEFINE, …) is out of
      // scope by design; HlsRendition.attributes keeps the raw values a later ticket would need.
      continue
    }

    // A non-'#' line is a URI line and belongs to the preceding #EXT-X-STREAM-INF.
    if (!pending) continue
    const a = pending
    pending = null
    master.variants.push({
      uri: abs(line),
      bandwidth: int(a['BANDWIDTH']),
      averageBandwidth: int(a['AVERAGE-BANDWIDTH']),
      codecs: list(a['CODECS']),
      resolution: resolution(a['RESOLUTION']),
      audio: a['AUDIO'],
      subtitles: a['SUBTITLES'],
      closedCaptions: a['CLOSED-CAPTIONS'],
      attributes: a,
    })
  }

  if (!seenHeader) throw new Error('Not an HLS playlist: no #EXTM3U line')
  return master
}

/**
 * SUBTITLES renditions that carry a URI, in playlist order, de-duplicated by URI, as kit text tracks.
 *
 * `active` is always false: text stays off until the app or `preferredText` asks for it
 * (docs/decisions/0003). CLOSED-CAPTIONS renditions are excluded — they have no URI, so the scheduler
 * cannot deliver them.
 */
export function textTracksFromHls(master: HlsMaster): TextTrack[] {
  const out: TextTrack[] = []
  const seen = new Set<string>()
  for (const r of master.renditions) {
    if (r.type !== 'SUBTITLES' || !r.uri || seen.has(r.uri)) continue
    seen.add(r.uri)
    const kind = textKindFromRoles(r.characteristics) ?? textKindFromLabel(r.name) ?? 'subtitles'
    const language = r.language || 'und'
    out.push({
      id: String(out.length),
      language,
      label: r.name.trim() || `${language} – ${kind}`,
      kind,
      active: false,
      url: r.uri,
    })
  }
  return out
}

/**
 * AUDIO renditions, in playlist order, as kit audio tracks. No de-duplication: Apple's bipbop master
 * legitimately lists three "English" renditions (AAC, AC-3, EC-3).
 */
export function audioTracksFromHls(master: HlsMaster): AudioTrack[] {
  const out: AudioTrack[] = []
  for (const r of master.renditions) {
    if (r.type !== 'AUDIO') continue
    const roles = normalizeRoles(r.characteristics)
    const language = r.language || 'und'
    out.push({ id: String(out.length), language, label: labelFor(language, roles, r.name), roles, active: r.default })
  }
  return out
}
