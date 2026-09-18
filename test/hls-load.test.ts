import { readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url' // node's URL, so fileURLToPath accepts it under lib.dom
import { DEPRECATION_DOCS } from '../src/platform/log'
import type { HlsFetch } from '../src/player/hls'
import { deprecatedTextUrls, fetchHlsMaster, fetchHlsVtt, loadHlsTextTracks } from '../src/player/hls'

const fx = (n: string) => readFileSync(new URL(`./fixtures/hls/${n}`, import.meta.url).pathname, 'utf8')
const src = (p: string) => readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8')

const MASTER = 'https://cdn.example/x/master.m3u8'

type Call = { url: string; headers?: Record<string, string> }

/**
 * A structural `fetch` stub: bodies keyed by URL, an optional rewrite of the response's `url` (a redirect,
 * or the empty string some RN fetch implementations return), and the calls it saw. No network, no Response.
 */
function stub(bodies: Record<string, string>, finalUrl?: (u: string) => string): HlsFetch & { calls: Call[] } {
  const calls: Call[] = []
  const fn: HlsFetch = async (url, init) => {
    calls.push({ url, headers: init?.headers })
    const body = bodies[url]
    const status = body === undefined ? 404 : 200
    return {
      ok: status === 200,
      status,
      url: finalUrl ? finalUrl(url) : url,
      text: async () => body ?? 'Not found',
    }
  }
  return Object.assign(fn, { calls })
}

describe('fetchHlsMaster / loadHlsTextTracks', () => {
  it('fetches, parses and resolves URIs against the request URL', async () => {
    const fetch = stub({ [MASTER]: fx('apple-bipbop-adv-master.m3u8') })
    const master = await fetchHlsMaster(MASTER, { fetch })
    expect(master?.variants).toHaveLength(24)
    expect(fetch.calls.map((c) => c.url)).toEqual([MASTER])

    const text = await loadHlsTextTracks(MASTER, { fetch: stub({ [MASTER]: fx('apple-bipbop-adv-master.m3u8') }) })
    expect(text).toEqual([
      { id: '0', language: 'en', label: 'English', kind: 'subtitles', active: false, url: 'https://cdn.example/x/s1/en/prog_index.m3u8' },
    ])
  })

  it('resolves URIs against the final response URL after a redirect', async () => {
    const fetch = stub({ [MASTER]: fx('apple-bipbop-adv-master.m3u8') }, () => 'https://cdn.example/moved/master.m3u8')
    const text = await loadHlsTextTracks(MASTER, { fetch })
    expect(text[0]?.url).toBe('https://cdn.example/moved/s1/en/prog_index.m3u8')
  })

  it('falls back to the request URL when the response url is empty', async () => {
    const fetch = stub({ [MASTER]: fx('apple-bipbop-adv-master.m3u8') }, () => '')
    const text = await loadHlsTextTracks(MASTER, { fetch })
    expect(text[0]?.url).toBe('https://cdn.example/x/s1/en/prog_index.m3u8')
  })

  it('returns [] for a media playlist instead of throwing', async () => {
    const fetch = stub({ [MASTER]: '#EXTM3U\n#EXTINF:4,\nseg.vtt\n' })
    await expect(fetchHlsMaster(MASTER, { fetch })).resolves.toBeNull()
    await expect(loadHlsTextTracks(MASTER, { fetch })).resolves.toEqual([])
  })

  it('throws with the status on a non-2xx response', async () => {
    const fetch = stub({})
    await expect(fetchHlsMaster(MASTER, { fetch })).rejects.toThrow(/404/)
    await expect(loadHlsTextTracks(MASTER, { fetch })).rejects.toThrow(/404/)
  })

  it('throws on a body that is not a playlist at all', async () => {
    const fetch = stub({ [MASTER]: '<!doctype html><title>Access denied</title>' })
    await expect(fetchHlsMaster(MASTER, { fetch })).rejects.toThrow(/EXTM3U/)
  })

  it('forwards caller headers but never the deprecated x-kit-text-urls header', async () => {
    const fetch = stub({ [MASTER]: fx('angel-one-master.m3u8') })
    await loadHlsTextTracks(MASTER, {
      fetch,
      headers: { authorization: 'Bearer t', 'x-kit-text-urls': '{"captions-en":"https://cdn.example/x/c.m3u8"}' },
    })
    expect(fetch.calls[0]?.headers).toBeDefined()
    expect(fetch.calls[0]?.headers?.authorization).toBe('Bearer t')
    expect(fetch.calls[0]?.headers).not.toHaveProperty('x-kit-text-urls')
  })

  it('uses globalThis.fetch when no fetch is injected', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url)
      return { ok: true, status: 200, url, text: async () => fx('angel-one-master.m3u8') }
    })
    try {
      const text = await loadHlsTextTracks(MASTER)
      expect(seen).toEqual([MASTER])
      expect(text).toHaveLength(4)
      expect(text[0]?.url).toBe('https://cdn.example/x/playlist_s-en.webvtt.m3u8')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('deprecatedTextUrls', () => {
  // Order matters: `deprecateOnce` keeps a module-level Set, so the "warns nothing" case runs first
  // and the "warns once" case is the only one that may see a fresh key.
  let warnings: string[]
  let realWarn: typeof console.warn

  beforeEach(() => {
    warnings = []
    realWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')) }
  })
  afterEach(() => { console.warn = realWarn })

  it('returns {} when the header is absent and warns nothing', () => {
    expect(deprecatedTextUrls(undefined)).toEqual({})
    expect(deprecatedTextUrls({})).toEqual({})
    expect(deprecatedTextUrls({ authorization: 'Bearer t' })).toEqual({})
    expect(warnings).toEqual([])
  })

  it('parses the JSON map and warns exactly once across calls', () => {
    const headers = { 'x-kit-text-urls': '{"captions-en":"https://cdn.example/c.m3u8","ad":"https://cdn.example/ad.m3u8"}' }
    expect(deprecatedTextUrls(headers)).toEqual({
      'captions-en': 'https://cdn.example/c.m3u8',
      ad: 'https://cdn.example/ad.m3u8',
    })
    expect(deprecatedTextUrls(headers)).toEqual({
      'captions-en': 'https://cdn.example/c.m3u8',
      ad: 'https://cdn.example/ad.m3u8',
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0] ?? '').toContain('x-kit-text-urls')
    expect(warnings[0] ?? '').toContain('deprecated')
    expect(warnings[0] ?? '').toContain(DEPRECATION_DOCS)
  })

  it('returns {} for malformed JSON instead of throwing', () => {
    expect(() => deprecatedTextUrls({ 'x-kit-text-urls': 'not json' })).not.toThrow()
    expect(deprecatedTextUrls({ 'x-kit-text-urls': 'not json' })).toEqual({})
    expect(deprecatedTextUrls({ 'x-kit-text-urls': '"a string"' })).toEqual({})
    expect(deprecatedTextUrls({ 'x-kit-text-urls': 'null' })).toEqual({})
  })
})

/**
 * PINS, WRITTEN BEFORE THE MOVE. `fetchHlsVtt` is public API; these assertions ran green against the body
 * in `adapters/fireos.tsx` and must stay green against the identical body in `src/player/hls.ts`.
 * They pin today's behaviour, including the parts the plan calls wrong (§9 Q5: segment URLs are `base + line`,
 * so `/abs` and `../` segments resolve incorrectly). Do not "fix" them here.
 */
describe('fetchHlsVtt (moved, behaviour pinned)', () => {
  const VTT_URL = 'https://cdn.example/x/s1/en/prog_index.m3u8'

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns a bare WebVTT body unchanged', async () => {
    const body = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n'
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url)
      return { text: async () => body }
    })
    expect(await fetchHlsVtt(VTT_URL)).toBe(body)
    expect(seen).toEqual([VTT_URL]) // no segment requests
  })

  it('joins media-playlist segments with one WEBVTT header and drops per-segment X-TIMESTAMP-MAP lines', async () => {
    const cue0 = '00:00:01.000 --> 00:00:04.000\nFirst'
    const cue1 = '00:00:05.000 --> 00:00:08.000\nSecond'
    const seg = (c: string) => `WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n${c}`
    const bodies: Record<string, string> = {
      [VTT_URL]: '#EXTM3U\n#EXTINF:4,\n0.vtt\n#EXTINF:4,\n1.vtt\n',
      'https://cdn.example/x/s1/en/0.vtt': seg(cue0),
      'https://cdn.example/x/s1/en/1.vtt': seg(cue1),
    }
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url)
      return { text: async () => bodies[url] ?? '' }
    })

    const out = await fetchHlsVtt(VTT_URL)
    // Segment URLs are `base + line` — the playlist's own directory. (§9 Q5 keeps this as-is.)
    expect(seen).toEqual([VTT_URL, 'https://cdn.example/x/s1/en/0.vtt', 'https://cdn.example/x/s1/en/1.vtt'])
    // One header for the whole body; each segment loses `WEBVTT` + its `X-TIMESTAMP-MAP` line but keeps the
    // blank line that followed them, so every segment contributes a leading newline. Pinned, not endorsed.
    expect(out).toBe(`WEBVTT\n\n\n${cue0}\n\n${cue1}`)
    expect(out.match(/WEBVTT/g)).toHaveLength(1)
    expect(out).not.toContain('X-TIMESTAMP-MAP')
    expect(out).toContain(cue0)
    expect(out).toContain(cue1)
  })

  it('leaves an absolute segment URL alone instead of prefixing the playlist directory', async () => {
    const bodies: Record<string, string> = {
      [VTT_URL]: '#EXTM3U\n#EXTINF:4,\nhttps://other.example/0.vtt\n',
      'https://other.example/0.vtt': 'WEBVTT\n\nA',
    }
    const seen: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url)
      return { text: async () => bodies[url] ?? '' }
    })
    await fetchHlsVtt(VTT_URL)
    expect(seen).toEqual([VTT_URL, 'https://other.example/0.vtt'])
  })
})

