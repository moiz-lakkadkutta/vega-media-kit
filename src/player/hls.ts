import { isMasterPlaylist, parseHlsMaster, textTracksFromHls } from '../core'
import type { HlsMaster, TextTrack } from '../core'
import { DEPRECATION_DOCS, deprecateOnce } from '../platform/log'

/**
 * The kit's HLS fetch layer: everything that needs the network. The parsing itself is pure and lives in
 * `src/core/hls.ts`, where a media pipeline running in Node can reach it (docs/decisions/0004).
 */

/** Structural subset of fetch, so tests stub it without constructing Response objects. */
export type HlsFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; url: string; text(): Promise<string> }>

export interface HlsLoadOptions {
  /** Sent with the master-playlist request (auth, cookies-by-header). `x-kit-text-urls` is always stripped. */
  headers?: Record<string, string>
  /** Defaults to globalThis.fetch. */
  fetch?: HlsFetch
}

/** @deprecated The id→url JSON map apps used before the kit read the master playlist. Removed in the next minor. */
export const DEPRECATED_TEXT_URLS_HEADER = 'x-kit-text-urls'

/** Everything the caller asked for except the deprecated header — it is an app↔kit convention, not a CDN header. */
function withoutDeprecatedHeader(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (k !== DEPRECATED_TEXT_URLS_HEADER) out[k] = v
  return out
}

/**
 * GET the playlist at `url`. Returns null when the body is a media playlist (the app pointed the kit at a
 * rendition directly). Throws on a non-2xx response (message contains the status) or a non-M3U8 body.
 * URIs are resolved against the final response URL (`res.url`), falling back to `url` when it is empty —
 * some React Native fetch implementations do not fill it in.
 */
export async function fetchHlsMaster(url: string, opts: HlsLoadOptions = {}): Promise<HlsMaster | null> {
  const doFetch = opts.fetch ?? (globalThis.fetch as unknown as HlsFetch)
  const init = opts.headers ? { headers: withoutDeprecatedHeader(opts.headers) } : undefined
  const res = await doFetch(url, init)
  if (!res.ok) throw new Error(`Could not fetch the HLS master playlist: ${res.status} for ${url}`)
  const body = await res.text()
  if (!isMasterPlaylist(body)) {
    // A media playlist is not an error: the app pointed the kit straight at a rendition, so there are no
    // renditions to report. A body that is not a playlist at all (a CDN error page) throws here instead,
    // out of parseHlsMaster, with 'EXTM3U' in the message.
    parseHlsMaster(body)
    return null
  }
  return parseHlsMaster(body, res.url || url)
}

/** The kit's text tracks for an HLS source: `fetchHlsMaster` → `textTracksFromHls`; [] for a media playlist. */
export async function loadHlsTextTracks(url: string, opts?: HlsLoadOptions): Promise<TextTrack[]> {
  const master = await fetchHlsMaster(url, opts)
  return master ? textTracksFromHls(master) : []
}

/**
 * The one-release bridge for the retired `source.headers['x-kit-text-urls']` map. `{}` when absent.
 * When present: one `console.warn` per process, then JSON.parse; a malformed value yields `{}` rather than
 * throwing inside an adapter callback, which is what it used to do. Entries are merged *after* the
 * manifest-derived tracks, so they override a manifest URL for the same id and add ids the manifest lacks.
 */
export function deprecatedTextUrls(headers: Record<string, string> | undefined): Record<string, string> {
  const raw = headers?.[DEPRECATED_TEXT_URLS_HEADER]
  if (!raw) return {}
  deprecateOnce(`source.headers['${DEPRECATED_TEXT_URLS_HEADER}']`, DEPRECATION_DOCS)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

/** Resolve an HLS subtitle media playlist to concatenated WebVTT (segments joined; headers de-duplicated). */
export async function fetchHlsVtt(url: string): Promise<string> {
  const res = await fetch(url)
  const body = await res.text()
  if (/^WEBVTT/m.test(body) && !body.includes('#EXTM3U')) return body
  const base = url.slice(0, url.lastIndexOf('/') + 1)
  const segs = body.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => (/^https?:/.test(l) ? l : base + l))
  const parts = await Promise.all(segs.map((s) => fetch(s).then((r) => r.text())))
  return 'WEBVTT\n\n' + parts.map((p) => p.replace(/^WEBVTT[^\n]*\n(?:X-TIMESTAMP-MAP[^\n]*\n)?/m, '')).join('\n')
}
