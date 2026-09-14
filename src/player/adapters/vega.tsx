import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { fromShakaText, fromShakaVariants } from '../../core'
import type { Cue, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'

/**
 * Vega adapter over @amazon-devices/react-native-w3cmedia with Shaka Player as the MSE engine.
 *
 * STATUS: scaffold. The exact w3cmedia component/props are confirmed in KIT-001 (week-0 spike) from
 * AmazonAppDev/vega-video-sample. The shape below follows that sample's pattern: a <VideoPlayer> surface that
 * exposes an HTMLMediaElement-like object, onto which shaka.Player is attached.
 * Everything marked TODO(spike) is expected to change in name only.
 */
export const VegaAdapter = forwardRef<KitPlayerRef, AdapterProps>(function VegaAdapter(props, ref) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const w3c = require('@amazon-devices/react-native-w3cmedia') as { VideoPlayer: React.ComponentType<Record<string, unknown>> }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const shaka = require('shaka-player') as typeof import('shaka-player') // installed via the sample's post-install step
  const media = useRef<HTMLMediaElement | null>(null)
  const player = useRef<InstanceType<typeof shaka.Player> | null>(null)
  const tracks = useRef<Tracks>({ audio: [], text: [] })

  useEffect(() => {
    const el = media.current
    if (!el) return
    const p = new shaka.Player()
    player.current = p
    p.attach(el as unknown as HTMLMediaElement).then(async () => {
      p.configure({ streaming: { bufferingGoal: 20 }, textDisplayFactory: () => new NullTextDisplayer() }) // kit renders cues, not Shaka
      p.addEventListener('trackschanged', publishTracks)
      p.addEventListener('adaptation', publishTracks)
      p.addEventListener('buffering', (e: Event & { buffering?: boolean }) => props.onState?.(e.buffering ? 'buffering' : 'playing'))
      p.addEventListener('error', (e: Event & { detail?: { code?: number; message?: string } }) =>
        props.onError?.({ code: `SHAKA_${e.detail?.code ?? '?'}`, message: e.detail?.message ?? 'Playback error', fatal: true, cause: e.detail }),
      )
      props.onState?.('loading')
      await p.load(props.source.uri, props.startAt)
      props.onState?.('ready')
      publishTracks()
      if (props.autoplay) void el.play()
    })
    el.addEventListener('timeupdate', () => props.onPosition?.(el.currentTime))
    el.addEventListener('play', () => props.onState?.('playing'))
    el.addEventListener('pause', () => props.onState?.('paused'))
    el.addEventListener('ended', () => props.onState?.('ended'))
    return () => { void p.destroy() }
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
