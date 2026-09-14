import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { CueScheduler, parseVtt, pickAudio, pickText } from '../core'
import type { Cue, PlayerState, Tracks } from '../core'
import type { KitPlayerProps, KitPlayerRef } from './types'
import { resolveAdapter } from './adapters'

/**
 * KitPlayer: one component, one ref, one cue model — on Fire OS (ExoPlayer), Vega (w3cmedia + Shaka) and web.
 * Cues reach `onCue` either from the adapter's own events or from the kit's scheduler over parsed WebVTT;
 * the app cannot tell which, by design.
 */
export const KitPlayer = forwardRef<KitPlayerRef, KitPlayerProps>(function KitPlayer(props, ref) {
  const Adapter = useMemo(() => resolveAdapter(Platform.OS), [])
  const adapterRef = useRef<KitPlayerRef | null>(null)
  const [state, setState] = useState<PlayerState>('idle')
  const [position, setPosition] = useState(0)
  const [tracks, setTracks] = useState<Tracks>({ audio: [], text: [] })
  const selectedText = useRef<Set<string>>(new Set())
  const appliedPrefs = useRef(false)

  const scheduler = useMemo(() => new CueScheduler((active: Cue[]) => props.onCue?.(active)), [props.onCue])

  const handleTracks = useCallback(
    (t: Tracks) => {
      setTracks(t)
      props.onTracks?.(t)
      if (!appliedPrefs.current && adapterRef.current) {
        appliedPrefs.current = true
        const a = pickAudio(t.audio, props.preferredAudio)
        if (a) adapterRef.current.selectAudio(a.id)
        const tx = pickText(t.text, props.preferredText)
        if (tx.length) adapterRef.current.selectText(tx.map((x) => x.id))
      }
    },
    [props.onTracks, props.preferredAudio, props.preferredText],
  )

  const handlePosition = useCallback(
    (s: number) => {
      setPosition(s)
      props.onPosition?.(s)
      scheduler.update(s)
    },
    [props.onPosition, scheduler],
  )

  const handleState = useCallback(
    (s: PlayerState) => {
      setState(s)
      props.onState?.(s)
    },
    [props.onState],
  )

  /** Adapters that cannot emit cues push raw VTT here; adapters that can call onCue directly and never call this. */
  const handleTextTrackData = useCallback(
    (trackId: string, vtt: string) => {
      if (!selectedText.current.has(trackId)) return
      scheduler.setTrack(trackId, parseVtt(vtt, { trackId }))
    },
    [scheduler],
  )

  const api: KitPlayerRef = useMemo(
    () => ({
      play: () => adapterRef.current?.play(),
      pause: () => adapterRef.current?.pause(),
      seek: (s) => {
        adapterRef.current?.seek(s)
        scheduler.update(s)
      },
      setRate: (r) => adapterRef.current?.setRate(r),
      selectAudio: (id) => adapterRef.current?.selectAudio(id),
      selectText: (ids) => {
        selectedText.current = new Set(ids)
        for (const t of scheduler.tracks) if (!selectedText.current.has(t)) scheduler.removeTrack(t)
        adapterRef.current?.selectText(ids)
      },
      getPosition: () => adapterRef.current?.getPosition() ?? position,
      getTracks: () => adapterRef.current?.getTracks() ?? tracks,
    }),
    [position, tracks, scheduler],
  )
  useImperativeHandle(ref, () => api, [api])

  return (
    <>
      <Adapter
        {...props}
        ref={adapterRef}
        onTracks={handleTracks}
        onPosition={handlePosition}
        onState={handleState}
        onTextTrackData={handleTextTrackData}
        onCue={props.onCue}
      />
      {props.renderControls?.({ state, position, tracks, ref: api })}
    </>
  )
})
