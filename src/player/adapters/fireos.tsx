import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { fromRnvAudio, fromRnvText } from '../../core'
import type { TextTrack, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'
import { deprecatedTextUrls, fetchHlsVtt, loadHlsTextTracks } from '../hls'

/**
 * Fire OS adapter over react-native-video (ExoPlayer).
 * Native text rendering is disabled; cues are delivered by fetching the subtitle playlists and handing
 * WebVTT to the kit's scheduler through onTextTrackData. This keeps multi-track captions identical to Vega.
 *
 * ExoPlayer does not expose a text track's playlist URL, so the kit reads the HLS master playlist itself
 * (docs/decisions/0004) and `TextTrack.url` comes from `#EXT-X-MEDIA:TYPE=SUBTITLES`.
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
  /** The master-playlist read, started at onLoadStart so it overlaps ExoPlayer's own load. */
  const hlsText = useRef<Promise<TextTrack[]> | null>(null)

  useImperativeHandle(ref, () => ({
    play: () => setPaused(false),
    pause: () => setPaused(true),
    seek: (s) => videoRef.current?.seek(s),
    setRate: (r) => setRate(r),
    selectAudio: (id) => setAudioIndex(Number(id)),
    selectText: async (ids) => {
      // Fetch VTT for each selected track; the URL came from the master playlist (or, for one more release,
      // from the deprecated header override).
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

  const onLoadStart = useCallback(() => {
    if (props.source.type === 'hls') {
      hlsText.current = loadHlsTextTracks(props.source.uri, { headers: props.source.headers }).catch((e) => {
        // Non-fatal: without the manifest the adapter falls back to ExoPlayer's own text track list.
        props.onError?.({ code: 'HLS_MASTER', message: 'Could not read the master playlist', fatal: false, cause: e })
        return [] as TextTrack[]
      })
    }
    props.onState?.('loading')
  }, [props])

  /**
   * One `onTracks` call, after the manifest promise resolves. KitPlayer's `appliedPrefs` latches on the
   * first call, so publishing manifest-less tracks first would leave `preferredText` never applied.
   */
  const onLoad = useCallback(
    async (e: { audioTracks?: Parameters<typeof fromRnvAudio>[0]; textTracks?: Parameters<typeof fromRnvText>[0] }) => {
      const manifestText = (await hlsText.current) ?? []
      const urls = new Map<string, string>(
        manifestText.filter((t) => t.url).map((t): [string, string] => [t.id, t.url as string]),
      )
      // The deprecated header is merged last, so an entry overrides a manifest URL for the same id and
      // adds a fetchable id the manifest did not produce. It warns once and goes away in the next minor.
      for (const [id, url] of Object.entries(deprecatedTextUrls(props.source.headers))) urls.set(id, url)
      textUrls.current = urls
      const t: Tracks = {
        audio: fromRnvAudio(e.audioTracks ?? []),
        text: manifestText.length ? manifestText : fromRnvText(e.textTracks ?? []),
      }
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
      onLoadStart={onLoadStart}
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
