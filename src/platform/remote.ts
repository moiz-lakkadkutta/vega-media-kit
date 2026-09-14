import { useEffect, useRef } from 'react'
import type { TransportControl } from './contentLauncher'

export type RemoteKey = 'back' | 'menu' | 'select' | 'up' | 'down' | 'left' | 'right' | 'playPause' | 'play' | 'pause' | 'rewind' | 'fastForward'
export interface RemoteEvent { key: RemoteKey; longPress: boolean; repeat: boolean }

/** Android/Fire OS keycodes and Vega/RN TV event types mapped to RemoteKey. */
const keyMap: Record<string, RemoteKey> = {
  // RN TV eventType names
  select: 'select', up: 'up', down: 'down', left: 'left', right: 'right', menu: 'menu', back: 'back',
  playPause: 'playPause', play: 'play', pause: 'pause', rewind: 'rewind', fastForward: 'fastForward',
  // Android keycodes as strings
  '4': 'back', '82': 'menu', '23': 'select', '66': 'select', '19': 'up', '20': 'down', '21': 'left', '22': 'right',
  '85': 'playPause', '126': 'play', '127': 'pause', '89': 'rewind', '90': 'fastForward',
}

export function mapKey(raw: string | number): RemoteKey | undefined {
  return keyMap[String(raw)]
}

export function toTransport(k: RemoteKey): TransportControl | undefined {
  switch (k) {
    case 'playPause': return 'togglePlayPause'
    case 'play': return 'play'
    case 'pause': return 'pause'
    case 'rewind': return 'seekBackward'
    case 'fastForward': return 'seekForward'
    default: return undefined
  }
}

/**
 * useRemote: typed key handling with long-press (≥ 500 ms) detection.
 * Wire it to TVEventHandler (RN TV / Vega) in the app; the hook is transport-agnostic so it can be unit-tested.
 */
export function useRemote(onEvent: (e: RemoteEvent) => void, longPressMs = 500) {
  const downAt = useRef<Map<RemoteKey, number>>(new Map())
  const fired = useRef<Set<RemoteKey>>(new Set())
  const cb = useRef(onEvent)
  useEffect(() => { cb.current = onEvent }, [onEvent])
  return {
    keyDown(raw: string | number) {
      const k = mapKey(raw); if (!k) return
      const now = Date.now()
      const prev = downAt.current.get(k)
      if (prev === undefined) { downAt.current.set(k, now); return }
      if (now - prev >= longPressMs && !fired.current.has(k)) { fired.current.add(k); cb.current({ key: k, longPress: true, repeat: false }) }
      else if (fired.current.has(k)) cb.current({ key: k, longPress: true, repeat: true })
    },
    keyUp(raw: string | number) {
      const k = mapKey(raw); if (!k) return
      const wasLong = fired.current.has(k)
      downAt.current.delete(k); fired.current.delete(k)
      if (!wasLong) cb.current({ key: k, longPress: false, repeat: false })
    },
  }
}
