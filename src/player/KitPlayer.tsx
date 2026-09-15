import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { CueScheduler, parseVtt, pickAudio } from '../core'
import type { Cue, PlayerState, Tracks } from '../core'
import type { KitPlayerProps, KitPlayerRef } from './types'
import { resolveAdapter } from './adapters'
import { acceptsTextTrackData, applyTextSelection, autoSelectedTextIds } from './selection'

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

  /**
   * The one text-selection transition: selected set → prune scheduler tracks → adapter.
   * Both the app (`api.selectText`) and the `preferredText` auto-selection go through here,
   * so an auto-selected track is never left out of `selectedText` and silently dropped.
   */
  const selectText = useCallback(
    (ids: string[]) => {
      const { selected, prune } = applyTextSelection(ids, scheduler.tracks)
      selectedText.current = selected
      for (const t of prune) scheduler.removeTrack(t)
      // removeTrack never notifies, so a deselect while paused would leave the last cue on screen
      // until the next onPosition. Re-evaluate at the current position instead.
      if (prune.length) scheduler.update(adapterRef.current?.getPosition() ?? 0)
      adapterRef.current?.selectText(ids)
    },
    [scheduler],
  )

  const handleTracks = useCallback(
    (t: Tracks) => {
      setTracks(t)
      props.onTracks?.(t)
      if (!appliedPrefs.current && adapterRef.current) {
        appliedPrefs.current = true
        const a = pickAudio(t.audio, props.preferredAudio)
        if (a) adapterRef.current.selectAudio(a.id)
        // No `preferredText` means text off, never "every track": TV convention is captions off until
        // asked for, and an omitted preference must not stack every language and description at once.
        // The decision itself lives in `autoSelectedTextIds` so it is tested in one place.
        const tx = autoSelectedTextIds(t.text, props.preferredText)
        if (tx.length) selectText(tx)
      }
    },
    [props.onTracks, props.preferredAudio, props.preferredText, selectText],
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
      if (!acceptsTextTrackData(selectedText.current, trackId)) return
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
      selectText,
      getPosition: () => adapterRef.current?.getPosition() ?? position,
      getTracks: () => adapterRef.current?.getTracks() ?? tracks,
    }),
    [position, tracks, scheduler, selectText],
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
