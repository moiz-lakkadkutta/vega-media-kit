import type React from 'react'

/** The react-native-video component as the Fire OS adapter uses it. */
export type RnvVideo = React.ComponentType<Record<string, unknown>>

/**
 * The one place the optional peer is loaded. A lazy `require`, so the kit imports cleanly where
 * react-native-video is not installed (Vega, Node). A module of its own so the Fire OS adapter can render
 * under vitest with the component replaced: `vi.mock` intercepts this ES import, but not a `require`
 * inside the adapter (test/fireos-adapter.test.tsx).
 */
export function requireVideo(): RnvVideo {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-video').default as RnvVideo
}
