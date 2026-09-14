import { Platform } from 'react-native'
import { isVega } from './os'
import { DOCS, warnOnce } from './log'

export interface CatalogItem {
  id: string
  title: string
  synopsis?: string
  durationS?: number
  posterUrl?: string
  /** Deep link the platform will use to launch this item. */
  uri: string
}
export interface LaunchIntent { itemId: string; positionS?: number; source: 'search' | 'voice' | 'row' | 'unknown' }
export type TransportControl = 'play' | 'pause' | 'togglePlayPause' | 'stop' | 'next' | 'previous' | 'seekForward' | 'seekBackward'

let intentHandler: ((i: LaunchIntent) => void) | null = null
let transportHandler: ((c: TransportControl) => void) | null = null

/**
 * Content Launcher: makes your titles appear in Fire TV universal search and voice ("Alexa, play Sintel on Described").
 * Vega: wraps the Vega Content Launcher service. Test on the virtual device with `journalctl` per Amazon's
 * content-launcher-testing doc. Fire OS: catalog integration is a submission-time process (no runtime API here);
 * the kit logs the intent shape so you can validate your deep links.
 */
export const contentLauncher = {
  async registerCatalog(items: CatalogItem[]): Promise<void> {
    if (isVega()) {
      // TODO(spike KIT-007): confirm import + API from vega-video-sample's Content Launcher integration.
      // const { ContentLauncherServer } = require('@amazon-devices/kepler-media-content-launcher')
      return
    }
    warnOnce('contentLauncher.registerCatalog', Platform.OS, DOCS)
    // eslint-disable-next-line no-console
    console.debug('[vega-media-kit] catalog (Fire OS: submit via Fire TV Catalog Integration):', items.map((i) => ({ id: i.id, uri: i.uri })))
  },
  onLaunchIntent(cb: (intent: LaunchIntent) => void): () => void {
    intentHandler = cb
    return () => { if (intentHandler === cb) intentHandler = null }
  },
  onTransportControl(cb: (control: TransportControl) => void): () => void {
    transportHandler = cb
    return () => { if (transportHandler === cb) transportHandler = null }
  },
  /** For tests and for the Vega binding to dispatch into. */
  _dispatchIntent(i: LaunchIntent): void { intentHandler?.(i) },
  _dispatchTransport(c: TransportControl): void { transportHandler?.(c) },
}
