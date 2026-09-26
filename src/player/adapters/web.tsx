import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { TextTrack, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'
import { deprecatedTextUrls, fetchHlsVtt, loadHlsTextTracks } from '../hls'

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
    // Everything below belongs to this load. The cleanup cancels it on the next `source.uri` (or unmount):
    // every await re-checks `cancelled` before touching props, and every listener is removed by reference, so
    // a superseded load neither publishes its `onTracks` over the new source's reset nor reports its events.
    let cancelled = false
    const headerUrls = deprecatedTextUrls(props.source.headers)
    // No headers on the manifest request: this matches today's bare fetch(t.url) and avoids a CORS preflight.
    const manifest = loadHlsTextTracks(props.source.uri).catch((e) => {
      if (!cancelled) props.onError?.({ code: 'HLS_MASTER', message: 'Could not read the master playlist', fatal: false, cause: e })
      return [] as TextTrack[]
    })
    let metadataSeen: () => void = () => {}
    const metadata = new Promise<void>((resolve) => (metadataSeen = () => resolve()))
    // One onTracks, once both the element's metadata and the manifest are in — otherwise KitPlayer's
    // appliedPrefs would latch on a track list that is still missing the manifest tracks.
    void Promise.all([manifest, metadata]).then(([manifestText]) => {
      if (cancelled) return
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
    const listeners: [keyof HTMLVideoElementEventMap, () => void][] = [
      ['loadedmetadata', metadataSeen],
      ['loadedmetadata', () => props.onState?.('ready')],
      ['timeupdate', () => props.onPosition?.(v.currentTime)],
      ['play', () => props.onState?.('playing')],
      ['pause', () => props.onState?.('paused')],
      ['ended', () => props.onState?.('ended')],
    ]
    for (const [type, fn] of listeners) v.addEventListener(type, fn)
    v.src = props.source.uri
    if (props.startAt) v.currentTime = props.startAt
    if (props.autoplay) void v.play()
    return () => {
      cancelled = true
      for (const [type, fn] of listeners) v.removeEventListener(type, fn)
    }
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
        // Manifest-derived urls are HLS subtitle media playlists; fetchHlsVtt joins their segments into one
        // WebVTT body and returns a bare .vtt body (the deprecated header's usual value) unchanged (plan Q7).
        if (t?.url) props.onTextTrackData?.(id, await fetchHlsVtt(t.url))
      }
    },
    getPosition: () => el.current?.currentTime ?? 0,
    getTracks: () => tracks.current,
  }))

  // react-native-web renders host components; in the harness this file is used directly in a DOM tree.
  return React.createElement('video', { ref: el, style: { width: '100%', height: '100%', background: '#000' }, 'data-testid': props.testID })
})
