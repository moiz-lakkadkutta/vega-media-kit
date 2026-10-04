# 0008 — `onTracks` precedes `ready`; `ready` never overwrites `playing`; state reports are origin-gated

**Date:** 2026-09-29
**Status:** accepted — decided by the human 2026-09-29 (§2 was offered for veto under `docs/ORCHESTRATOR.md` §3.2 and approved: a `ready` arriving after the live load reported `playing`/`ended` is dropped, so an autoplay load may never report `ready`); amends 0005 §3
**Tickets:** KIT-015, KIT-028 · **Plan:** `docs/plans/KIT-015-tracks-before-ready.md`

## Context

The order of `onTracks` and `onState('ready')` was never a contract and differed per adapter (KIT-005 review):
Fire OS tracks → ready, Vega ready → tracks, web race-dependent. An app that reads `getTracks()` or calls
`selectText` in `onState('ready')` got an empty list on web. Separately, on Fire OS the master-playlist read
that produces `onTracks` completes after ExoPlayer has started playing, so the adapter's `ready` arrived
0.6–1.2 s after `playing` and overwrote it for the rest of playback (KIT-028; device log 2026-09-27). No
adapter ordering fixes that: `ready` cannot precede `onTracks`, and holding `playing` until the manifest
lands would show a spinner over video that is audibly playing.

## Decision

1. **Per load, every adapter reports `loading`, then exactly one `onTracks` (0004), then `ready` — from the
   same continuation as `onTracks`.** Web reports `ready` from its manifest + metadata join (it previously
   reported it on `loadedmetadata` alone, and never reported `loading`); Vega publishes tracks before
   `ready`; Fire OS already complied.
2. **`ready` means "loaded, not yet playing". The kit drops a `ready` for a load that has already reported
   `playing` or `ended`.** An autoplay load whose tracks arrive after playback began therefore reports
   `loading → … → playing` and no `ready`; `onTracks` still arrives in between. `buffering` and `paused`
   before `ready` do not suppress it — Fire OS reports both before the manifest-gated `ready` on every load,
   and an autoplay-off load must end in `ready`. Apps must not wait for `ready` to leave a loading screen;
   `onTracks` says the tracks are known and `playing` says playback started. (`described` reads only
   `buffering`; `lingo` only `paused`/`ended`; neither changes.)
3. **The kit drops every state report that arrives through an `onState` created for a source that is no
   longer live** — the KIT-022 gate extended from `onTracks` to `handleState`, for all states. Every adapter
   reports state through per-load closures or latest-props handlers, so a report through a superseded
   handler is a superseded load's or a duplicate. Adapter-side cancellation remains required for adapter
   state (0005 §3 amendment); the gate is the kit's own guarantee for adapters that do not cancel (the Vega
   scaffold; any future adapter).
4. **The rules live in the kit, not in each adapter.** The kit owns `PlayerState` and its meaning, so it
   enforces the state model once, where `renderControls`' `state` is set. 0005 §3 stands: the kit never
   synthesises `onState`; it now also refuses one. The kit does not re-order or defer reports — ordering is
   the adapter's obligation, stated in `AdapterProps`.

*Amended (KIT-025, 2026-10-04; orchestrator, offered to the human for veto):* §2 also drops a `ready` that
arrives after the live load reported `error` (`readyClosed`, reset on source change). Web now reports
`playing` on the element's `playing` event (not `play`) and `buffering` on `waiting` while not paused, so a
web autoplay load reports `loading → ready → playing` when tracks are known before frames play — still
compatible with "may never report `ready`". A failed web load reports `MEDIA` (fatal) then `error`, and no
`onTracks`/`ready`. A blocked autoplay reports a non-fatal `PLAY_REJECTED` and stays at `ready`.

## Consequences

- No type changes. `KitPlayerProps.onState` and `AdapterProps` JSDoc state the contract.
- Web: `ready` arrives later than before by the manifest's latency; `loading` is now reported.
- The sample app's KitSpike HUD workaround (`KitSpikeScreen.tsx:116-118`, "treat `ready` as playing") can be
  removed; `Play/Pause` must key on `playing` alone.
- Harness specs that used `state:ready` as "the element has metadata" use `video.readyState` instead.
- KIT-023's mutation M1 now reddens only T5 (the kit gate masks T1); the adapter cancel is still guarded.
