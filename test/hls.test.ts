import { readdirSync, readFileSync } from 'node:fs'
import {
  audioTracksFromHls,
  isMasterPlaylist,
  parseAttributeList,
  parseHlsMaster,
  resolveUrl,
  textTracksFromHls,
} from '../src/core'

const fx = (n: string) => readFileSync(new URL(`./fixtures/hls/${n}`, import.meta.url).pathname, 'utf8')

const APPLE_BASE = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8'
const APPLE_DIR = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4'
const SHAKA_BASE = 'https://cdn.example/spike/master.m3u8'
const ANGEL_BASE = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8'
const ANGEL_DIR = 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls'

describe('parseAttributeList', () => {
  it('splits comma-separated pairs and strips quotes', () => {
    expect(parseAttributeList('A=1,B="x",C=YES')).toEqual({ A: '1', B: 'x', C: 'YES' })
  })
  it('keeps commas inside a quoted value', () => {
    const a = parseAttributeList('CHARACTERISTICS="a,b",NAME="c"')
    expect(a.CHARACTERISTICS).toBe('a,b')
    expect(a.NAME).toBe('c')
  })
  it('lets the last duplicate attribute win', () => {
    expect(parseAttributeList('A=1,A=2').A).toBe('2')
    expect(parseAttributeList('NAME="first",NAME="last"').NAME).toBe('last')
  })
  it('returns an empty object for an empty string', () => {
    expect(parseAttributeList('')).toEqual({})
  })
})

// §4.6 — every row is also cross-checked against Node's WHATWG URL below.
const BASE = 'https://h/a/b/master.m3u8?t=1'
const RESOLVE_ROWS: Array<[string, string]> = [
  ['s1/en/prog_index.m3u8', 'https://h/a/b/s1/en/prog_index.m3u8'],
  ['./x.m3u8', 'https://h/a/b/x.m3u8'],
  ['../up/x.m3u8', 'https://h/a/up/x.m3u8'],
  ['/abs/x.m3u8', 'https://h/abs/x.m3u8'],
  ['//cdn.example/x.m3u8', 'https://cdn.example/x.m3u8'],
  ['https://other/x.m3u8', 'https://other/x.m3u8'],
  ['x.m3u8?k=v', 'https://h/a/b/x.m3u8?k=v'],
]

describe('resolveUrl', () => {
  it('resolves relative, dot, dot-dot, absolute-path, protocol-relative and absolute references', () => {
    for (const [ref, want] of RESOLVE_ROWS) expect(resolveUrl(BASE, ref)).toBe(want)
  })
  it('agrees with the WHATWG URL reference implementation for every row', () => {
    // React Native's URL polyfill concatenates instead of resolving (plan R1); Node's is the reference.
    for (const [ref] of RESOLVE_ROWS) expect(resolveUrl(BASE, ref)).toBe(new URL(ref, BASE).href)
  })
  it('drops the base query and keeps the reference query', () => {
    expect(resolveUrl(BASE, 'x.m3u8')).toBe('https://h/a/b/x.m3u8')
    expect(resolveUrl(BASE, 'x.m3u8?k=v')).toBe('https://h/a/b/x.m3u8?k=v')
  })
})

