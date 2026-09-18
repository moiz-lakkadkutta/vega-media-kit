# 0004 — The kit parses the HLS master playlist; `x-kit-text-urls` is deprecated

**Date:** 2026-09-18 (week 0)
**Status:** accepted — deprecation and app migration decided by the human under `docs/ORCHESTRATOR.md` §6 (kit ↔ apps)
**Ticket:** KIT-002/003/004 · **Plan:** `docs/plans/KIT-002-hls.md`

## Context

Neither ExoPlayer (via `react-native-video`) nor Shaka exposes a text track's playlist URL to the app. The
scaffold worked around that by having apps pass a JSON id→url map in `source.headers['x-kit-text-urls']`,
parsed independently in `src/player/adapters/fireos.tsx:50` (behind a `TODO(spike KIT-001)`) and in
`src/player/adapters/web.tsx:16`, and documented in `docs/getting-started.md:3`.

The kit now reads the master playlist itself, so `TextTrack.url` is populated from
`#EXT-X-MEDIA:TYPE=SUBTITLES` and `CHARACTERISTICS` decides the track kind.

## Decisions

**1. The pure parser lives in `src/core/hls.ts`, public via `./core`.** `CLAUDE.md` requires `core` to stay
free of React Native because it "runs in Node, used by media pipelines" — and HLS parsing is exactly that.
The decisive evidence is that `described/packages/pipeline` already imports `@moizp/vega-media-kit/core` in
four files (`prompts.ts`, `steps/08-text.ts`, `work/dry-pack.mts`), while `./player` cannot be imported in
Node at all, since `KitPlayer.tsx` imports `react-native`. A pipeline can only reach a parser through core.

This differs from KIT-009, which put `selection.ts` in `src/player/` to avoid growing the public surface.
The distinction: `selection.ts` is KitPlayer wiring state; `hls.ts` is a pure transform over a platform's
data format, which is what `core/tracks.ts` already is.

**2. The fetch layer lives in `src/player/hls.ts`** — the filename the scaffold comments already pointed at —
and takes an injectable `fetch`, so it is tested in Node with a stub and no network.

**3. `fetchHlsVtt` moves from `adapters/fireos.tsx` to `src/player/hls.ts` with a byte-identical body.** Same
name, signature and entry point, so it is not an API change. Its behaviour is pinned by tests written
*before* the move.

**4. `x-kit-text-urls` is deprecated, not removed.** It is still honoured for one release as an
override-by-id merged *after* manifest tracks, and warns once with a doc link (`deprecateOnce`, a sibling of
`warnOnce`, which hard-codes "is a no-op" and would be wrong here). Removed in the next minor.

Not removed now, because `described`'s `TrackSheet` selects with app-composed ids (`captions-en`) that only
resolve through the header map — removing it today would break the app immediately. Not kept permanently,
because the header rides on `source.headers`, which `react-native-video` forwards verbatim to the CDN and
which forces a CORS preflight on web; a legitimate override slot would need a `KitSource` type change.
The kit's own master fetch always strips the header.

**5. `described` migrates on its own schedule, as an app ticket.** The kit ships first.

## The `described` id mismatch, found while planning

`described`'s text ids **never matched the kit's**, independently of this ticket.
`TrackSheet.tsx:25-27` composes `captions-en` / `sdh-en` / `descriptions-en`, while `fromRnvText`
(`src/core/tracks.ts`) sets `id: String(t.index)` — a raw ExoPlayer index. Only the header map made those
ids resolvable, and only on the explicit TrackSheet path; the `preferredText` auto-selection path could
never have matched. KIT-009 fixed the cue gate, but it did not fix this.

The app ticket therefore covers: stop passing the header (`Player.tsx:45`); select by `(kind, language)`
from the tracks reported in `onTracks` instead of composing ids; add
`hls_characteristics=public.accessibility.describes-video` to the descriptions text stream in
`packages/pipeline/src/steps/09-package.ts` (it carries `roles=description` — a DASH alias — but no HLS
characteristic, so its kind currently depends on the "Description text" label heuristic). Note
`selectAudio('audio_ad' | 'audio_main')` at `Player.tsx:58` has the same id-mismatch class.

## Consequences

- New in `./core`: `parseHlsMaster`, `textTracksFromHls`, `audioTracksFromHls`, `resolveUrl`,
  `isMasterPlaylist`, `parseAttributeList`. New in `./player`: `loadHlsTextTracks`. Changeset is `minor`.
- `src/core/types.ts` and `src/player/types.ts` are unchanged.
- KIT-013 (web adapter hard-codes `kind: 'subtitles'`) is closed for manifest-derived tracks as a side
  effect.
- The Fire OS adapter must emit `onTracks` exactly once, after the manifest promise resolves, or
  `preferredText` is never applied — `appliedPrefs` in `KitPlayer.tsx` latches on the first call.
- Out of scope, deliberately: DASH, encryption, byte-range, I-frame playlists, live/EVENT refresh.
