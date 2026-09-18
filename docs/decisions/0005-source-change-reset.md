# 0005 — A `source.uri` change resets the kit's per-source state, before the adapter reloads

**Date:** 2026-09-18 (week 0)
**Status:** accepted — orchestrator, under `docs/ORCHESTRATOR.md` §3.2; no public type changes; the human may veto before 0.1.0
**Ticket:** KIT-011 · **Plan:** `docs/plans/KIT-011-source-reset.md`

## Context

`KitPlayer` keeps three pieces of state that belong to *one* source and nothing else: the selected text ids
(`selectedText`, a ref), the `preferredAudio`/`preferredText` latch (`appliedPrefs`, a ref that flips true on
the first `onTracks` and never back), and the `CueScheduler`'s loaded tracks. Nothing in `KitPlayer.tsx`
watches `props.source`. When an app changes it in place — `described` playing the next episode with AD on,
`lingo` moving to the next clip with two languages selected — the second source inherits the first one's
selection, its cues stay loaded in the scheduler, and `preferredText`/`preferredAudio` are never applied
again because the latch is already set.

Ids collide by construction: manifest text ids are ordinals (`'0'`, `'1'`, … — decision 0004), `fromRnvText`
uses the ExoPlayer index and `fromShakaText` the Shaka id. So "the old selection" is not merely stale, it
*matches* tracks of the new source and keeps the previous episode's captions on screen until the new VTT
happens to overwrite the same id.

What the adapters do on a source change, read from the code:

- `web.tsx:15-48` and `vega.tsx:23-48` key their load effect on `props.source.uri` — and only `uri`. A
  headers-only or type-only change does nothing in either.
- `fireos.tsx:93` passes `uri`/`type`/`headers` to `<Video source>`; react-native-video reloads when the
  native source changes. It has no effect of its own.
- All three emit `onTracks` **asynchronously** (fireos awaits the manifest promise in `onLoad`; web awaits
  `Promise.all([manifest, metadata])`; vega inside `attach().then`). None of them resets its internal
  `tracks` ref on a change.
- Every consumer builds `source` inline on every render — `harness/player.tsx:87`, `described`
  `Player.tsx:45`, `lingo` `Player.tsx:33` — so the `source` object's identity changes on every render and
  carries no information.

## Decision

**1. A source change is a change of `source.uri`, and nothing else.** Not `type`, not `headers`, not object
identity. The reset must be coupled to a reload: resetting when the adapter does *not* reload would strip a
playing source of its selected tracks for no visible reason. Today every adapter reloads on `uri` and only on
`uri`, so `uri` is the identity. `headers` in particular must not count — an `Authorization` header that
refreshes its token would otherwise clear captions on every refresh. If an adapter ever reloads on `type` or
`headers`, `sourceChanged` in `src/player/selection.ts` is the single place to widen the rule, and that
adapter's effect deps change in the same commit.

**2. On a change the kit resets exactly what it owns for a source, in this order:**

1. `selectedText` → empty set. First, so any VTT that lands between now and the new source's first
   `onTracks` is refused by the selected gate alone.
2. `appliedPrefs` → `false`, so the new source's first `onTracks` re-applies `preferredAudio` and
   `preferredText` with the props of the new render.
3. The scheduler's tracks → all removed (`applyTextSelection([], scheduler.tracks)` — the internal half of
   `selectText([])`, without the adapter call), then `scheduler.update(startAt ?? 0)`. `removeTrack` never
   notifies (KIT-009), and `CueScheduler.reset()` clears `activeIds` without removing tracks, so neither
   alone clears the overlay; `update` after pruning emits `onCue([])` **exactly when cues were on screen**,
   and nothing when none were. The scheduler instance itself is kept — a fresh one would have an empty
   `activeIds` and could not emit the clearing `[]`.
4. `tracks` state → `{ audio: [], text: [] }`. `renderControls` and the `getTracks()` fallback would
   otherwise hand an app's track sheet the previous source's list for as long as the new manifest takes to
   load, with ids that resolve to the wrong tracks on the new source.
5. `position` state → `startAt ?? 0`, the value the adapter is about to seek to and the same initial value
   `fireos.tsx:24` uses. The previous source's position on a scrubber for the new one is wrong for up to
   one `onPosition` interval otherwise.

The adapter is **not** told `selectText([])`: it is reloading anyway, and the deselect would race the load.
`api.selectText` therefore remains the only call site of `adapterRef.current.selectText` (the KIT-009
source guard stands).

