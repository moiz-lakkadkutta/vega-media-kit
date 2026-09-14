import { Platform } from 'react-native'
import { isVega } from './os'
import { DOCS, warnOnce } from './log'

/** Content Personalization: "continue watching" and watchlist signals to the Fire TV home experience. */
export const personalization = {
  async reportPlayback(itemId: string, positionS: number, durationS: number): Promise<void> {
    if (isVega()) {
      // TODO(spike KIT-007): Vega Content Personalization API from vega-video-sample.
      return
    }
    warnOnce('personalization.reportPlayback', Platform.OS, DOCS)
    void itemId; void positionS; void durationS
  },
  async setWatchlist(itemId: string, inList: boolean): Promise<void> {
    if (isVega()) return
    warnOnce('personalization.setWatchlist', Platform.OS, DOCS)
    void itemId; void inList
  },
}
