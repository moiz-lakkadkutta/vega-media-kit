import { Platform } from 'react-native'
import { isVega } from './os'
import { DOCS, warnOnce } from './log'
import type { TransportControl } from './contentLauncher'

export interface NowPlaying { title: string; subtitle?: string; artworkUrl?: string; durationS?: number; positionS?: number; playing: boolean }

/**
 * Media Controls: remote media keys and Alexa transport requests ("Alexa, pause").
 * Vega: VegaMediaControl. Fire OS: Android MediaSession (react-native-video exposes basic controls; extend via a
 * small native module if needed — log it as a friction item).
 */
export const mediaControls = {
  setNowPlaying(meta: NowPlaying): void {
    if (isVega()) { /* TODO(spike KIT-007) VegaMediaControl */ return }
    warnOnce('mediaControls.setNowPlaying', Platform.OS, DOCS)
    void meta
  },
  onControl(cb: (c: TransportControl) => void): () => void {
    // Both OSes deliver media keys as key events; see remote.ts. Alexa-originated controls arrive here on Vega.
    handlers.add(cb)
    return () => { handlers.delete(cb) }
  },
  _dispatch(c: TransportControl): void { for (const h of handlers) h(c) },
}
const handlers = new Set<(c: TransportControl) => void>()