**3. Not reset — the kit only resets what it owns and only emits events whose source it owns.** `state` is
the adapter's (`fireos` emits `loading` at `onLoadStart`, `vega` before `load`); the kit does not synthesise
`onState`, `onPosition`, or an empty `onTracks` — `onTracks` is the adapter's report of a source, and an
invented empty one would be a second `onTracks` per source, which decision 0004 ruled out. `onCue([])`
*is* emitted because the scheduler is the kit's and the active set genuinely changed. The app's `onCue`
subscription, the scheduler instance, the resolved `Adapter`, and `adapterRef` are untouched. Adapter
internals (`fireos` `paused`/`rate`/`audioIndex`, every adapter's `tracks` ref) are theirs; see
Consequences.

*Amended 2026-09-18 (KIT-011 review):* because `onTracks` is the adapter's report of **a** source, an adapter
must not emit `onTracks` or `onTextTrackData` for a source that is no longer its current one. The web
adapter violates this today — its load effect has no cleanup, so a switch made before source A's manifest
resolves lets A's `Promise.all([manifest, metadata])` complete against B's `loadedmetadata` and publish A's
tracks after the reset, latching `appliedPrefs` on the wrong list. Tracked as KIT-019, due before 0.1.0.

**4. The race is real and the gate is extended: VTT is accepted only if it was requested for the source
that is live now.** `acceptsTextTrackData` gating on `selectedText` alone is *not* sufficient. Both web and
fireos `selectText` are `for … await` loops; a fetch started for source A resolves after the switch. The
new source's `preferredText` typically selects the same ordinal (`'0'`) before that fetch resolves, so A's
VTT for `'0'` passes the selected gate and lands in the scheduler — transiently if B's fetch resolves later
(wrong captions for the gap), **permanently** if B's fetch resolved first (cached) or failed. The token is
the source `uri` itself: `handleTextTrackData` is re-created per `source.uri` and refuses VTT unless the uri
it was created for is the live one. This works because an adapter's `selectText` calls the
`onTextTrackData` it captured when it was invoked (`fireos.tsx:36-49`, `web.tsx:56-63` — plain closure
capture, the React default), so old fetches arrive through the old handler. It is stated as an adapter
contract in the plan: *call the `onTextTrackData` you were handed at `selectText` time; do not read it
through a latest-props ref*. A numeric generation was rejected: it needs a state and a ref where the uri
needs one ref, and the only case it distinguishes — A→B→A within one fetch's latency — delivers the same
bytes for the same uri anyway.

**5. Comparison is by `uri` value on every commit, never by object identity.** Every consumer builds
`source` inline (Context), so identity would reset on every render. Value comparison also covers an app
that mutates one object's `uri`, which we assume nobody does (props are immutable) but do not need to
forbid.

**6. Mechanism: `useLayoutEffect` keyed on `source.uri`, comparing against a `liveUri` ref.** Not
`useEffect`: React runs *all* layout effects of a commit before *any* passive effect of that commit, so the
kit's reset runs before the adapters' own `useEffect` on `source.uri` starts loading the new source. The
order is then guaranteed by React's phase ordering, not by the observation that adapters happen to emit
asynchronously today. A passive effect would run after the adapter's effect (children first) and would
leave a window in which a native `onLoad` event could apply the new source's `preferredText` and be wiped by
the reset. Not a comparison during render: it would call `props.onCue([])` and `setTracks` while rendering.
Not a comparison at the top of `handleTracks`: the previous source's cues would stay on screen until the new
manifest resolves. The ref comparison (rather than "the effect ran, so it changed") makes the effect
idempotent under StrictMode's double invocation and a no-op on first mount.

**7. KIT-012 is neither fixed nor worsened.** The scheduler is still rebuilt when `props.onCue` identity
changes; if that happens in the same render as a source change, the reset prunes the fresh scheduler and
emits nothing, and the overlay keeps its last cue until the new source's first cue change — no worse than
today, and gone once KIT-012 pins the scheduler. KIT-011 does not touch `KitPlayer.tsx:23` (the scheduler
memo) or `:87-102` (the `api` memo); KIT-012 touches only those. The plan lists the exact regions.

## Consequences

- `src/player/selection.ts` gains `sourceChanged(prev, next)` and `acceptsTextTrackData` grows two
  required string parameters (`requestedFor`, `live`). Neither is exported from any `index.ts`; the module
  stays kit-internal as KIT-009 set it up. `KitPlayerProps`, `KitSource`, `KitPlayerRef`, `AdapterProps` and
  `src/core/**` are unchanged.
- Behaviour change, `patch`-level: switching `source` now clears selected text tracks and pending cues and
  re-applies `preferredAudio`/`preferredText` to the new source. `onCue([])` fires once on a switch when cues
  were visible. Apps that route away and back (remount) see no difference.
- `described` (next episode, AD on): `preferredAudio={{ role: 'description' }}` is re-applied on the new
  source's `onTracks`; captions chosen from `prefs.captionKind` are re-selected by kind, not by the old id.
  `lingo` (next clip): its cues come from the clip payload, not text tracks, so it only gains the
  `position`/`tracks` reset. Neither app needs a change.
- Adapter follow-ups, ticketed, not folded in: (a) adapters keep the previous source's `tracks` ref until the
  new `onTracks` (`web.tsx:13`, `vega.tsx:21`, `fireos.tsx:25`), so `api.getTracks()` — which prefers the
  adapter — disagrees with `renderControls`' now-empty `tracks` during the load; (b) `fireos` `audioIndex`
  (`fireos.tsx:23`) survives a source change and is applied to the new source until `preferredAudio`
  re-selects; (c) adapters should abandon in-flight `selectText` fetches when their source changes — the
  kit-side gate makes this hygiene, not correctness; it belongs with KIT-016.
- The harness can assert the whole reset end-to-end on web once `harness/player.tsx` exposes
  `__kit.setSource(uri)` and a second fixture stream exists — plan §3 names the spec. Follow-up, not KIT-011.
