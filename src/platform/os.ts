import { Platform } from 'react-native'
/** React Native for Vega reports its own OS name; typed as string so the comparison survives RN's Platform typings. */
export function isVega(): boolean {
  const os = Platform.OS as string
  return os === 'vega' || os === 'kepler'
}
