import { fromShakaVariants, fromShakaText, fromRnvAudio, pickAudio, pickText, normalizeRoles } from '../src/core'

describe('tracks', () => {
  it('collapses Shaka variants to unique audio streams and maps description role', () => {
    const audio = fromShakaVariants([
      { id: 1, language: 'en', audioId: 10, audioRoles: ['main'], active: true },
      { id: 2, language: 'en', audioId: 10, audioRoles: ['main'], active: false }, // same audio, other video rendition
      { id: 3, language: 'en', audioId: 11, audioRoles: ['public.accessibility.describes-video'], active: false },
    ])
    expect(audio).toHaveLength(2)
    expect(audio[1]).toMatchObject({ id: '11', roles: ['description'], label: 'en – Audio description' })
  })
  it('maps text kinds', () => {
    const t = fromShakaText([{ id: 5, language: 'de', kind: 'subtitle', active: false }, { id: 6, language: 'en', roles: ['description'], active: false }])
    expect(t.map((x) => x.kind)).toEqual(['subtitles', 'descriptions'])
  })
  it('infers roles from ExoPlayer titles', () => {
    const a = fromRnvAudio([{ index: 0, language: 'en', title: 'English' }, { index: 1, language: 'en', title: 'English (Audio Description)' }])
    expect(a[1]!.roles).toEqual(['description'])
  })
  it('picks by role then language', () => {
    const tracks = fromRnvAudio([{ index: 0, language: 'en', title: 'English' }, { index: 1, language: 'de', title: 'Deutsch – Audiodeskription' }])
    expect(pickAudio(tracks, { role: 'description' })?.id).toBe('1')
    expect(pickAudio(tracks, { language: 'en' })?.id).toBe('0')
    expect(pickAudio(tracks, { role: 'commentary' })?.id).toBe('0') // falls back to main
  })
  it('orders text by preferred language list', () => {
    const t = fromShakaText([{ id: 1, language: 'en', active: false }, { id: 2, language: 'de', active: false }])
    expect(pickText(t, { languages: ['de', 'en'] }).map((x) => x.language)).toEqual(['de', 'en'])
  })
  it('treats an explicit empty kinds or languages array as "matches nothing"', () => {
    // An app says "captions off" by passing an empty array; returning every track instead would
    // stack every language and description on screen at once.
    const t = fromShakaText([
      { id: 1, language: 'en', kind: 'caption', active: false },
      { id: 2, language: 'de', kind: 'subtitle', active: false },
      { id: 3, language: 'en', roles: ['description'], active: false },
    ])
    expect(pickText(t, { kinds: [] })).toEqual([])
    expect(pickText(t, { languages: [] })).toEqual([])
    expect(pickText(t, { kinds: [], languages: ['en'] })).toEqual([])
    expect(pickText(t, { kinds: ['captions'], languages: [] })).toEqual([])
  })
  it('treats an omitted kinds or languages key as "any", and an omitted preference as no filter', () => {
    const t = fromShakaText([
      { id: 1, language: 'en', kind: 'caption', active: false },
      { id: 2, language: 'de', kind: 'subtitle', active: false },
      { id: 3, language: 'en', roles: ['description'], active: false },
    ])
    expect(pickText(t, { languages: ['en'] }).map((x) => x.id)).toEqual(['1', '3']) // any kind
    expect(pickText(t, { kinds: ['captions'] }).map((x) => x.id)).toEqual(['1']) // any language
    expect(pickText(t, {})).toEqual(t)
    // No preference filters nothing; KitPlayer guards the absent `preferredText` itself.
    expect(pickText(t, undefined)).toEqual(t)
  })
  it('defaults unknown roles to main', () => {
    expect(normalizeRoles(['weird'])).toEqual(['main'])
  })
})
