import { Platform } from 'react-native'
import { isVega } from './os'
import { DOCS, VEGA_DOCS, VEGA_EXPERIMENTAL, warnOnce } from './log'

export type Rating = 'all' | '6' | '12' | '16' | '18'
export const parentalControls = {
  async isRestricted(rating: Rating): Promise<boolean> {
    if (isVega()) {
      // TODO: Vega Parental Controls (VVD ≥ 0.24)
      warnOnce('parentalControls.isRestricted', Platform.OS, VEGA_DOCS, VEGA_EXPERIMENTAL)
      void rating
      return false
    }
    warnOnce('parentalControls.isRestricted', Platform.OS, DOCS)
    return false
  },
  async requestPin(): Promise<boolean> {
    if (isVega()) {
      warnOnce('parentalControls.requestPin', Platform.OS, VEGA_DOCS, VEGA_EXPERIMENTAL)
      return true
    }
    warnOnce('parentalControls.requestPin', Platform.OS, DOCS)
    return true
  },
}
