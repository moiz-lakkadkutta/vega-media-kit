import type React from 'react'

/** The w3cmedia module as the Vega adapter uses it. */
export type W3cMedia = { VideoPlayer: React.ComponentType<Record<string, unknown>> }

/**
 * The one place the Vega peers are loaded. Lazy `require`s, so the kit imports cleanly where they are not installed
 * (Fire OS, Node). A module of its own so the Vega adapter can render under vitest with both replaced: `vi.mock`
 * intercepts this ES import, not a `require` inside the adapter (test/vega-adapter-tracks.test.tsx). Names unchanged
 * from the scaffold; they are confirmed (or not) by KIT-010 on the VVD.
 */
export function requireW3cMedia(): W3cMedia {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@amazon-devices/react-native-w3cmedia') as W3cMedia
}
export function requireShaka(): typeof import('shaka-player') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('shaka-player') as typeof import('shaka-player') // installed via the sample's post-install step
}
