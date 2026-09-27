import type { ReactNode } from 'react'
import type { AudioRole, AudioTrack, Cue, PlayerError, PlayerState, TextKind, TextTrack, Tracks } from '../core'

export interface KitSource {
  uri: string
  type: 'hls' | 'dash'
  headers?: Record<string, string>
}

export interface KitPlayerRef {
  play(): void
  pause(): void
  seek(seconds: number): void
  setRate(rate: 0.5 | 0.75 | 1 | 1.25): void
  selectAudio(trackId: string): void
  /** Multiple text tracks on purpose (two languages; captions + descriptions). */
  selectText(trackIds: string[]): void
  getPosition(): number
  getTracks(): Tracks
}

export interface KitPlayerProps {
  source: KitSource
  autoplay?: boolean
  startAt?: number
  preferredAudio?: { language?: string; role?: AudioRole }
  preferredText?: { languages?: string[]; kinds?: TextKind[] }
  /** Called ≤ 4 Hz. */
  onPosition?(seconds: number): void
  onState?(state: PlayerState): void
  onTracks?(tracks: Tracks): void
  /** Every change of the active-cue set, across all selected text tracks. */
  onCue?(active: Cue[]): void
  onError?(error: PlayerError): void
  /** Apps own their UI; the kit owns playback. */
  renderControls?(ctx: { state: PlayerState; position: number; tracks: Tracks; ref: KitPlayerRef }): ReactNode
  style?: unknown
  testID?: string
}

/**
 * What every adapter implements. Adapters are React components that accept these props and expose a ref.
 *
 * Origin contract for per-source reports: call the `onTracks` you held when the load began — the load effect's
 * props on web, the `onLoad` closure across its await on Fire OS — and the `onTextTrackData` you were handed at
 * `selectText` time. Never read either through a latest-props ref. The kit re-creates both per `source.uri`
 * and uses *which handler* delivered a report to drop reports for a source that is no longer live
 * (docs/decisions/0005 §4; KIT-022). An adapter should still cancel its own superseded loads (KIT-023): the
 * kit's gate drops the report, it cannot undo an adapter's internal state. Never call `onTracks` /
 * `onTextTrackData` for a new source synchronously during render or from your own layout effects /
 * `useImperativeHandle`: child layout effects run before KitPlayer's reset updates the live uri, so such a report
 * would be refused.
 */
export interface AdapterProps extends KitPlayerProps {
  /**
   * Adapter-independent cue delivery: adapters that can't emit cues call this with fetched VTT text per track.
   * Call the `onTextTrackData` you were handed at `selectText` time — capture it in the closure; never read it
   * through a latest-props ref. The kit re-creates it per `source.uri` and uses which handler delivered the VTT
   * to drop fetches that were started for a previous source (docs/decisions/0005 §4).
   */
  onTextTrackData?(trackId: string, vtt: string): void
}

export type { AudioTrack, TextTrack, Tracks, Cue, PlayerState, PlayerError }
