import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { fromRnvAudio, fromRnvText } from '../../core'
import type { TextTrack, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'
import { deprecatedTextUrls, fetchHlsVtt, loadHlsTextTracks } from '../hls'
import { requireVideo } from './rnv'

/**
 * Everything the adapter holds for one load of one `source.uri`. Replaced whole when the uri changes, so a
 * continuation that still holds the previous record can tell it has been superseded (`l !== load.current`)
 * and touch nothing — refs, props, nothing (KIT-023).
 */
interface Load {
  uri: string
  /** Set by this source's `onLoadStart`. An `onLoad` that arrives before it belongs to the previous source. */
  started: boolean
  /** The master-playlist read, started at onLoadStart so it overlaps ExoPlayer's own load. */
  manifest: Promise<TextTrack[]> | null
  textUrls: Map<string, string>
  tracks: Tracks
}
const newLoad = (uri: string): Load => ({ uri, started: false, manifest: null, textUrls: new Map(), tracks: { audio: [], text: [] } })

/**
 * Fire OS adapter over react-native-video (ExoPlayer).
 * Native text rendering is disabled; cues are delivered by fetching the subtitle playlists and handing
 * WebVTT to the kit's scheduler through onTextTrackData. This keeps multi-track captions identical to Vega.
 *
 * ExoPlayer does not expose a text track's playlist URL, so the kit reads the HLS master playlist itself
 * (docs/decisions/0004) and `TextTrack.url` comes from `#EXT-X-MEDIA:TYPE=SUBTITLES`.
 *
 * react-native-video is an optional peer dependency and is required lazily (./rnv) so the kit imports cleanly on Vega.
 */
export const FireOsAdapter = forwardRef<KitPlayerRef, AdapterProps>(function FireOsAdapter(props, ref) {
  const Video = requireVideo()
  const videoRef = useRef<{ seek(s: number): void } | null>(null)
  const [paused, setPaused] = useState(!props.autoplay)
  const [rate, setRate] = useState(1)
  /** react-native-video's `volume` prop (1.0 is its default). State, not a key: changing it never re-mounts <Video>. */
  const [volume, setVolume] = useState(1)
  const [audioIndex, setAudioIndex] = useState<number | undefined>()
  const position = useRef(props.startAt ?? 0)
  const load = useRef<Load>(newLoad(props.source.uri))

  /**
   * A uri change starts a new load record and forgets the previous source's tracks, urls, position and audio
   * pick (KIT-020) in the same commit as KitPlayer's own reset — before the new <Video> can emit anything.
   * Compares against the record, so it is a no-op on mount and under StrictMode's double invocation.
   */
  useLayoutEffect(() => {
    if (load.current.uri === props.source.uri) return
    load.current = newLoad(props.source.uri)
    position.current = props.startAt ?? 0
    setAudioIndex(undefined)
  }, [props.source.uri, props.startAt])

  useImperativeHandle(ref, () => ({
    play: () => setPaused(false),
    pause: () => setPaused(true),
    seek: (s) => videoRef.current?.seek(s),
    setRate: (r) => setRate(r),
    setVolume: (v) => setVolume(v),
    selectAudio: (id) => {
      setAudioIndex(Number(id))
      // ExoPlayer publishes no track event after a switch, so the adapter's own view marks the pick (KIT-029).
      const l = load.current
      l.tracks = { ...l.tracks, audio: l.tracks.audio.map((a) => ({ ...a, active: a.id === id })) }
    },
    selectText: async (ids) => {
      // Fetch VTT for each selected track; the URL came from the master playlist (or, for one more release,
      // from the deprecated header override). Read from the live record at call time.
      const l = load.current
      for (const id of ids) {
        const url = l.textUrls.get(id)
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
    getTracks: () => load.current.tracks,
  }))

  const onLoadStart = useCallback(() => {
    const l = load.current
    l.started = true
    if (props.source.type === 'hls') {
      l.manifest = loadHlsTextTracks(l.uri, { headers: props.source.headers }).catch((e) => {
        // Non-fatal: without the manifest the adapter falls back to ExoPlayer's own text track list.
        // Not reported for a source the app has since left.
        if (l === load.current) props.onError?.({ code: 'HLS_MASTER', message: 'Could not read the master playlist', fatal: false, cause: e })
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
      const l = load.current
      // react-native-video emits onLoad only after its own onLoadStart for the same source, so an onLoad that
      // reaches a record whose onLoadStart has not happened is the previous source's, dispatched after the switch.
      if (!l.started) return
      const manifestText = (await l.manifest) ?? []
      if (l !== load.current) return // superseded during the await: publish nothing, overwrite nothing
      const urls = new Map<string, string>(
        manifestText.filter((t) => t.url).map((t): [string, string] => [t.id, t.url as string]),
      )
      // The deprecated header is merged last, so an entry overrides a manifest URL for the same id and
      // adds a fetchable id the manifest did not produce. It warns once and goes away in the next minor.
      for (const [id, url] of Object.entries(deprecatedTextUrls(props.source.headers))) urls.set(id, url)
      l.textUrls = urls
      l.tracks = {
        audio: fromRnvAudio(e.audioTracks ?? []),
        text: manifestText.length ? manifestText : fromRnvText(e.textTracks ?? []),
      }
      props.onTracks?.(l.tracks)
      props.onState?.('ready')
    },
    [props],
  )

  return (
    <Video
      // One ExoPlayer per source: the previous instance is released with its view, and React Native drops
      // events from an unmounted view, so nothing of the previous source can reach the new one's handlers.
      key={props.source.uri}
      ref={videoRef}
      source={{ uri: props.source.uri, type: props.source.type === 'hls' ? 'm3u8' : 'mpd', headers: props.source.headers }}
      paused={paused}
      rate={rate}
      // https://docs.thewidlarzgroup.com/react-native-video/docs/v6/component/props/#volume — 0.0 mutes, 1.0 full.
      volume={volume}
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