describe('isMasterPlaylist', () => {
  it('is true for the Apple and Shaka Packager masters', () => {
    expect(isMasterPlaylist(fx('apple-bipbop-adv-master.m3u8'))).toBe(true)
    expect(isMasterPlaylist(fx('shaka-packager-master.m3u8'))).toBe(true)
  })
  it('is false for a media playlist with #EXTINF', () => {
    expect(isMasterPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg.vtt\n')).toBe(false)
  })
})

describe('parseHlsMaster — errors and tolerance', () => {
  it('throws when the first line is not #EXTM3U', () => {
    expect(() => parseHlsMaster('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n')).toThrow(/EXTM3U/)
  })
  it('accepts CRLF line endings and a leading BOM', () => {
    const lf = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t",NAME="English",LANGUAGE="en",URI="s/en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n'
    const crlf = `﻿${lf.replace(/\n/g, '\r\n')}`
    expect(parseHlsMaster(crlf)).toEqual(parseHlsMaster(lf))
    expect(parseHlsMaster(crlf).renditions[0]!.uri).toBe('s/en.m3u8')
  })
  it('ignores comments, blank lines, I-frame stream tags and unknown tags', () => {
    const m = parseHlsMaster(
      [
        '#EXTM3U',
        '## Generated with https://github.com/shaka-project/shaka-packager version v3.4.2-release',
        '',
        '#EXT-X-SESSION-DATA:DATA-ID="com.example.title",VALUE="Big Buck Bunny"',
        '#EXT-X-START:TIME-OFFSET=0',
        '',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t",NAME="English",LANGUAGE="en",URI="s/en.m3u8"',
        '',
        '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=187492,CODECS="avc1.64002a",URI="i.m3u8"',
        '',
        '#EXT-X-STREAM-INF:BANDWIDTH=1200000,SUBTITLES="t"',
        'v.m3u8',
        '',
      ].join('\n'),
    )
    expect(m.variants.map((v) => v.uri)).toEqual(['v.m3u8'])
    expect(m.renditions).toHaveLength(1)
    expect(m.renditions[0]!.name).toBe('English')
  })
  it('drops a STREAM-INF with no URI line before the next tag or EOF', () => {
    const m = parseHlsMaster(
      [
        '#EXTM3U',
        // A tag arrives first, so BANDWIDTH=1 is dropped and the stray URI line below attaches to nothing.
        '#EXT-X-STREAM-INF:BANDWIDTH=1',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t",NAME="English",LANGUAGE="en",URI="s/en.m3u8"',
        'orphan.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=2',
        'real.m3u8',
        // EOF arrives first, so BANDWIDTH=3 is dropped too.
        '#EXT-X-STREAM-INF:BANDWIDTH=3',
      ].join('\n'),
    )
    expect(m.variants).toHaveLength(1)
    expect(m.variants[0]).toMatchObject({ uri: 'real.m3u8', bandwidth: 2 })
  })
  it('parses FORCED=YES, AUTOSELECT=NO and TYPE=VIDEO renditions', () => {
    const m = parseHlsMaster(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t",NAME="English (Forced)",LANGUAGE="en",FORCED=YES,AUTOSELECT=NO,URI="s/forced.m3u8"',
        '#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="v",NAME="Angle 2",URI="v2.m3u8"',
      ].join('\n'),
    )
    expect(m.renditions[0]).toMatchObject({ type: 'SUBTITLES', forced: true, autoselect: false, default: false })
    expect(m.renditions[1]).toMatchObject({ type: 'VIDEO', groupId: 'v', name: 'Angle 2' })
    expect(m.renditions.map((r) => r.type)).toEqual(['SUBTITLES', 'VIDEO'])
  })
  it('skips an EXT-X-MEDIA tag with an unknown or missing TYPE', () => {
    const m = parseHlsMaster(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=THUMBNAILS,GROUP-ID="th",NAME="Thumbs",URI="th.m3u8"',
        '#EXT-X-MEDIA:GROUP-ID="t",NAME="English",URI="s/en.m3u8"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t",NAME="English",URI="s/en.m3u8"',
      ].join('\n'),
    )
    expect(m.renditions).toHaveLength(1)
    expect(m.renditions[0]!.type).toBe('SUBTITLES')
  })
  it('leaves URIs as written when no baseUrl is given and leaves {$var} literal', () => {
    const m = parseHlsMaster(
      [
        '#EXTM3U',
        '#EXT-X-DEFINE:NAME="host",VALUE="cdn.example"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t",NAME="English",LANGUAGE="en",URI="{$host}/s/en.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1',
        '../v.m3u8',
      ].join('\n'),
    )
    expect(m.renditions[0]!.uri).toBe('{$host}/s/en.m3u8')
    expect(m.variants[0]!.uri).toBe('../v.m3u8')
  })
})

describe('parseHlsMaster — Apple bipbop advanced (fixture)', () => {
  const m = parseHlsMaster(fx('apple-bipbop-adv-master.m3u8'), APPLE_BASE)

  it('reads version 6 and independent segments', () => {
    expect(m.version).toBe(6)
    expect(m.independentSegments).toBe(true)
  })
  it('finds 24 variants and no I-frame variants', () => {
    expect(m.variants).toHaveLength(24)
    expect(m.variants.some((v) => v.uri.includes('iframe_index'))).toBe(false)
  })
  it("reads the first variant's bandwidths, codecs, resolution and group references", () => {
    expect(m.variants[0]).toMatchObject({
      bandwidth: 2177116,
      averageBandwidth: 2168183,
      codecs: ['avc1.640020', 'mp4a.40.2'],
      resolution: { width: 960, height: 540 },
      audio: 'aud1',
      subtitles: 'sub1',
      closedCaptions: 'cc1',
      uri: `${APPLE_DIR}/v5/prog_index.m3u8`,
    })
  })
  it('finds renditions declared after the variants: 3 AUDIO, 1 CLOSED-CAPTIONS, 1 SUBTITLES', () => {
    const byType = (t: string) => m.renditions.filter((r) => r.type === t)
    expect(byType('AUDIO')).toHaveLength(3)
    expect(byType('CLOSED-CAPTIONS')).toHaveLength(1)
    expect(byType('SUBTITLES')).toHaveLength(1)
    expect(m.renditions).toHaveLength(5)
  })
  it("reads the audio renditions' group ids, channels and default flags", () => {
    const audio = m.renditions.filter((r) => r.type === 'AUDIO')
    expect(audio.map((r) => r.groupId)).toEqual(['aud1', 'aud2', 'aud3'])
    expect(audio.map((r) => r.channels)).toEqual(['2', '6', '6'])
    expect(audio.every((r) => r.default && r.autoselect)).toBe(true)
    expect(audio.every((r) => r.language === 'en' && r.name === 'English')).toBe(true)
  })
  it('reads the closed-captions rendition with INSTREAM-ID and no URI', () => {
    const cc = m.renditions.find((r) => r.type === 'CLOSED-CAPTIONS')!
    expect(cc.instreamId).toBe('CC1')
    expect(cc.uri).toBeUndefined()
  })
  it('resolves the subtitles URI against the master URL', () => {
    const sub = m.renditions.find((r) => r.type === 'SUBTITLES')!
    expect(sub.uri).toBe(`${APPLE_DIR}/s1/en/prog_index.m3u8`)
    expect(sub.forced).toBe(false)
    expect(sub.default).toBe(true)
  })
})

