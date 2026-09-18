import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { TextTrack, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'
import { deprecatedTextUrls, loadHlsTextTracks } from '../hls'

/**
 * Web adapter: HTMLVideoElement (+ Shaka when available) for the Playwright harness and Storybook.
 * Text tracks come from the HLS master playlist (docs/decisions/0004); the deprecated id→url header
 * (`DEPRECATED_TEXT_URLS_HEADER`) still overrides and adds entries for one more release.
 */
export const WebAdapter = forwardRef<KitPlayerRef, AdapterProps>(function WebAdapter(props, ref) {
  const el = useRef<HTMLVideoElement | null>(null)
  const tracks = useRef<Tracks>({ audio: [], text: [] })

  useEffect(() => {
    const v = el.current
    if (!v) return
    const headerUrls = deprecatedTextUrls(props.source.headers)
    // No headers on the manifest request: this matches today's bare fetch(t.url) and avoids a CORS preflight.
    const manifest = loadHlsTextTracks(props.source.uri).catch((e) => {
      props.onError?.({ code: 'HLS_MASTER', message: 'Could not read the master playlist', fatal: false, cause: e })
      return [] as TextTrack[]
    })
    const metadata = new Promise<void>((resolve) => v.addEventListener('loadedmetadata', () => resolve(), { once: true }))
    // One onTracks, once both the element's metadata and the manifest are in — otherwise KitPlayer's
    // appliedPrefs would latch on a track list that is still missing the manifest tracks.
    void Promise.all([manifest, metadata]).then(([manifestText]) => {
      const text: TextTrack[] = manifestText.map((t) => (headerUrls[t.id] ? { ...t, url: headerUrls[t.id] } : t))
      const known = new Set(text.map((t) => t.id))
      for (const [id, url] of Object.entries(headerUrls)) {
        if (known.has(id)) continue
        text.push({ id, language: id.split('-')[0] ?? 'und', label: id, kind: 'subtitles', active: false, url })
      }
      tracks.current = {
        audio: [{ id: '0', language: 'und', label: 'Original', roles: ['main'], active: true }],
        text,
      }
      props.onTracks?.(tracks.current)
    })
    v.src = props.source.uri
    v.addEventListener('loadedmetadata', () => props.onState?.('ready'))
    v.addEventListener('timeupdate', () => props.onPosition?.(v.currentTime))
    v.addEventListener('play', () => props.onState?.('playing'))
    v.addEventListener('pause', () => props.onState?.('paused'))
    v.addEventListener('ended', () => props.onState?.('ended'))
    if (props.startAt) v.currentTime = props.startAt
    if (props.autoplay) void v.play()
  }, [props.source.uri]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    play: () => void el.current?.play(),
    pause: () => el.current?.pause(),
    seek: (s) => { if (el.current) el.current.currentTime = s },
    setRate: (r) => { if (el.current) el.current.playbackRate = r },
    selectAudio: () => {},
    selectText: async (ids) => {
      for (const id of ids) {
        const t = tracks.current.text.find((x) => x.id === id)
        if (t?.url) props.onTextTrackData?.(id, await (await fetch(t.url)).text())
      }
    },
    getPosition: () => el.current?.currentTime ?? 0,
    getTracks: () => tracks.current,
  }))

  // react-native-web renders host components; in the harness this file is used directly in a DOM tree.
  return React.createElement('video', { ref: el, style: { width: '100%', height: '100%', background: '#000' }, 'data-testid': props.testID })
})
