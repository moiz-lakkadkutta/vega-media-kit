import React, { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { Cue } from '../core'

/**
 * 10-foot caption overlay. Defaults follow the Netflix Timed Text Style Guide and Fire TV's safe zone:
 * 5% inset (96 px sides / 54 px top-bottom at 1080p), primary 44 px, ≤2 lines, boxed off-white text.
 * Sizes are in "px at 1920×1080"; pass `scale` = deviceWidth / 1920 (Fire OS renders at 960×540 dp → 0.5).
 */
export interface CueTheme {
  fontFamily?: string
  primaryColor: string
  secondaryColor: string
  boxColor: string
  primarySize: number
  secondarySize: number
  lineHeight: number
  paddingH: number
  paddingV: number
  radius: number
  /** Multiplier from the app's caption-size setting (100–200%). */
  userScale: number
}

export const defaultCueTheme: CueTheme = {
  primaryColor: '#F1F1F1',
  secondaryColor: 'rgba(241,241,241,0.72)',
  boxColor: 'rgba(0,0,0,0.65)',
  primarySize: 44,
  secondarySize: 32,
  lineHeight: 1.3,
  paddingH: 20,
  paddingV: 12,
  radius: 6,
  userScale: 1,
}

export interface CueOverlayProps {
  active: Cue[]
  /** Track id rendered large; all other tracks render as secondary lines above it. */
  primaryTrackId?: string
  theme?: Partial<CueTheme>
  /** deviceWidth / 1920. Default 0.5 (Fire OS dp). Vega apps typically pass 1. */
  scale?: number
  /** Word-level focus for language learning. Emits the word under focus. */
  selectable?: { focusedIndex: number | null; onFocusWord?(word: string, index: number): void }
  /** Hide secondary tracks (e.g. Lingo "Challenge" mode). */
  hideSecondary?: boolean
  safeInset?: { x: number; y: number }
  testID?: string
}

const INLINE_TAG = /(<\/?[ib]>)/g

function renderInline(text: string, base: object, key: string) {
  // Only <i> and <b> survive the parser; render them as nested Text.
  const parts = text.split(INLINE_TAG)
  let italic = false
  let bold = false
  const out: React.ReactNode[] = []
  parts.forEach((p, i) => {
    if (p === '<i>') italic = true
    else if (p === '</i>') italic = false
    else if (p === '<b>') bold = true
    else if (p === '</b>') bold = false
    else if (p) out.push(<Text key={`${key}-${i}`} style={[base, italic && { fontStyle: 'italic' }, bold && { fontWeight: '700' }]}>{p}</Text>)
  })
  return out
}

export function CueOverlay({ active, primaryTrackId, theme, scale = 0.5, selectable, hideSecondary, safeInset, testID }: CueOverlayProps) {
  const t = { ...defaultCueTheme, ...theme }
  const s = (n: number) => Math.round(n * scale * t.userScale)
  const inset = safeInset ?? { x: Math.round(96 * scale), y: Math.round(54 * scale) }

  const { primary, secondary, top } = useMemo(() => {
    const prim = active.filter((c) => (primaryTrackId ? c.trackId === primaryTrackId : true) && c.line !== 'top')
    const sec = primaryTrackId ? active.filter((c) => c.trackId !== primaryTrackId && c.line !== 'top') : []
    const topCues = active.filter((c) => c.line === 'top')
    return { primary: prim, secondary: sec, top: topCues }
  }, [active, primaryTrackId])

  const primaryStyle = { color: t.primaryColor, fontSize: s(t.primarySize), lineHeight: s(t.primarySize * t.lineHeight), fontFamily: t.fontFamily, textAlign: 'center' as const }
  const secondaryStyle = { color: t.secondaryColor, fontSize: s(t.secondarySize), lineHeight: s(t.secondarySize * t.lineHeight), fontFamily: t.fontFamily, textAlign: 'center' as const }

  const renderCue = (c: Cue, style: object, i: number) => {
    const label = c.speaker ? `[${c.speaker}] ` : ''
    const text = c.sound && !/^\[/.test(c.text) ? `[${c.text}]` : c.text
    if (selectable && style === primaryStyle) {
      const words = text.replace(/<[^>]+>/g, '').split(/(\s+)/)
      let wi = -1
      return (
        <Text key={`${c.trackId}:${c.id}`} style={style} accessibilityRole="text">
          {label}
          {words.map((w, k) => {
            if (/^\s+$/.test(w)) return <Text key={k}>{w}</Text>
            wi++
            const focused = selectable.focusedIndex === wi
            return (
              <Text key={k} style={focused ? styles.focusedWord : undefined} accessibilityLabel={w}>
                {w}
              </Text>
            )
          })}
        </Text>
      )
    }
    return (
      <Text key={`${c.trackId}:${c.id}-${i}`} style={style} numberOfLines={2} accessibilityRole="text">
        {label}
        {renderInline(text, style, `${c.trackId}:${c.id}`)}
      </Text>
    )
  }

  const box = (children: React.ReactNode, key: string) =>
    children ? (
      <View key={key} style={[styles.box, { backgroundColor: t.boxColor, paddingHorizontal: s(t.paddingH), paddingVertical: s(t.paddingV), borderRadius: s(t.radius) }]}>
        {children}
      </View>
    ) : null

  return (
    <View pointerEvents="none" style={[styles.root, { paddingHorizontal: inset.x, paddingVertical: inset.y }]} testID={testID}>
      <View style={styles.topArea}>{top.length ? box(top.map((c, i) => renderCue(c, primaryStyle, i)), 'top') : null}</View>
      <View style={styles.bottomArea}>
        {!hideSecondary && secondary.length ? box(secondary.map((c, i) => renderCue(c, secondaryStyle, i)), 'sec') : null}
        {primary.length ? box(primary.map((c, i) => renderCue(c, primaryStyle, i)), 'prim') : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'space-between' },
  topArea: { alignItems: 'center' },
  bottomArea: { alignItems: 'center', gap: 8 },
  box: { maxWidth: '86%', alignItems: 'center' },
  focusedWord: { textDecorationLine: 'underline', textDecorationStyle: 'solid' },
})
