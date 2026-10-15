---
'@moizp/vega-media-kit': patch
---

Fire OS: `startAt` is now applied. Playback used to start at 0 while `getPosition()` reported `startAt`.
react-native-video's `source.startPosition` now starts each load at `startAt`, with no frame-0 flash and no seek.
`startAt` is read once per `source.uri`. Apps that seeked to `startAt` themselves after `ready` can drop that seek.
