# Changelog

## Unreleased
- `KitPlayerRef.setVolume(v)`: output volume 0–1, clamped, `NaN` ignored; a prop update with no reload, for fades around `selectAudio`. Fire OS: react-native-video `volume`; web: `HTMLMediaElement.volume`; Vega: no-op that logs once (experimental). Described DESC-006.
- Initial scaffold: core types, WebVTT parser, cue scheduler, track normalization, CueOverlay, KitPlayer with Fire OS / Vega / web adapters, platform bindings, focus helpers.
