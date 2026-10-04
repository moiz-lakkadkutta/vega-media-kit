---
'@moizp/vega-media-kit': patch
---

**`getTracks()` never answers a previous source.** After `source.uri` changes, `ref.getTracks()` now returns an empty
list until the new source reports its tracks through `onTracks` — the same list `renderControls` is handed — on every
platform. Previously, on web and Vega it kept returning the previous source's tracks while the new one loaded, and on
web indefinitely if the new source failed to load. **Web:** a `selectText([...])` made in that window no longer fetches
the previous source's subtitle playlist for that id and shows its captions on the new source; it selects nothing until
the new source's tracks are in — select by the ids reported for the live source. On every platform, a `selectText`
made before the new source's `onTracks` selects nothing and is not replayed when the tracks arrive. A load that fails after reporting its
own tracks keeps them. No type changes; multi-track text selection is unchanged.
