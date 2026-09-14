import React from 'react'
import { View } from 'react-native'

/**
 * Thin wrapper around a horizontal focus group. Pass children rendered by react-tv-space-navigation's
 * SpatialNavigationNode/VirtualizedList in the app; this component only fixes the geometry conventions:
 * no wrap-around by default, gutter reserved for focus growth (scale 1.04 on 412 px cards ≈ 17 px).
 */
export interface FocusRowProps { children: React.ReactNode; gutter?: number; testID?: string }
export function FocusRow({ children, gutter = 24, testID }: FocusRowProps) {
  return <View style={{ flexDirection: 'row', columnGap: gutter, paddingVertical: Math.ceil(gutter / 2) }} testID={testID}>{children}</View>
}
