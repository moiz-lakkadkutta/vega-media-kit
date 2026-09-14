/** Normalized across ExoPlayer (Fire OS) and Shaka (Vega / web). */
export type AudioRole = 'main' | 'description' | 'commentary' | 'alternate'

export interface AudioTrack {
  id: string
  language: string
  label: string
  roles: AudioRole[]
  active: boolean
}

export type TextKind = 'subtitles' | 'captions' | 'descriptions' | 'metadata'

export interface TextTrack {
  id: string
  language: string
  label: string
  kind: TextKind
  active: boolean
  /** Absolute URL of the WebVTT playlist or file when the adapter cannot deliver cues itself. */
  url?: string
}

export interface Cue {
  trackId: string
  id: string
  /** seconds */
  start: number
  /** seconds */
  end: number
  /** Plain text with a small whitelist of inline tags kept (<i>, <b>). Everything else stripped. */
  text: string
  line?: 'top' | 'bottom'
  /** From <v Speaker> or a leading [Name] tag. */
  speaker?: string
  /** True when the cue is a sound / SFX caption, e.g. [door slams] or <c.sound>. */
  sound?: boolean
  /** Key/value pairs from a trailing "{k=v;k2=v2}" comment or NOTE metadata. Used by Described for extended=1. */
  meta?: Record<string, string>
}

export type PlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'

export interface PlayerError {
  code: string
  message: string
  fatal: boolean
  cause?: unknown
}

export interface Tracks {
  audio: AudioTrack[]
  text: TextTrack[]
}
