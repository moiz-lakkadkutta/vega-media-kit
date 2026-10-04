import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { CueScheduler, parseVtt, pickAudio } from '../core'
import type { Cue, PlayerError, PlayerState, Tracks } from '../core'
import type { KitPlayerProps, KitPlayerRef } from './types'
import { resolveAdapter } from './adapters'
import { acceptsTextTrackData, applyTextSelection, autoSelectedTextIds, sourceChanged } from './selection'

/** `setVolume`'s input rule: clamp to [0, 1] (±Infinity included); `NaN` → `null`, meaning "ignore the call". */
function clampVolume(v: number): number | null {
  return Number.isNaN(v) ? null : Math.min(1, Math.max(0, v))
}

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
  /**
   * Whether the live load has reported `playing`, `ended` or `error`. A `ready` that arrives afterwards is dropped:
   * `ready` means "loaded, not yet playing" and must never overwrite a later state (docs/decisions/0008) — and a
   * load that failed is neither (KIT-025). Fire OS reads the master playlist after ExoPlayer has already started
   * (KIT-028); web waits for the manifest too, and its join still completes after a media error that followed
   * `loadedmetadata`.
   */
  const readyClosed = useRef(false)
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
  const onErrorRef = useRef(props.onError)
  onErrorRef.current = props.onError
  // KIT-025: the app's onState / onPosition / onTracks and the track preferences are read through refs too, so the
  // handlers below change identity only on `sourceUri` (the gates) and an adapter's per-load listener — which holds
  // the handler of the render its load began in — never delivers to a stale inline callback. The gates are
  // unchanged: a report through a superseded handler is still dropped before any of these refs is read.
  const onStateRef = useRef(props.onState)
  onStateRef.current = props.onState
  const onPositionRef = useRef(props.onPosition)
  onPositionRef.current = props.onPosition
  const onTracksRef = useRef(props.onTracks)
  onTracksRef.current = props.onTracks
  const prefsRef = useRef({ audio: props.preferredAudio, text: props.preferredText })
  prefsRef.current = { audio: props.preferredAudio, text: props.preferredText }
  const positionRef = useRef(0)
  const tracksRef = useRef<Tracks>({ audio: [], text: [] })
  /**
   * Whether the live source's tracks have been reported: its first `onTracks` passed the origin gate. Until then
   * `getTracks()` answers the kit's own list — empty since the reset, what `renderControls` shows — never the adapter's,
   * which may still hold a superseded source's (KIT-020; every adapter resets its own too, but the kit does not rely on
   * it — 0005 §3). Afterwards the adapter is preferred again: it can be fresher than the last `onTracks` (Fire OS marks
   * the `selectAudio` pick active without re-publishing, KIT-029).
   */
  const tracksPublished = useRef(false)
  // Lazy `useRef` rather than `useMemo(..., [])`: React documents `useMemo` as a cache it may discard, and a
  // discarded scheduler is exactly the defect above — its tracks are state, not a recomputable value.
  const schedulerRef = useRef<CueScheduler | null>(null)
  if (schedulerRef.current === null) schedulerRef.current = new CueScheduler((active: Cue[]) => onCueRef.current?.(active))
  const scheduler = schedulerRef.current

  /**
   * The origin gate on `onError`, like `handleTracks` / `handleState`: re-created per `source.uri`, and an error
   * reported through a handler created for a source that is no longer live is dropped. Adapters report through the
   * `onError` they held for the load or the `selectText` call the failure belongs to, so a superseded source's
   * `TEXT_FETCH` (or Vega `SHAKA_*`) arrives here with `sourceUri` = that source. Delivery goes through a
   * latest-props ref, so an inline `onError={(e) => …}` is never stale and never re-creates this handler (KIT-016).
   */
  const handleError = useCallback(
    (e: PlayerError) => {
      if (sourceUri !== liveUri.current) return // an error for a source that is no longer live
      onErrorRef.current?.(e)
    },
    [sourceUri],
  )
  const handleErrorRef = useRef(handleError)
  handleErrorRef.current = handleError

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
      // Safety net (KIT-016): an adapter whose selectText rejects must not leave an unhandled rejection. `report` is
      // the handler of the source live *now*, so a rejection that settles after a switch is dropped by its gate.
      // The web and Fire OS adapters report per track themselves and never reject; this catches anything else.
      const report = handleErrorRef.current
      const pending: unknown = adapterRef.current?.selectText(ids)
      if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') {
        ;(pending as PromiseLike<unknown>).then(undefined, (e: unknown) => {
          // Swallowed: an app `onError` that throws must not turn the safety net into an unhandled rejection.
          try {
            report({ code: 'TEXT_FETCH', message: 'Could not load text tracks', fatal: false, cause: e })
          } catch {
            // nothing left to report to
          }
        })
      }
    },
    [scheduler],
  )

  /**
   * The origin gate on `onTracks`, mirroring `handleTextTrackData`: re-created per `source.uri`, and a report
   * that arrives through a handler created for a source that is no longer live is dropped whole — not forwarded
   * to the app, not latched into `appliedPrefs`, not shown in `renderControls`. Adapters publish through the
   * `onTracks` they held when the load began (web: the load effect's props; fireos: the `onLoad` closure across
   * its await), so a superseded load's report arrives here with `sourceUri` = that source. The kit does not rely
   * on an adapter cancelling its own load: fireos cancels its own superseded loads since KIT-023, but the kit
   * does not depend on it, and on web the cancel is closed only because the reset below schedules sync state
   * (see the note there).
   */
  const handleTracks = useCallback(
    (t: Tracks) => {
      if (sourceUri !== liveUri.current) return // a report for a source that is no longer live
      tracksRef.current = t
      tracksPublished.current = true // before the app's onTracks and the auto-selection, which may read getTracks()
      setTracks(t)
      onTracksRef.current?.(t)
      if (!appliedPrefs.current && adapterRef.current) {
        appliedPrefs.current = true
        // The preferences current when the tracks arrive, not when the load began (KIT-025).
        const a = pickAudio(t.audio, prefsRef.current.audio)
        if (a) adapterRef.current.selectAudio(a.id)
        // No `preferredText` — or an empty one — means text off, never "every track": TV convention is captions
        // off until asked for, and description text is opt-in (decisions 0003, 0007). The decision itself lives
        // in `autoSelectedTextIds` so it is tested in one place.
        const tx = autoSelectedTextIds(t.text, prefsRef.current.text)
        if (tx.length) selectText(tx)
      }
    },
    [selectText, sourceUri],
  )

  const handlePosition = useCallback(
    (s: number) => {
      positionRef.current = s
      setPosition(s)
      onPositionRef.current?.(s)
      scheduler.update(s)
    },
    [scheduler],
  )

  /**
   * The state gate (docs/decisions/0008). Re-created per `source.uri` like `handleTracks`: a report through a
   * handler created for a source that is no longer live is dropped — adapters report state through per-load
   * closures (web listeners, the Vega load) or latest-props handlers (Fire OS), so only a superseded load's report
   * can arrive stale. `ready` is dropped once the live load has reported `playing`/`ended`: the adapter could not
   * order it earlier without reporting `ready` before `onTracks`; and once it has reported `error` (KIT-025). The
   * kit never synthesises a state (0005 §3); it only refuses one. Delivery is through `onStateRef`, so an inline
   * `onState` is never stale and never re-creates this handler.
   */
  const handleState = useCallback(
    (s: PlayerState) => {
      if (sourceUri !== liveUri.current) return // a report for a source that is no longer live
      if (s === 'ready' && readyClosed.current) return // ready never overwrites playing/ended (KIT-028) or error (KIT-025)
      if (s === 'playing' || s === 'ended' || s === 'error') readyClosed.current = true
      setState(s)
      onStateRef.current?.(s)
    },
    [sourceUri],
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
   * no-op on first mount and under StrictMode's double invocation. The state updates below also make the
   * adapters' passive cleanup run *inside* this commit on every update lane (KIT-022 §1). The load-bearing one is
   * `setTracks` with a fresh object, which can never bail out; `setPosition(start)` alone can take React's eager
   * bailout when the position is unchanged and schedule nothing. This relies on React 18/19 work-loop behaviour
   * (a layout-phase setState is SyncLane; sync work flushes pending passive effects first), verified on
   * react-dom 19.3 — not a documented React guarantee. Pinned by harness spec 25; without it the web adapter's
   * `cancelled` flag is set one task too late for a DefaultLane source change.
   */
  useLayoutEffect(() => {
    if (!sourceChanged({ uri: liveUri.current }, props.source)) return
    liveUri.current = props.source.uri
    const start = props.startAt ?? 0
    selectedText.current = applyTextSelection([], scheduler.tracks).selected // refuse VTT first
    appliedPrefs.current = false // the new source's first onTracks re-applies preferredAudio/preferredText
    readyClosed.current = false // the new load's ready is reported unless it, too, is already playing (or failed)
    // Before `scheduler.update` below: an app reading `getTracks()` in the `onCue([])` it emits gets the empty list
    // (KIT-020), not the previous source's from either the adapter or the kit's own fallback.
    tracksPublished.current = false
    tracksRef.current = { audio: [], text: [] }
    for (const t of scheduler.tracks) scheduler.removeTrack(t) // the getter copies, so removing while iterating is safe
    scheduler.update(start) // removeTrack never notifies; this emits onCue([]) iff cues were on screen
    setTracks({ audio: [], text: [] }) // renderControls must not show the previous source's tracks
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
      setVolume: (v) => {
        const c = clampVolume(v)
        if (c !== null) adapterRef.current?.setVolume(c)
      },
      selectAudio: (id) => adapterRef.current?.selectAudio(id),
      selectText,
      getPosition: () => adapterRef.current?.getPosition() ?? positionRef.current,
      // The kit's own list until the live source has reported (see `tracksPublished`); then the adapter's.
      getTracks: () => (tracksPublished.current ? adapterRef.current?.getTracks() ?? tracksRef.current : tracksRef.current),
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
        onError={handleError}
        onCue={props.onCue}
      />
      {props.renderControls?.({ state, position, tracks, ref: api })}
    </>
  )
})
