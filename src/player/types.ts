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

/** What every adapter implements. Adapters are React components that accept these props and expose a ref. */
export interface AdapterProps extends KitPlayerProps {
  /** Adapter-independent cue delivery: adapters that can't emit cues call this with fetched VTT text per track. */
  onTextTrackData?(trackId: string, vtt: string): void
}

export type { AudioTrack, TextTrack, Tracks, Cue, PlayerState, PlayerError }
