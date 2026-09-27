# One UI package on Fire OS and Vega

Amazon's `react-native-multi-tv-app-sample` shows the shape: an **Expo (SDK 54) app** for Fire OS/Android TV and a separate **Vega app** (React Native for Vega 0.72), both importing a `shared-ui` package. Expo is not supported on Vega; the Vega app is a plain RNV project.

The kit's Vega side is **experimental, not device-verified** ([decision 0001](decisions/0001-week0-gates.md)): the Vega adapter does not play video yet (KIT-010) and the Vega platform bindings are no-ops (KIT-007). The rules below are the target shape; only the Fire OS half has run on a device.

Rules that keep `shared-ui` portable:
- Import only libraries on Vega's supported list (reanimated 3.5.x, gesture-handler, react-navigation v6, svg, mmkv, flash-list, expo-font/linear-gradient/sqlite/…). Lint rule: `no-restricted-imports` with everything else.
- Never import `react-native-video` or `@amazon-devices/*` in shared code; use the kit's `KitPlayer` and `platform` bindings.
- Video on Vega is W3C MSE/EME + Shaka, not ExoPlayer. Same HLS manifest, two engines, one `KitPlayer` — once the Vega adapter rewrite (KIT-010) lands.
- Fonts via `expo-font` (supported on Vega). Sizes in px@1080p × `scale`.
- Focus: Vega defaults to Cartesian focus with **no platform focus ring** — draw focus yourself (border + scale), keep animations ≤ 150 ms, restore last focus per screen (`useFocusMemory`).