describe('parseHlsMaster — Shaka Packager, two audio renditions and three text tracks (fixture)', () => {
  const m = parseHlsMaster(fx('shaka-packager-master.m3u8'), SHAKA_BASE)

  it('finds 2 AUDIO and 3 SUBTITLES renditions declared before the variants', () => {
    expect(m.renditions.filter((r) => r.type === 'AUDIO')).toHaveLength(2)
    expect(m.renditions.filter((r) => r.type === 'SUBTITLES')).toHaveLength(3)
    expect(m.variants).toHaveLength(1)
  })
  it('splits a quoted CHARACTERISTICS value containing a comma into two UTIs', () => {
    const rich = m.renditions.find((r) => r.name === 'Rich captions')!
    expect(rich.characteristics).toEqual([
      'public.accessibility.transcribes-spoken-dialog',
      'public.accessibility.describes-music-and-sound',
    ])
  })
  it('reads DEFAULT=NO explicitly as false', () => {
    expect(m.renditions.find((r) => r.name === 'Original')!.default).toBe(true)
    expect(m.renditions.find((r) => r.name === 'Audio description')!.default).toBe(false)
    expect(m.renditions.find((r) => r.name === 'Rich captions')!.default).toBe(false)
  })
  it('resolves every URI to a sibling of the master', () => {
    expect(m.renditions.map((r) => r.uri)).toEqual([
      'https://cdn.example/spike/audio_main.m3u8',
      'https://cdn.example/spike/audio_ad.m3u8',
      'https://cdn.example/spike/captions.m3u8',
      'https://cdn.example/spike/sdh.m3u8',
      'https://cdn.example/spike/descriptions.m3u8',
    ])
    expect(m.variants[0]!.uri).toBe('https://cdn.example/spike/video.m3u8')
  })
})

describe('parseHlsMaster — Angel One, Shaka Packager v2.3.0 (fixture)', () => {
  const m = parseHlsMaster(fx('angel-one-master.m3u8'), ANGEL_BASE)

  it('ignores the "## Generated with" comment line', () => {
    expect(fx('angel-one-master.m3u8')).toContain('## Generated with')
    expect(m.variants.some((v) => v.uri.startsWith('#'))).toBe(false)
    expect(m.renditions.some((r) => r.name.startsWith('#'))).toBe(false)
  })
  it('finds 6 AUDIO renditions, 4 SUBTITLES renditions and 5 variants', () => {
    expect(m.renditions.filter((r) => r.type === 'AUDIO')).toHaveLength(6)
    expect(m.renditions.filter((r) => r.type === 'SUBTITLES')).toHaveLength(4)
    expect(m.variants).toHaveLength(5)
  })
  it('treats an absent DEFAULT as false and preserves pt-BR as written', () => {
    const text = m.renditions.filter((r) => r.type === 'SUBTITLES')
    expect(text.map((r) => r.default)).toEqual([true, false, false, false])
    expect(text[3]!.language).toBe('pt-BR')
  })
})

