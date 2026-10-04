---
'@moizp/vega-media-kit': minor
---

**`KitPlayerRef.setVolume(v)`.** Sets the output volume from `0` (silent) to `1` (full, the default). Values are clamped to [0, 1] and `NaN` is ignored. It is a property update on the playing source — no reload, no re-buffer, no re-mount of react-native-video — so an app can step it to fade the audio around `selectAudio`. Kept across source changes. Fire OS passes react-native-video's `volume` prop; web sets `HTMLMediaElement.volume`; on Vega (experimental) it is a no-op that logs once at debug level. Code that implements `KitPlayerRef` itself (test doubles) needs a `setVolume` member.
