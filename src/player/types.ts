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
  /**
   * Output volume, 0 (silent) to 1 (full; the default). Clamped to [0, 1]; `NaN` is ignored. A property update on
   * the playing source — no reload, no re-buffer — so it can be stepped for a fade (e.g. around `selectAudio`).
   * Kept across source changes. Fire OS: react-native-video's `volume` prop. Web: `HTMLMediaElement.volume`.
   * Vega: a no-op that logs once (Vega is experimental, decision 0001). Adapters receive an already-clamped value.
   */
  setVolume(volume: number): void
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
  /**
   * Text auto-selection, applied on each source's first `onTracks` (decisions 0003, 0007). Selects only when at
   * least one key is named: omitted, `{}` and `{ languages: undefined }` all select nothing. `kinds: []` or
   * `languages: []` means none (captions off). An omitted `languages` means any language; an omitted `kinds` means
   * every kind except `descriptions` — name `kinds: ['descriptions']` to turn description text on. Every matching
   * track is selected (two languages at once is the point); `selectText([...ids])` always wins afterwards.
   */
  preferredText?: { languages?: string[]; kinds?: TextKind[] }
  /** Called ≤ 4 Hz. */
  onPosition?(seconds: number): void
  /**
   * Playback state. Per load of `source.uri`: `loading` first; `onTracks` is always reported before `ready`, so
   * `getTracks()` and `selectText` work inside `onState('ready')`; `ready` is not reported for a load that has
   * already reported `playing` or `ended` (an autoplay load whose tracks arrive after playback began goes
   * `loading → … → playing`, with `onTracks` in between), and it never overwrites `playing` in `renderControls`.
   * States of a source the app has switched away from are not reported (docs/decisions/0008). A load that fails
   * reports `error` (after `onError`); `ready` is not reported after `error`. Web reports `buffering` while it waits
   * for data during playback. Always delivered to the latest `onState` prop (as are `onPosition` and `onTracks`).
   */
  onState?(state: PlayerState): void
  onTracks?(tracks: Tracks): void
  /** Every change of the active-cue set, across all selected text tracks. */
  onCue?(active: Cue[]): void
  /**
   * Errors, by `code`: `HLS_MASTER` (the master playlist could not be read; non-fatal, playback continues without
   * manifest text tracks), `TEXT_FETCH` (a selected text track could not be loaded — HTTP error, a body that is
   * neither WebVTT nor an HLS media playlist, network failure; non-fatal, one per failed track per `selectText`,
   * other selected tracks still load), `EXO` (Fire OS playback error, fatal), `SHAKA_<n>` (Vega, fatal), `MEDIA`
   * (web: the `<video>` element reported a `MediaError` — unreachable, undecodable or unsupported media; fatal, the
   * state becomes `error`; `cause` is the `MediaError`), `PLAY_REJECTED` (web: `play()` was refused, normally the
   * browser's autoplay policy; non-fatal, playback stays paused and a later `play()` can start it). Errors of a
   * source the app has switched away from are not reported. Always delivered to the latest `onError` prop.
   */
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
 * `selectText` time. Hold `onError` the same way: the one of the load an error belongs to (a media or manifest
 * error), or the one handed to you at `selectText` time (a `TEXT_FETCH`) (KIT-016). Never read any of them through a
 * latest-props ref. The kit re-creates them per `source.uri`
 * and uses *which handler* delivered a report to drop reports for a source that is no longer live
 * (docs/decisions/0005 §4; KIT-022). An adapter should still cancel its own superseded loads (KIT-023): the
 * kit's gate drops the report, it cannot undo an adapter's internal state. Never call `onTracks` /
 * `onTextTrackData` / `onState` for a new source synchronously during render or from your own layout effects /
 * `useImperativeHandle`: child layout effects run before KitPlayer's reset updates the live uri, so such a report
 * would be refused.
 *
 * State contract for one load: report `loading` when the load begins; report `onTracks` exactly once when the track
 * list is complete (docs/decisions/0004) — none if the load fails first — and `ready` immediately after it, from the
 * same continuation — never from a separate event such as `loadedmetadata`. Report `playing` / `paused` /
 * `buffering` / `ended` as the platform does, before or after `ready`. Report `error` after the fatal `onError` of a
 * failed load. The kit drops a `ready` that arrives after the load reported `playing`, `ended` or `error` (Fire OS
 * reads the master playlist after ExoPlayer has started) and drops every state report that arrives through
 * an `onState` created for a source that is no longer live — so hold `onState` the same way as `onTracks`
 * (docs/decisions/0008; KIT-015, KIT-028).
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
