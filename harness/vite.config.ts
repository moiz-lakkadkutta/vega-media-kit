import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Serves the fixtures at / for `harness:dev`. The overlay page is the fully working dev target; the player
  // page needs `?src=/stream/master.m3u8` there (tracks and events show, the video itself will not play in
  // Chrome — the specs' Playwright route is what serves the WebM). Tests never rely on publicDir.
  publicDir: 'fixtures',
  resolve: { alias: [{ find: /^react-native$/, replacement: 'react-native-web' }] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { include: ['react-native-web'] },
  server: { port: 4173, strictPort: true },
})
