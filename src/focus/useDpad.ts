import { useRef } from 'react'

/**
 * Throttle key-repeat so long animations aren't skipped (Amazon: keep focus animations short; store last focus).
 * Returns true when the event should be handled.
 */
export function useDpad(minIntervalMs = 120) {
  const last = useRef(0)
  return function shouldHandle(): boolean {
    const now = Date.now()
    if (now - last.current < minIntervalMs) return false
    last.current = now
    return true
  }
}
