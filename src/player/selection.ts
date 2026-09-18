import { pickText } from '../core'
import type { TextKind, TextTrack } from '../core'

/**
 * Text-track selection state, kept pure (and free of React / React Native) so it can be unit-tested in Node.
 * KitPlayer holds the selected ids in a ref and the scheduler holds one cue list per loaded track;
 * both the app-driven `selectText` and the `preferredText` auto-selection must move them together,
 * or fetched VTT for an auto-selected track is dropped before it ever reaches the scheduler.
 */
export interface TextSelection {
  /** The new selected set. More than one track on purpose (two languages; captions + descriptions). */
  selected: Set<string>
  /** Scheduler tracks that are no longer selected, whose cues must be dropped. */
  prune: string[]
}

/** Given the requested track ids and the scheduler's current tracks, the new selected set and what to prune. */
export function applyTextSelection(trackIds: readonly string[], schedulerTracks: readonly string[]): TextSelection {
  const selected = new Set(trackIds)
  return { selected, prune: schedulerTracks.filter((t) => !selected.has(t)) }
}

/**
 * Whether a `source` prop change is a source change. Matches what makes every adapter reload — `uri`, and
 * only `uri` (web.tsx / vega.tsx key their load effect on it; fireos passes it to <Video>). `headers` must
 * not count: a refreshing auth header would clear captions on every refresh. Structural parameter, not
 * `KitSource`, so this module stays independent of the React prop types (same reason as `TextPreference`).
 */
export function sourceChanged(prev: { uri: string }, next: { uri: string }): boolean {
  return prev.uri !== next.uri
}

/**
 * The gate on fetched VTT. Cues reach the scheduler only when the track is selected AND the VTT was
 * requested for the source that is live now. Selection alone is not enough: text ids are ordinals, so
 * the next source selects '0' again before the previous source's fetch for '0' resolves.
 */
export function acceptsTextTrackData(
  selected: ReadonlySet<string>,
  trackId: string,
  requestedFor: string,
  live: string,
): boolean {
  return requestedFor === live && selected.has(trackId)
}

/** The `preferredText` prop's shape, mirrored here so this module stays independent of the React prop types. */
export interface TextPreference {
  languages?: string[]
  kinds?: TextKind[]
}

/**
 * The `preferredText` auto-selection decision, in one tested place.
 *
 * An absent preference selects nothing. This is load-bearing, not defensive: `pickText(tracks, undefined)`
 * returns *every* track by deliberate contract (docs/decisions/0003-text-selection-defaults.md), so
 * delegating an absent preference straight to `pickText` would stack every language and description at
 * once for any app that simply omits the prop. TV convention is captions off until asked for.
 *
 * A *present* preference delegates to `pickText` unchanged, including its documented "omitted key means
 * any" rule — so `{}` and `{ languages: undefined }` select every track. That is the rule's consequence,
 * not a decision made here; the tests pin it so it stays visible.
 */
export function autoSelectedTextIds(text: readonly TextTrack[], pref?: TextPreference): string[] {
  if (!pref) return []
  return pickText([...text], pref).map((t) => t.id)
}
