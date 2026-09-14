import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'

/**
 * Web adapter: HTMLVideoElement (+ Shaka when available) for the Playwright harness and Storybook.
 * Text tracks are fetched from `source.headers['x-kit-text-urls']` (JSON id→url) and delivered as VTT.
 */
export const WebAdapter = forwardRef<KitPlayerRef, AdapterProps>(function WebAdapter(props, ref) {
  const el = useRef<HTMLVideoElement | null>(null)
  const tracks = useRef<Tracks>({ audio: [], text: [] })

  useEffect(() => {
    const v = el.current
    if (!v) return
    const urls = props.source.headers?.['x-kit-text-urls'] ? (JSON.parse(props.source.headers['x-kit-text-urls']) as Record<string, string>) : {}
    tracks.current = {
      audio: [{ id: '0', language: 'und', label: 'Original', roles: ['main'], active: true }],
      text: Object.keys(urls).map((id) => ({ id, language: id.split('-')[0] ?? 'und', label: id, kind: 'subtitles', active: false, url: urls[id] })),
    }
    v.src = props.source.uri
    v.addEventListener('loadedmetadata', () => { props.onState?.('ready'); props.onTracks?.(tracks.current) })
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
