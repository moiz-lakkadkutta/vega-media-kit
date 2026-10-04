import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { PlayerError, TextTrack, Tracks } from '../../core'
import type { AdapterProps, KitPlayerRef } from '../types'
import { deprecatedTextUrls, fetchHlsVtt, loadHlsTextTracks } from '../hls'

/** `MediaError.code` → message. Codes per https://html.spec.whatwg.org/multipage/media.html#mediaerror */
const MEDIA_MESSAGES: Record<number, string> = {
  1: 'Media loading was aborted', // MEDIA_ERR_ABORTED
  2: 'A network error stopped the media download', // MEDIA_ERR_NETWORK
  3: 'The media could not be decoded', // MEDIA_ERR_DECODE
  4: 'The media source is not supported or could not be loaded', // MEDIA_ERR_SRC_NOT_SUPPORTED (Chromium: also a 404)
}

/**
 * The kit error for the element's current `MediaError`, or `null` when there is none (a spurious `error` event).
 * Always fatal: after an element error the HTML load algorithm stops the resource. One code, `MEDIA`; the
 * `MediaError` (its `code` and the browser's `message` detail) is the `cause` (KIT-025).
 */
export function mediaElementError(err: Pick<MediaError, 'code' | 'message'> | null): PlayerError | null {
  if (!err) return null
  return { code: 'MEDIA', fatal: true, message: MEDIA_MESSAGES[err.code] ?? 'Playback error', cause: err }
}

/**
 * How a `play()` rejection is reported; `null` = swallow. `AbortError` (a load or `pause()` interrupted the play —
 * the intended outcome) and `NotSupportedError` (always accompanied by the element `error` event, reported as `MEDIA`)
 * are swallowed; everything else is a non-fatal `PLAY_REJECTED`. The spec's `play()` rejects only with these three
 * (https://html.spec.whatwg.org/multipage/media.html#dom-media-play); "anything else" is defensive.
 */
export function playRejection(e: unknown): PlayerError | null {
  const name = (e as { name?: unknown } | null | undefined)?.name // a DOMException in browsers, a plain Error in tests
  if (name === 'AbortError' || name === 'NotSupportedError') return null
  if (name === 'NotAllowedError') {
    return { code: 'PLAY_REJECTED', fatal: false, message: 'Playback was blocked by the browser (autoplay policy)', cause: e }
  }
  return { code: 'PLAY_REJECTED', fatal: false, message: 'Playback could not start', cause: e }
}

/**
 * `v.play()`, with its rejection classified by `playRejection` and reported — never an unhandled rejection, even
 * when `report` throws (an app `onError` that throws). Tolerates a non-promise return (legacy engines, jsdom).
 */
function startPlay(v: HTMLVideoElement, report: (e: PlayerError) => void): void {
  const pending: unknown = v.play()
  if (!pending || typeof (pending as PromiseLike<unknown>).then !== 'function') return
  ;(pending as PromiseLike<unknown>).then(undefined, (reason: unknown) => {
    const e = playRejection(reason)
    if (!e) return
    try {
      report(e)
    } catch {
      // nothing left to report to
    }
  })
}

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
    props.onState?.('loading')
    const headerUrls = deprecatedTextUrls(props.source.headers)
    // No headers on the manifest request: this matches today's bare fetch(t.url) and avoids a CORS preflight.
    const manifest = loadHlsTextTracks(props.source.uri).catch((e) => {
      if (!cancelled) props.onError?.({ code: 'HLS_MASTER', message: 'Could not read the master playlist', fatal: false, cause: e })
      return [] as TextTrack[]
    })
    let metadataSeen: () => void = () => {}
    const metadata = new Promise<void>((resolve) => (metadataSeen = () => resolve()))
    // One onTracks, then ready, once both the element's metadata and the manifest are in — otherwise KitPlayer's
    // appliedPrefs would latch on a track list that is still missing the manifest tracks, and an app reading
    // getTracks() in onState('ready') would get an empty list.
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
      props.onState?.('ready') // from the join, after onTracks: the contract in AdapterProps (KIT-015)
    })
    // `playing`, not `play`: `play` fires as soon as play() is called, before any data, so an autoplay load would
    // report `playing` first and its `ready` would always be dropped (0008). `waiting` is `buffering` only while
    // playing: Chromium fires it during a seek while paused too, and no `playing` would ever leave that state.
    // `error` reports through this load's `onError` (KIT-016 boundary: the kit's per-uri gate attributes it), first
    // the fatal MEDIA, then the `error` state, so an app rendering on `state === 'error'` already holds the error.
    const listeners: [keyof HTMLVideoElementEventMap, () => void][] = [
      ['loadedmetadata', metadataSeen],
      ['timeupdate', () => props.onPosition?.(v.currentTime)],
      ['playing', () => props.onState?.('playing')],
      ['waiting', () => { if (!v.paused) props.onState?.('buffering') }],
      ['pause', () => props.onState?.('paused')],
      ['ended', () => props.onState?.('ended')],
      ['error', () => {
        const e = mediaElementError(v.error)
        if (!e) return
        props.onError?.(e)
        props.onState?.('error')
      }],
    ]
    for (const [type, fn] of listeners) v.addEventListener(type, fn)
    v.src = props.source.uri
    if (props.startAt) v.currentTime = props.startAt
    // A rejection after this load was superseded is dropped here (0005 §3: adapters cancel their own reports) and
    // again by the kit's gate on this load's `onError`.
    if (props.autoplay) startPlay(v, (e) => { if (!cancelled) props.onError?.(e) })
    return () => {
      cancelled = true
      for (const [type, fn] of listeners) v.removeEventListener(type, fn)
    }
  }, [props.source.uri]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    // This render's `onError`: the handler of the source live when play() was called, like `selectText` below.
    play: () => { const v = el.current; if (v) startPlay(v, (e) => props.onError?.(e)) },
    pause: () => el.current?.pause(),
    seek: (s) => { if (el.current) el.current.currentTime = s },
    setRate: (r) => { if (el.current) el.current.playbackRate = r },
    // KitPlayer has clamped it: HTMLMediaElement.volume throws IndexSizeError outside [0, 1]
    // (https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume).
    setVolume: (v) => { if (el.current) el.current.volume = v },
    selectAudio: () => {},
    selectText: async (ids) => {
      // `props` is this render's: the `onTextTrackData` and `onError` handed over for the source live when
      // `selectText` was called (AdapterProps origin contract), never a latest-props ref.
      for (const id of ids) {
        const t = tracks.current.text.find((x) => x.id === id)
        if (!t?.url) continue
        // Manifest-derived urls are HLS subtitle media playlists; fetchHlsVtt joins their segments into one
        // WebVTT body and returns a bare .vtt body (the deprecated header's usual value) unchanged (plan Q7).
        // One track's failure is reported and the loop goes on: multi-track selection must survive a bad track,
        // and this promise never rejects (KIT-016).
        let vtt: string
        try {
          vtt = await fetchHlsVtt(t.url)
        } catch (e) {
          props.onError?.({ code: 'TEXT_FETCH', message: `Could not load text track ${id}`, fatal: false, cause: e })
          continue
        }
        props.onTextTrackData?.(id, vtt)
      }
    },
    getPosition: () => el.current?.currentTime ?? 0,
    getTracks: () => tracks.current,
  }))

  // react-native-web renders host components; in the harness this file is used directly in a DOM tree.
  return React.createElement('video', { ref: el, style: { width: '100%', height: '100%', background: '#000' }, 'data-testid': props.testID })
})
