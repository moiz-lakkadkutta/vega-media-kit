import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { fromRnvAudio, fromRnvText } from '../../core'
import type { Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'

/**
 * Fire OS adapter over react-native-video (ExoPlayer).
 * Native text rendering is disabled; cues are delivered by fetching the subtitle playlists and handing
 * WebVTT to the kit's scheduler through onTextTrackData. This keeps multi-track captions identical to Vega.
 *
 * react-native-video is an optional peer dependency and is required lazily so the kit imports cleanly on Vega.
 */
export const FireOsAdapter = forwardRef<KitPlayerRef, AdapterProps>(function FireOsAdapter(props, ref) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Video = require('react-native-video').default as React.ComponentType<Record<string, unknown>>
  const videoRef = useRef<{ seek(s: number): void } | null>(null)
  const [paused, setPaused] = useState(!props.autoplay)
  const [rate, setRate] = useState(1)
  const [audioIndex, setAudioIndex] = useState<number | undefined>()
  const position = useRef(props.startAt ?? 0)
  const tracks = useRef<Tracks>({ audio: [], text: [] })
  const textUrls = useRef<Map<string, string>>(new Map())

  useImperativeHandle(ref, () => ({
    play: () => setPaused(false),
    pause: () => setPaused(true),
    seek: (s) => videoRef.current?.seek(s),
    setRate: (r) => setRate(r),
    selectAudio: (id) => setAudioIndex(Number(id)),
    selectText: async (ids) => {
      // Fetch VTT for each selected track; the HLS subtitle playlist is resolved by hlsVttUrl().
      for (const id of ids) {
        const url = textUrls.current.get(id)
        if (!url) continue
        try {
          const vtt = await fetchHlsVtt(url)
          props.onTextTrackData?.(id, vtt)
        } catch (e) {
          props.onError?.({ code: 'TEXT_FETCH', message: `Could not load text track ${id}`, fatal: false, cause: e })
        }
      }
    },
    getPosition: () => position.current,
    getTracks: () => tracks.current,
  }))

  const onLoad = useCallback(
    (e: { audioTracks?: Parameters<typeof fromRnvAudio>[0]; textTracks?: Parameters<typeof fromRnvText>[0] }) => {
      const t: Tracks = { audio: fromRnvAudio(e.audioTracks ?? []), text: fromRnvText(e.textTracks ?? []) }
      // TODO(spike KIT-001): react-native-video does not expose subtitle playlist URLs; until the manifest is parsed
      // by the kit (see hls.ts), apps may pass TextTrack.url via props.source.headers['x-kit-text-urls'] JSON.
      const provided = props.source.headers?.['x-kit-text-urls']
      if (provided) for (const [id, url] of Object.entries(JSON.parse(provided) as Record<string, string>)) textUrls.current.set(id, url)
      tracks.current = t
      props.onTracks?.(t)
      props.onState?.('ready')
    },
    [props],
  )

  return (
    <Video
      ref={videoRef}
      source={{ uri: props.source.uri, type: props.source.type === 'hls' ? 'm3u8' : 'mpd', headers: props.source.headers }}
      paused={paused}
      rate={rate}
      style={props.style ?? { flex: 1 }}
      resizeMode="contain"
      selectedAudioTrack={audioIndex !== undefined ? { type: 'index', value: audioIndex } : undefined}
      selectedTextTrack={{ type: 'disabled' }}
      onLoadStart={() => props.onState?.('loading')}
      onLoad={onLoad}
      onProgress={(e: { currentTime: number }) => { position.current = e.currentTime; props.onPosition?.(e.currentTime) }}
      onBuffer={(e: { isBuffering: boolean }) => props.onState?.(e.isBuffering ? 'buffering' : paused ? 'paused' : 'playing')}
      onPlaybackStateChanged={(e: { isPlaying: boolean }) => props.onState?.(e.isPlaying ? 'playing' : 'paused')}
      onEnd={() => props.onState?.('ended')}
      onError={(e: unknown) => props.onError?.({ code: 'EXO', message: 'Playback error', fatal: true, cause: e })}
      testID={props.testID}
    />
  )
})

/** Resolve an HLS subtitle media playlist to concatenated WebVTT (segments joined; headers de-duplicated). */
export async function fetchHlsVtt(url: string): Promise<string> {
  const res = await fetch(url)
  const body = await res.text()
  if (/^WEBVTT/m.test(body) && !body.includes('#EXTM3U')) return body
  const base = url.slice(0, url.lastIndexOf('/') + 1)
  const segs = body.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => (/^https?:/.test(l) ? l : base + l))
  const parts = await Promise.all(segs.map((s) => fetch(s).then((r) => r.text())))
  return 'WEBVTT\n\n' + parts.map((p) => p.replace(/^WEBVTT[^\n]*\n(?:X-TIMESTAMP-MAP[^\n]*\n)?/m, '')).join('\n')
}
