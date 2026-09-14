import { useCallback, useRef } from 'react'

const memory = new Map<string, string>()

/**
 * Remember the last focused element id per screen and restore it when the screen regains focus.
 * On Vega, call `restore()` from `useFocusEffect` and pass a resolver that maps id → FocusManager.focus(ref).
 * On Fire OS, pass a resolver that sets `hasTVPreferredFocus` / calls `requestTVFocus` on the matching ref.
 */
export function useFocusMemory(screenKey: string, resolver: (id: string) => void) {
  const lastId = useRef<string | undefined>(memory.get(screenKey))
  const remember = useCallback((id: string) => { lastId.current = id; memory.set(screenKey, id) }, [screenKey])
  const restore = useCallback(() => { const id = memory.get(screenKey); if (id) resolver(id) }, [screenKey, resolver])
  const forget = useCallback(() => { memory.delete(screenKey); lastId.current = undefined }, [screenKey])
  return { remember, restore, forget, lastId }
}

/** Test seam. */
export function _resetFocusMemory(): void { memory.clear() }
