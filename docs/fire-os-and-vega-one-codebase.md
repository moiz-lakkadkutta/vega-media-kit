# One UI package on Fire OS and Vega

Amazon's `react-native-multi-tv-app-sample` shows the shape: an **Expo (SDK 54) app** for Fire OS/Android TV and a separate **Vega app** (React Native for Vega 0.72), both importing a `shared-ui` package. Expo is not supported on Vega; the Vega app is a plain RNV project.

Rules that keep `shared-ui` portable:
- Import only libraries on Vega's supported list (reanimated 3.5.x, gesture-handler, react-navigation v6, svg, mmkv, flash-list, expo-font/linear-gradient/sqlite/…). Lint rule: `no-restricted-imports` with everything else.
- Never import `react-native-video` or `@amazon-devices/*` in shared code; use the kit's `KitPlayer` and `platform` bindings.
- Video on Vega is W3C MSE/EME + Shaka, not ExoPlayer. Same HLS manifest, two engines, one `KitPlayer`.
- Fonts via `expo-font` (supported on Vega). Sizes in px@1080p × `scale`.
- Focus: Vega defaults to Cartesian focus with **no platform focus ring** — draw focus yourself (border + scale), keep animations ≤ 150 ms, restore last focus per screen (`useFocusMemory`).
