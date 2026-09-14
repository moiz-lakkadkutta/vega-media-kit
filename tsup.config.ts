import { defineConfig } from 'tsup'
export default defineConfig({
  entry: { index: 'src/index.ts', 'core/index': 'src/core/index.ts', 'player/index': 'src/player/index.ts', 'cues/index': 'src/cues/index.ts', 'platform/index': 'src/platform/index.ts', 'focus/index': 'src/focus/index.ts' },
  format: ['esm', 'cjs'], dts: true, sourcemap: true, clean: true, splitting: false, treeshake: true,
  external: ['react', 'react-native', 'react-native-video', 'shaka-player', '@amazon-devices/react-native-w3cmedia', '@amazon-devices/react-native-kepler', 'react-tv-space-navigation'],
})
