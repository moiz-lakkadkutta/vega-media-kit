---
'@moizp/vega-media-kit': minor
---

The kit now reads text tracks from the HLS master playlist (`#EXT-X-MEDIA:TYPE=SUBTITLES`), so `TextTrack.url`
is populated by the kit on Fire OS and web and `CHARACTERISTICS` decide the track kind. New in `./core`:
`parseHlsMaster`, `textTracksFromHls`, `audioTracksFromHls`, `resolveUrl`, `isMasterPlaylist`,
`parseAttributeList`; in `./player`: `loadHlsTextTracks`. `fetchHlsVtt` is unchanged. **Deprecated:**
`source.headers['x-kit-text-urls']` — still honoured as an override for one release, warns once, removed in
the next minor; select text tracks by the ids reported in `onTracks` instead. Multi-track text selection is
unchanged.
