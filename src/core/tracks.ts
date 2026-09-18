import type { AudioRole, AudioTrack, TextKind, TextTrack } from './types'

/** Shaka `player.getVariantTracks()` / `getTextTracks()` shapes (subset). */
export interface ShakaVariantTrack {
  id: number
  language: string
  label?: string | null
  roles?: string[]
  audioRoles?: string[] | null
  active: boolean
  audioId?: number | null
}
export interface ShakaTextTrack {
  id: number
  language: string
  label?: string | null
  kind?: string | null
  roles?: string[]
  active: boolean
}

/** react-native-video `onLoad` payload shapes (subset). */
export interface RnvAudioTrack { index: number; title?: string; language?: string; type?: string; selected?: boolean }
export interface RnvTextTrack { index: number; title?: string; language?: string; type?: string; selected?: boolean }

const roleMap: Record<string, AudioRole> = {
  main: 'main',
  description: 'description',
  'public.accessibility.describes-video': 'description',
  commentary: 'commentary',
  alternate: 'alternate',
  alternative: 'alternate',
}

export function normalizeRoles(roles: readonly string[] | null | undefined): AudioRole[] {
  const out = new Set<AudioRole>()
  for (const r of roles ?? []) {
    const k = roleMap[r.toLowerCase()]
    if (k) out.add(k)
  }
  if (out.size === 0) out.add('main')
  return [...out]
}

export function labelFor(language: string, roles: AudioRole[], label?: string | null): string {
  if (label && label.trim()) return label.trim()
  const lang = language || 'und'
  const suffix = roles.includes('description') ? ' – Audio description' : roles.includes('commentary') ? ' – Commentary' : ''
  return `${lang}${suffix}`
}

/** Shaka exposes one variant per (audio × video) combination; collapse to unique audio streams. */
export function fromShakaVariants(variants: ShakaVariantTrack[]): AudioTrack[] {
  const seen = new Map<string, AudioTrack>()
  for (const v of variants) {
    const roles = normalizeRoles(v.audioRoles ?? v.roles)
    const key = `${v.language}|${roles.join(',')}|${v.audioId ?? v.label ?? ''}`
    const existing = seen.get(key)
    if (existing) {
      existing.active = existing.active || v.active
      continue
    }
    seen.set(key, {
      id: String(v.audioId ?? v.id),
      language: v.language,
      label: labelFor(v.language, roles, v.label),
      roles,
      active: v.active,
    })
  }
  return [...seen.values()]
}

const textKindMap: Record<string, TextKind> = {
  subtitle: 'subtitles', subtitles: 'subtitles', caption: 'captions', captions: 'captions',
  description: 'descriptions', descriptions: 'descriptions', metadata: 'metadata',
  // HLS CHARACTERISTICS surface from Shaka as roles.
  'public.accessibility.describes-video': 'descriptions',
  'public.accessibility.transcribes-spoken-dialog': 'captions',
  'public.accessibility.describes-music-and-sound': 'captions',
}

/** Same title heuristic as `fromRnvText`, for tracks whose manifest carries no role/kind. */
export const textKindFromLabel = (label: string): TextKind | undefined =>
  /descri|deskri/i.test(label) ? 'descriptions' : /caption|sdh/i.test(label) ? 'captions' : undefined

/** First CHARACTERISTICS / Shaka role that maps to a `TextKind`, else undefined. */
export function textKindFromRoles(roles: readonly string[] | null | undefined): TextKind | undefined {
  return (roles ?? []).map((r) => textKindMap[r.toLowerCase()]).find(Boolean)
}

export function fromShakaText(tracks: ShakaTextTrack[]): TextTrack[] {
  return tracks.map((t) => {
    const roleKind = textKindFromRoles(t.roles)
    const kind: TextKind = roleKind ?? textKindMap[(t.kind ?? '').toLowerCase()] ?? textKindFromLabel(t.label ?? '') ?? 'subtitles'
    return { id: String(t.id), language: t.language, label: t.label?.trim() || `${t.language || 'und'} – ${kind}`, kind, active: t.active }
  })
}

export function fromRnvAudio(tracks: RnvAudioTrack[]): AudioTrack[] {
  return tracks.map((t) => {
    const title = t.title ?? ''
    const roles: AudioRole[] = /descri|deskri|\bAD\b/i.test(title) ? ['description'] : /comment/i.test(title) ? ['commentary'] : ['main']
    return { id: String(t.index), language: t.language ?? 'und', label: labelFor(t.language ?? 'und', roles, title), roles, active: !!t.selected }
  })
}

export function fromRnvText(tracks: RnvTextTrack[]): TextTrack[] {
  return tracks.map((t) => {
    const title = t.title ?? ''
    const kind: TextKind = /descri|deskri/i.test(title) ? 'descriptions' : /caption|sdh/i.test(title) ? 'captions' : 'subtitles'
    return { id: String(t.index), language: t.language ?? 'und', label: title || `${t.language ?? 'und'} – ${kind}`, kind, active: !!t.selected }
  })
}

/** Choose an audio track by preference; falls back to the first 'main' track, then the first track. */
export function pickAudio(tracks: AudioTrack[], pref?: { language?: string; role?: AudioRole }): AudioTrack | undefined {
  const byRole = pref?.role ? tracks.filter((t) => t.roles.includes(pref.role!)) : tracks
  const byLang = pref?.language ? byRole.filter((t) => t.language.toLowerCase().startsWith(pref.language!.toLowerCase())) : byRole
  return byLang[0] ?? byRole[0] ?? tracks.find((t) => t.roles.includes('main')) ?? tracks[0]
}

/**
 * Filter text tracks by preference, ordered by the caller's language list.
 *
 * An empty array is an explicit choice, not an absent one: `kinds: []` matches no kind and
 * `languages: []` matches no language, so either yields `[]` — that is how an app says "captions off".
 * An omitted key means "any": `{ languages: ['de'] }` still matches every kind, and `{ kinds: ['captions'] }`
 * every language. An omitted `pref` filters nothing and returns all tracks, so callers that must not
 * select anything without an explicit preference (KitPlayer's `preferredText` auto-selection) check for
 * the absent preference themselves rather than leaning on this.
 */
export function pickText(tracks: TextTrack[], pref?: { languages?: string[]; kinds?: TextKind[] }): TextTrack[] {
  let out = tracks
  if (pref?.kinds) out = out.filter((t) => pref.kinds!.includes(t.kind))
  if (pref?.languages) {
    const wanted = pref.languages.map((l) => l.toLowerCase())
    out = out.filter((t) => wanted.some((w) => t.language.toLowerCase().startsWith(w)))
    out.sort((a, b) => wanted.findIndex((w) => a.language.toLowerCase().startsWith(w)) - wanted.findIndex((w) => b.language.toLowerCase().startsWith(w)))
  }
  return out
}
