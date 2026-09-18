import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { CueScheduler, parseVtt, pickAudio } from '../core'
import type { Cue, PlayerState, Tracks } from '../core'
import type { KitPlayerProps, KitPlayerRef } from './types'
import { resolveAdapter } from './adapters'
import { acceptsTextTrackData, applyTextSelection, autoSelectedTextIds, sourceChanged } from './selection'

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
  /** The source the kit's per-source state (selection, latch, scheduler tracks) currently belongs to. */
  const liveUri = useRef(props.source.uri)
  const sourceUri = props.source.uri

  /**
   * Latest-props refs. `onCue` is read through a ref so the scheduler is constructed exactly once: keyed on
   * `props.onCue` it was rebuilt for every inline `onCue={(c) => ...}`, dropping every loaded track (KIT-012).
   * `position`/`tracks` are mirrored so `api` can answer `getPosition`/`getTracks` without closing over state —
   * otherwise `useImperativeHandle` and `renderControls` received a new `ref` on every position tick.
   */
  const onCueRef = useRef(props.onCue)
  onCueRef.current = props.onCue
  const positionRef = useRef(0)
  const tracksRef = useRef<Tracks>({ audio: [], text: [] })
  // Lazy `useRef` rather than `useMemo(..., [])`: React documents `useMemo` as a cache it may discard, and a
  // discarded scheduler is exactly the defect above — its tracks are state, not a recomputable value.
  const schedulerRef = useRef<CueScheduler | null>(null)
  if (schedulerRef.current === null) schedulerRef.current = new CueScheduler((active: Cue[]) => onCueRef.current?.(active))
  const scheduler = schedulerRef.current

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
      tracksRef.current = t
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
      positionRef.current = s
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

  /**
   * Adapters that cannot emit cues push raw VTT here; adapters that can call onCue directly and never call this.
   * Re-created per `source.uri` on purpose: an adapter's `selectText` calls the `onTextTrackData` it captured when
   * it was invoked, so VTT fetched for a previous source arrives through a previous handler and `sourceUri` is
   * that source — not the live one — and the VTT is refused even when the new source selected the same id.
   * Adapter contract: call the `onTextTrackData` you were handed at `selectText` time; never read it through a
   * latest-props ref.
   */
  const handleTextTrackData = useCallback(
    (trackId: string, vtt: string) => {
      if (!acceptsTextTrackData(selectedText.current, trackId, sourceUri, liveUri.current)) return
      scheduler.setTrack(trackId, parseVtt(vtt, { trackId }))
    },
    [scheduler, sourceUri],
  )

  /**
   * A source change resets what the kit owns for a source, before the adapter reloads (docs/decisions/0005).
   * Layout effect, not passive: React runs every layout effect of a commit before any passive effect of that
   * commit, so this precedes the adapters' own `useEffect` on `source.uri` regardless of how they emit. A
   * passive effect would run after the adapter's (children first) and could wipe a `preferredText` the new
   * source had already applied. Compares against `liveUri` rather than trusting "the effect ran", so it is a
   * no-op on first mount and under StrictMode's double invocation.
   */
  useLayoutEffect(() => {
    if (!sourceChanged({ uri: liveUri.current }, props.source)) return
    liveUri.current = props.source.uri
    const start = props.startAt ?? 0
    selectedText.current = applyTextSelection([], scheduler.tracks).selected // refuse VTT first
    appliedPrefs.current = false // the new source's first onTracks re-applies preferredAudio/preferredText
    for (const t of scheduler.tracks) scheduler.removeTrack(t) // the getter copies, so removing while iterating is safe
    scheduler.update(start) // removeTrack never notifies; this emits onCue([]) iff cues were on screen
    setTracks({ audio: [], text: [] }) // renderControls must not show the previous source's tracks
    tracksRef.current = { audio: [], text: [] }
    setPosition(start)
    positionRef.current = start
    // The adapter is not told selectText([]): it is reloading, and the deselect would race the load.
  }, [sourceUri]) // eslint-disable-line react-hooks/exhaustive-deps

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
      getPosition: () => adapterRef.current?.getPosition() ?? positionRef.current,
      getTracks: () => adapterRef.current?.getTracks() ?? tracksRef.current,
    }),
    [scheduler, selectText], // both stable, so `api` is created once and `renderControls`' `ref` never changes
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
