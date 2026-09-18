---
'@moizp/vega-media-kit': patch
---

The web adapter now resolves HLS subtitle media playlists through `fetchHlsVtt` before handing text to the
scheduler, so manifest-derived text tracks (`#EXT-X-MEDIA:TYPE=SUBTITLES` with a `.m3u8` URI) deliver cues on
web instead of none. Bare `.vtt` URLs — including entries from the deprecated `x-kit-text-urls` header — are
fetched exactly as before. Multi-track text selection is unchanged.