describe('textTracksFromHls', () => {
  it('Apple: yields one subtitles track with url, label English, language en, inactive, and excludes closed captions', () => {
    const t = textTracksFromHls(parseHlsMaster(fx('apple-bipbop-adv-master.m3u8'), APPLE_BASE))
    expect(t).toEqual([
      {
        id: '0',
        language: 'en',
        label: 'English',
        kind: 'subtitles',
        active: false,
        url: `${APPLE_DIR}/s1/en/prog_index.m3u8`,
      },
    ])
  })
  it('Shaka Packager: maps kinds from CHARACTERISTICS and falls back to NAME', () => {
    const t = textTracksFromHls(parseHlsMaster(fx('shaka-packager-master.m3u8'), SHAKA_BASE))
    expect(t.map((x) => x.id)).toEqual(['0', '1', '2'])
    expect(t.map((x) => x.kind)).toEqual(['captions', 'captions', 'descriptions'])
    expect(t.map((x) => x.label)).toEqual(['Captions', 'Rich captions', 'Description text'])
    expect(t.every((x) => typeof x.url === 'string' && x.url.length > 0)).toBe(true)
    expect(t.every((x) => x.active === false)).toBe(true)
  })
  it("Angel One: yields four tracks whose urls match the runbook's TEXT_URLS", () => {
    const t = textTracksFromHls(parseHlsMaster(fx('angel-one-master.m3u8'), ANGEL_BASE))
    expect(t).toHaveLength(4)
    expect(t[0]!.url).toBe(`${ANGEL_DIR}/playlist_s-en.webvtt.m3u8`)
    expect(t[2]!.url).toBe(`${ANGEL_DIR}/playlist_s-fr.webvtt.m3u8`)
  })
  it('never marks a text track active, even for DEFAULT=YES', () => {
    // docs/decisions/0003 — text stays off until the app or preferredText asks for it.
    for (const n of ['apple-bipbop-adv-master.m3u8', 'shaka-packager-master.m3u8', 'angel-one-master.m3u8']) {
      const master = parseHlsMaster(fx(n), SHAKA_BASE)
      expect(master.renditions.some((r) => r.type === 'SUBTITLES' && r.default)).toBe(true)
      expect(textTracksFromHls(master).every((t) => t.active === false)).toBe(true)
    }
  })
  it('skips SUBTITLES renditions without a URI and de-duplicates identical URIs', () => {
    const m = parseHlsMaster(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t1",NAME="English",LANGUAGE="en"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t1",NAME="English",LANGUAGE="en",URI="s/en.m3u8"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t2",NAME="English",LANGUAGE="en",URI="s/en.m3u8"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t1",NAME="Deutsch",LANGUAGE="de",URI="s/de.m3u8"',
      ].join('\n'),
      SHAKA_BASE,
    )
    const t = textTracksFromHls(m)
    expect(t.map((x) => x.url)).toEqual(['https://cdn.example/spike/s/en.m3u8', 'https://cdn.example/spike/s/de.m3u8'])
    expect(t.map((x) => x.id)).toEqual(['0', '1'])
  })
  it('defaults language to und and label to "<lang> – <kind>" when LANGUAGE and NAME are missing', () => {
    const m = parseHlsMaster('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="t",URI="s/x.m3u8"\n')
    expect(textTracksFromHls(m)[0]).toEqual({
      id: '0',
      language: 'und',
      label: 'und – subtitles',
      kind: 'subtitles',
      active: false,
      url: 's/x.m3u8',
    })
  })
})

describe('audioTracksFromHls', () => {
  it('Shaka Packager: yields main and description roles from CHARACTERISTICS', () => {
    const a = audioTracksFromHls(parseHlsMaster(fx('shaka-packager-master.m3u8'), SHAKA_BASE))
    expect(a).toEqual([
      { id: '0', language: 'en', label: 'Original', roles: ['main'], active: true },
      { id: '1', language: 'en', label: 'Audio description', roles: ['description'], active: false },
    ])
  })
  it('Apple: yields three English tracks, all main, all active, without de-duplicating', () => {
    const a = audioTracksFromHls(parseHlsMaster(fx('apple-bipbop-adv-master.m3u8'), APPLE_BASE))
    expect(a).toHaveLength(3)
    expect(a.map((x) => x.id)).toEqual(['0', '1', '2'])
    expect(a.every((x) => x.label === 'English' && x.language === 'en' && x.active)).toBe(true)
    expect(a.every((x) => x.roles.length === 1 && x.roles[0] === 'main')).toBe(true)
  })
  it('Angel One: preserves playlist order and languages en,de,it,fr,es,en', () => {
    const a = audioTracksFromHls(parseHlsMaster(fx('angel-one-master.m3u8'), ANGEL_BASE))
    expect(a.map((x) => x.language)).toEqual(['en', 'de', 'it', 'fr', 'es', 'en'])
    expect(a.map((x) => x.active)).toEqual([true, false, false, false, false, false])
  })
})

describe('core stays free of React Native', () => {
  it('src/core/*.ts imports nothing from react or react-native', () => {
    const dir = new URL('../src/core/', import.meta.url).pathname
    const files = readdirSync(dir).filter((n) => n.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      expect(readFileSync(dir + f, 'utf8')).not.toMatch(/from ['"]react(-native)?['"]/)
    }
  })
})