/** Source guards, same spirit as test/selection.test.ts "KitPlayer wiring": wiring no unit test can reach. The web adapter's equivalents are behavioural — harness/e2e/player.spec.ts renders the real adapter in Chromium (KIT-005). */
describe('adapter wiring', () => {
  const fireos = () => src('player/adapters/fireos.tsx')
  const web = () => src('player/adapters/web.tsx')

  it('fireos and web derive text tracks through loadHlsTextTracks', () => {
    expect(fireos().match(/loadHlsTextTracks\(/g)).toHaveLength(1)
    expect(web().match(/loadHlsTextTracks\(/g)).toHaveLength(1)
  })

  it('fireos and web read the header only through deprecatedTextUrls', () => {
    expect(fireos().match(/deprecatedTextUrls\(/g)).toHaveLength(1)
    expect(web().match(/deprecatedTextUrls\(/g)).toHaveLength(1)
    // The header name itself belongs to src/player/hls.ts (DEPRECATED_TEXT_URLS_HEADER) and nowhere else.
    expect(fireos()).not.toContain('x-kit-text-urls')
    expect(web()).not.toContain('x-kit-text-urls')
    expect(fireos()).not.toMatch(/JSON\.parse\(/)
    expect(web()).not.toMatch(/JSON\.parse\(/)
  })

  it('fetchHlsVtt is defined in src/player/hls.ts and no longer in the Fire OS adapter', () => {
    expect(src('player/hls.ts')).toMatch(/function fetchHlsVtt/)
    expect(fireos()).not.toMatch(/function fetchHlsVtt/)
    expect(src('player/index.ts')).toMatch(/from '\.\/hls'/)
    expect(src('player/index.ts')).not.toMatch(/fetchHlsVtt.*adapters\/fireos/)
  })

  it('the Fire OS adapter publishes tracks only after the manifest promise is awaited', () => {
    const s = fireos()
    // KitPlayer's `appliedPrefs` latches on the FIRST onTracks call, so an onTracks with manifest-less
    // tracks would permanently prevent `preferredText` from being applied (plan §4.7 step 3, R2).
    const awaited = s.indexOf('await hlsText.current')
    const published = s.indexOf('props.onTracks?.(')
    expect(awaited).toBeGreaterThan(-1)
    expect(published).toBeGreaterThan(-1)
    expect(awaited).toBeLessThan(published)
    expect(s.match(/props\.onTracks\?\.\(/g)).toHaveLength(1)
  })

  it('no TODO(spike KIT-001) remains in the Fire OS adapter', () => {
    expect(fireos()).not.toContain('TODO(spike KIT-001)')
  })

  // The guard below exists because mutation-testing this file found the deprecated header's *merge
  // semantics* unprotected on Fire OS: dropping the override left every test green. It is adapter-internal
  // and only observable through a rendered component, so — as with the ordering guard above — the check is
  // structural. Crude, but it fails when the contract is broken. The web adapter's merge is asserted by
  // `player.spec.ts › 'deprecated x-kit-text-urls still adds ids …'`.
  it('the Fire OS adapter writes the url map once, and that write is the header override', () => {
    const s = fireos()
    // Manifest URLs build the map; the deprecated header is merged *after* it, so an entry overrides a
    // manifest URL for the same id (docs/decisions/0004). A second write to the map would undo that.
    expect(s.match(/urls\.set\(/g)).toHaveLength(1)
    expect(s).toMatch(/Object\.entries\(deprecatedTextUrls\([^)]*\)\)\)\s*urls\.set\(/)
  })
})
