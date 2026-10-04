---
'@moizp/vega-media-kit': minor
---

**Web: a text track that cannot be loaded now reaches `onError`.** When a selected text track fails to load — an HTTP error, a body that is neither WebVTT nor an HLS media playlist, or a network failure — the web adapter now reports a non-fatal `TEXT_FETCH` (`{ code: 'TEXT_FETCH', message: 'Could not load text track <id>', fatal: false, cause }`) through `onError`, one per failed track, as Fire OS already did. Previously the failure was an unhandled promise rejection the app could not observe, and it also stopped every later id in the same `selectText([...])` from loading. Other selected tracks now still load: multi-track text selection is unchanged. Playback state is untouched.

**`fetchHlsVtt` rejects instead of fetching an error page line by line.** It now rejects on a non-2xx response, on a body that is neither WebVTT nor an HLS media playlist (a CDN error page, a master playlist), on a media playlist with no segments, and on a segment that answers non-2xx or is not WebVTT. Previously an error page was treated as a playlist and every one of its lines was requested as a segment, and the joined junk was resolved as if it were captions. It gains an optional second argument, `{ fetch }`. This affects Fire OS too, which shares `fetchHlsVtt`: a broken subtitle URL is now a `TEXT_FETCH` error there, not empty captions.

**`onError` is origin-gated and always reaches the latest prop.** `onError` is no longer called for a source the app has switched away from — on every platform and for every code, including a superseded Vega `SHAKA_*` error — the way `onTracks`, `onState` and WebVTT already were. It is always delivered to the latest `onError` prop, so an inline `onError={(e) => …}` is never stale.

**New in `./core`:** `subtitleBodyKind`, `mediaPlaylistUris` and the type `SubtitleBodyKind` (pure, no I/O). No type changes: `PlayerError` is unchanged.
