import type { Cue } from './types'

/**
 * Drives the active-cue set from a position stream, for adapters that cannot emit cue events
 * (ExoPlayer with native text rendering disabled; Shaka on Vega if cue events prove unreliable).
 * Deterministic: same positions in → same emissions out. Handles seeks by full re-evaluation.
 */
export class CueScheduler {
  private byTrack = new Map<string, Cue[]>()
  private activeIds = new Set<string>()
  private lastPos = -1
  private cursor = new Map<string, number>()

  constructor(private onChange: (active: Cue[]) => void) {}

  setTrack(trackId: string, cues: Cue[]): void {
    this.byTrack.set(trackId, [...cues].sort((a, b) => a.start - b.start))
    this.cursor.set(trackId, 0)
    this.lastPos = -1 // force re-evaluation on next update
  }

  removeTrack(trackId: string): void {
    this.byTrack.delete(trackId)
    this.cursor.delete(trackId)
    this.lastPos = -1
  }

  get tracks(): string[] {
    return [...this.byTrack.keys()]
  }

  /** Call at ≤ 4 Hz from onPosition, and immediately after a seek. */
  update(position: number): Cue[] {
    const seeked = position < this.lastPos || this.lastPos < 0
    const next: Cue[] = []
    for (const [trackId, cues] of this.byTrack) {
      let idx = seeked ? 0 : (this.cursor.get(trackId) ?? 0)
      // advance past cues that have ended
      while (idx < cues.length && cues[idx]!.end <= position) idx++
      this.cursor.set(trackId, idx)
      // collect all cues that have started (overlapping cues allowed)
      for (let j = idx; j < cues.length && cues[j]!.start <= position; j++) {
        const c = cues[j]!
        if (c.end > position) next.push(c)
      }
    }
    this.lastPos = position
    const nextIds = new Set(next.map((c) => `${c.trackId}:${c.id}`))
    let changed = nextIds.size !== this.activeIds.size
    if (!changed) for (const id of nextIds) if (!this.activeIds.has(id)) { changed = true; break }
    if (changed) {
      this.activeIds = nextIds
      next.sort((a, b) => a.start - b.start)
      this.onChange(next)
    }
    return next
  }

  /** The next cue boundary after `position` across all tracks, for precise timers. */
  nextBoundary(position: number): number | null {
    let best: number | null = null
    for (const cues of this.byTrack.values()) {
      for (const c of cues) {
        for (const t of [c.start, c.end]) {
          if (t > position && (best === null || t < best)) best = t
        }
        if (c.start > position && best !== null && c.start >= best) break
      }
    }
    return best
  }

  reset(): void {
    this.activeIds.clear()
    this.lastPos = -1
    for (const k of this.cursor.keys()) this.cursor.set(k, 0)
  }
}
