---
'@moizp/vega-media-kit': patch
---

**`CueOverlay`: selectable cues are clamped to two lines.** With `selectable` set, the primary (and top-line) cue was rendered without the two-line limit every other cue has, so an over-long cue grew a third line and pushed the box out of the layout. It is now clamped like the rest. Words past the second line are not visible but still count for `focusedIndex` and keep their accessibility label. `CueOverlay` also uses `aria-label` and `style.pointerEvents` instead of the deprecated `accessibilityLabel` and `pointerEvents` props, and drops `accessibilityRole="text"`, which had no `role` equivalent and no effect beyond a `Text`'s default; what screen readers announce is unchanged, and react-native-web no longer logs a `pointerEvents` deprecation warning. No prop changes.
