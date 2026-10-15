---
'@moiz0309/vega-media-kit': minor
---

**Fire OS and Vega report `onState('error')` after a fatal error.** As on web since the last release, a source that cannot be loaded or played now reports its fatal error through `onError` and then `onState('error')`; no `ready` follows. Previously Fire OS stayed at `loading`/`buffering` (or showed `paused` after a mid-playback failure). Fire OS: ExoPlayer's behind-live-window error (`cause.error.errorCode === '21002'`), which react-native-video recovers from by itself, is now `fatal: false` and changes no state. Vega (experimental): a Shaka error is fatal only when Shaka marks it CRITICAL, and a failed load now reaches `onError` instead of being an unhandled rejection. `HLS_MASTER` and `TEXT_FETCH` remain non-fatal and never change the state. To try again, change `source`. Apps that only read `buffering` / `paused` / `ended` see nothing new; an error UI keyed on `onError` keeps working.
