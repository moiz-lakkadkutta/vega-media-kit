import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { fromShakaText, fromShakaVariants } from '../../core'
import type { Cue, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef, PlayerError } from '../types'
import { VEGA_DOCS, warnOnce } from '../../platform/log'
import { requireShaka, requireW3cMedia } from './w3c'

/**
 * Vega adapter over @amazon-devices/react-native-w3cmedia with Shaka Player as the MSE engine.
 *
 * STATUS: scaffold. The exact w3cmedia component/props are confirmed in KIT-001 (week-0 spike) from
 * AmazonAppDev/vega-video-sample. The shape below follows that sample's pattern: a <VideoPlayer> surface that
 * exposes an HTMLMediaElement-like object, onto which shaka.Player is attached.
 * Everything marked TODO(spike) is expected to change in name only.
 */
export const VegaAdapter = forwardRef<KitPlayerRef, AdapterProps>(function VegaAdapter(props, ref) {
  const w3c = requireW3cMedia()
  const shaka = requireShaka()
  const media = useRef<HTMLMediaElement | null>(null)
  const player = useRef<InstanceType<typeof shaka.Player> | null>(null)
  const tracks = useRef<Tracks>({ audio: [], text: [] })

  /** A `source.uri` change forgets the previous source's tracks in the same commit as KitPlayer's reset (KIT-020).
   *  KIT-010: a superseded load must never write `tracks` afterwards — see the plan §6. */
  useLayoutEffect(() => {
    tracks.current = { audio: [], text: [] }
  }, [props.source.uri])

  useEffect(() => {
    const el = media.current
    if (!el) return
    /** Set by this effect's cleanup: this load is superseded and reports nothing more. The one per-load flag. */
    let cancelled = false
    /**
     * At most one fatal report per load, whichever of the `error` event and the `load()` rejection comes first.
     * TODO(spike): confirm on the VVD whether Shaka on w3cmedia both dispatches `error` and rejects `load()` for the
     * same failure (KIT-034 plan §7.2 V-D2); keep the dedupe either way.
     */
    let failed = false
    const p = new shaka.Player()
    player.current = p
    p.attach(el as unknown as HTMLMediaElement).then(async () => {
      p.configure({ streaming: { bufferingGoal: 20 }, textDisplayFactory: () => new NullTextDisplayer() }) // kit renders cues, not Shaka
      p.addEventListener('trackschanged', publishTracks)
      p.addEventListener('adaptation', publishTracks)
      p.addEventListener('buffering', (e: Event & { buffering?: boolean }) => props.onState?.(e.buffering ? 'buffering' : 'playing'))
      p.addEventListener('error', (e: Event & { detail?: ShakaErrorLike }) => {
        const err = shakaError(e.detail)
        if (cancelled) return
        if (err.fatal) {
          if (failed) return
          failed = true
        }
        props.onError?.(err) // onError first, then `error` (KIT-034)
        if (err.fatal) props.onState?.('error')
      })
      props.onState?.('loading')
      try {
        await p.load(props.source.uri, props.startAt)
      } catch (e) {
        // A failed load is fatal whatever its severity: nothing is loaded. 7000/7001 only mean "superseded".
        if (cancelled || isLoadInterrupted(e) || failed) return
        failed = true
        props.onError?.(shakaError(e as ShakaErrorLike, { fatal: true }))
        props.onState?.('error')
        return
      }
      if (cancelled) return // superseded while loading: no tracks, no ready (R-V1)
      publishTracks()
      props.onState?.('ready') // after onTracks (KIT-015); Vega is experimental (decision 0001), not device-verified
      if (props.autoplay) void el.play()
    })
    el.addEventListener('timeupdate', () => props.onPosition?.(el.currentTime))
    el.addEventListener('play', () => props.onState?.('playing'))
    el.addEventListener('pause', () => props.onState?.('paused'))
    el.addEventListener('ended', () => props.onState?.('ended'))
    return () => {
      cancelled = true
      void p.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.source.uri])

  function publishTracks() {
    const p = player.current
    if (!p) return
    tracks.current = { audio: fromShakaVariants(p.getVariantTracks() as never), text: fromShakaText(p.getTextTracks() as never) }
    props.onTracks?.(tracks.current)
  }

  useImperativeHandle(ref, () => ({
    play: () => void media.current?.play(),
    pause: () => media.current?.pause(),
    seek: (s) => { if (media.current) media.current.currentTime = s },
    setRate: (r) => { if (media.current) media.current.playbackRate = r },
    setVolume: setVolumeUnsupported,
    selectAudio: (id) => {
      const p = player.current
      if (!p) return
      const v = (p.getVariantTracks() as Array<{ audioId?: number; id: number }>).find((t) => String(t.audioId ?? t.id) === id)
      if (v) p.selectVariantTrack(v as never, /* clearBuffer */ true, /* safeMargin */ 0.5)
    },
    selectText: async (ids) => {
      // Preferred path: fetch each text track's VTT via Shaka's manifest and feed the kit scheduler,
      // so the Vega and Fire OS paths produce identical cues. Shaka's own cue events (TextTrack 'cuechange')
      // are used only to validate timing in the spike.
      const p = player.current
      if (!p) return
      for (const id of ids) {
        const t = (p.getTextTracks() as Array<{ id: number; language: string }>).find((x) => String(x.id) === id)
        if (!t) continue
        // TODO(spike): obtain the text stream URI. Shaka does not expose it publicly; options are
        // (a) parse the master playlist ourselves (src/player/hls.ts), or (b) select the track in Shaka with a
        // custom textDisplayer that captures cues → onCue. (b) is implemented below as CaptureTextDisplayer.
        p.selectTextTrack(t as never)
        p.setTextTrackVisibility(true)
      }
    },
    getPosition: () => media.current?.currentTime ?? 0,
    getTracks: () => tracks.current,
  }))

  return <w3c.VideoPlayer ref={media} style={props.style ?? { flex: 1 }} testID={props.testID} />
})

/** The parts of a `shaka.util.Error` the kit reads. */
type ShakaErrorLike = { code?: number; message?: string; severity?: number } | undefined
/** `shaka.util.Error.Severity.CRITICAL`: "a new manifest must be loaded"; `RECOVERABLE` (1): Shaka is recovering. */
const SHAKA_CRITICAL = 2
/** `shaka.util.Error.Code` LOAD_INTERRUPTED / OPERATION_ABORTED: a superseded `load()` rejects with these. */
const SHAKA_LOAD_INTERRUPTED = 7000
const SHAKA_OPERATION_ABORTED = 7001

/** The kit error for a Shaka error; fatal iff Shaka marks it CRITICAL, unless `opts.fatal` says otherwise. Exported for tests. */
export function shakaError(detail: ShakaErrorLike, opts?: { fatal?: boolean }): PlayerError {
  return {
    code: `SHAKA_${detail?.code ?? '?'}`,
    message: detail?.message ?? 'Playback error',
    fatal: opts?.fatal ?? detail?.severity === SHAKA_CRITICAL,
    cause: detail,
  }
}

/** A `load()` rejection that only means "superseded" (7000 LOAD_INTERRUPTED, 7001 OPERATION_ABORTED). Exported for tests. */
export function isLoadInterrupted(e: unknown): boolean {
  const code = (e as { code?: unknown } | null | undefined)?.code
  return code === SHAKA_LOAD_INTERRUPTED || code === SHAKA_OPERATION_ABORTED
}

/**
 * `KitPlayerRef.setVolume` on Vega: a no-op that says so once (KIT-018 convention). Vega is experimental and not
 * device-verified (decision 0001); whether the w3cmedia element honours `volume` is unconfirmed, so the kit does
 * not pretend. Never throws. Exported so it can be tested without rendering the adapter.
 */
export function setVolumeUnsupported(_volume: number): void {
  warnOnce('KitPlayerRef.setVolume', 'kepler', VEGA_DOCS, 'Vega support is experimental, not device-verified (w3cmedia volume unconfirmed)')
}

/** Shaka text displayer that swallows rendering (the kit's CueOverlay draws). */
class NullTextDisplayer {
  append(): void {}
  destroy(): Promise<void> { return Promise.resolve() }
  remove(): boolean { return true }
  isTextVisible(): boolean { return false }
  setTextVisibility(): void {}
  setTextLanguage(): void {}
}

/** Text displayer that forwards Shaka cues to the kit as Cue[] — plan (b) in selectText. */
export function makeCaptureTextDisplayer(trackId: string, onCue: (cues: Cue[]) => void) {
  return class CaptureTextDisplayer {
    cues: Cue[] = []
    append(newCues: Array<{ startTime: number; endTime: number; payload: string; line?: number }>): void {
      for (const c of newCues) this.cues.push({ trackId, id: `${c.startTime}`, start: c.startTime, end: c.endTime, text: c.payload, ...(c.line !== undefined && c.line <= 3 ? { line: 'top' as const } : {}) })
      onCue(this.cues)
    }
    remove(start: number, end: number): boolean { this.cues = this.cues.filter((c) => c.end <= start || c.start >= end); return true }
    destroy(): Promise<void> { this.cues = []; return Promise.resolve() }
    isTextVisible(): boolean { return true }
    setTextVisibility(): void {}
    setTextLanguage(): void {}
  }
}
