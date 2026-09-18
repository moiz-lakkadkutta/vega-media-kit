import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import type { AdapterProps, KitPlayerRef } from '../types'
import { FireOsAdapter } from './fireos'
import { VegaAdapter } from './vega'
import { WebAdapter } from './web'

export type Adapter = ForwardRefExoticComponent<AdapterProps & RefAttributes<KitPlayerRef>>

/**
 * React Native for Vega reports Platform.OS as 'kepler' (decision 0002); 'vega' is accepted for forward-compatibility.
 * 'android' is Fire OS. Anything else falls through to the web adapter.
 * Override with KIT_FORCE_ADAPTER=vega|fireos|web for testing.
 */
export function resolveAdapter(os: string): Adapter {
  const forced = (globalThis as { KIT_FORCE_ADAPTER?: string }).KIT_FORCE_ADAPTER
  const key = forced ?? (os === 'vega' || os === 'kepler' ? 'vega' : os === 'android' ? 'fireos' : 'web')
  switch (key) {
    case 'vega': return VegaAdapter
    case 'fireos': return FireOsAdapter
    default: return WebAdapter
  }
}
