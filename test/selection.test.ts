import { readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url' // node's URL, so fileURLToPath accepts it under lib.dom
import { CueScheduler, parseVtt } from '../src/core'
import type { Cue, TextKind, TextTrack } from '../src/core'
import type { TextPreference } from '../src/player/selection'
import { acceptsTextTrackData, applyTextSelection, autoSelectedTextIds } from '../src/player/selection'

/**
 * NOTE ON WHAT THESE TESTS COVER. `harness()` below re-implements KitPlayer's `selectText`,
 * `handleTracks` and `handleTextTrackData` over the same pure helpers the component uses; it does not
 * render or call KitPlayer. Rendering would drag React Native into a Node-only test run, so this is the
 * deliberate trade. The consequence: if `KitPlayer.tsx` drifts away from the wiring mirrored here, these
 * tests keep passing. Change the component and the harness together, and see the source-level guard in
 * 'KitPlayer wiring' at the bottom for the one drift that is checked directly.
 */

const vtt = (text: string) => `WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n${text}`

const track = (id: string, language: string, kind: TextKind = 'subtitles'): TextTrack =>
  ({ id, language, label: `${language} – ${kind}`, kind, active: false })

/**
 * Mirrors KitPlayer's wiring with the same pure helpers the component uses: the selected-id ref,
 * the scheduler, the `preferredText` auto-selection path and the fetched-VTT gate.
 * Nothing here imports React or React Native, so it runs in plain Node.
 */
function harness() {
  const emitted: string[][] = []
  const adapterCalls: string[][] = []
  const scheduler = new CueScheduler((active: Cue[]) => emitted.push(active.map((c) => `${c.trackId}:${c.id}`)))
  let selected = new Set<string>()
  let position = 0 // stands in for adapterRef.current.getPosition()

  const selectText = (ids: string[]) => {
    const next = applyTextSelection(ids, scheduler.tracks)
    selected = next.selected
    for (const t of next.prune) scheduler.removeTrack(t)
    if (next.prune.length) scheduler.update(position) // removeTrack does not notify on its own
    adapterCalls.push(ids)
  }
  /**
   * The `preferredText` branch of handleTracks. It calls the component's own decision function rather
   * than a copy of it, so the auto-selection tests below exercise the code KitPlayer actually runs.
   */
  const handleTracks = (text: TextTrack[], preferredText?: TextPreference) => {
    const tx = autoSelectedTextIds(text, preferredText)
    if (tx.length) selectText(tx)
  }
  /** handleTextTrackData; returns whether the VTT was accepted rather than dropped. */
  const handleTextTrackData = (trackId: string, text: string) => {
    if (!acceptsTextTrackData(selected, trackId)) return false
    scheduler.setTrack(trackId, parseVtt(vtt(text), { trackId }))
    return true
  }
  /** handlePosition: the adapter's position advances and the scheduler re-evaluates. */
  const tick = (s: number) => {
    position = s
    scheduler.update(s)
  }
  return {
    emitted, adapterCalls, scheduler, selectText, handleTracks, handleTextTrackData, tick,
    selectedIds: () => [...selected].sort(),
  }
}

describe('text selection state', () => {
  it('auto-selection via preferredText populates the selected set, so fetched VTT is not dropped', () => {
    const h = harness()
    h.handleTracks([track('de', 'de'), track('en', 'en')], { languages: ['de'] })
    expect(h.selectedIds()).toEqual(['de'])
    expect(h.adapterCalls).toEqual([['de']]) // still forwarded to the adapter
    expect(h.handleTextTrackData('de', 'Hallo')).toBe(true)
    h.scheduler.update(2)
    expect(h.emitted.at(-1)).toEqual(['de:c1'])
  })

  it('drops VTT for tracks that were never selected', () => {
    const h = harness()
    h.handleTracks([track('de', 'de'), track('en', 'en')], { languages: ['de'] })
    expect(h.handleTextTrackData('de', 'Hallo')).toBe(true)
    expect(h.handleTextTrackData('en', 'Hello')).toBe(false)
    expect(h.scheduler.tracks).toEqual(['de'])
  })

  it('keeps every requested track when several are selected at once', () => {
    const h = harness()
    h.selectText(['de', 'en'])
    expect(h.selectedIds()).toEqual(['de', 'en'])
    expect(h.handleTextTrackData('de', 'Hallo')).toBe(true)
    expect(h.handleTextTrackData('en', 'Hello')).toBe(true)
    h.scheduler.update(2)
    expect(h.emitted.at(-1)).toEqual(['de:c1', 'en:c1'])
  })

  it('auto-selects several tracks when preferredText matches more than one', () => {
    const h = harness()
    h.handleTracks([track('de', 'de'), track('en', 'en'), track('fr', 'fr')], { languages: ['de', 'en'] })
    expect(h.selectedIds()).toEqual(['de', 'en'])
    expect(h.adapterCalls).toEqual([['de', 'en']])
  })

  it('prunes exactly the tracks no longer selected and no others', () => {
    const h = harness()
    h.selectText(['de', 'en', 'ad'])
    for (const id of ['de', 'en', 'ad']) h.handleTextTrackData(id, id)
    expect(h.scheduler.tracks.sort()).toEqual(['ad', 'de', 'en'])
    h.selectText(['de', 'ad'])
    expect(h.selectedIds()).toEqual(['ad', 'de'])
    expect(h.scheduler.tracks.sort()).toEqual(['ad', 'de'])
    expect(h.handleTextTrackData('en', 'Hello')).toBe(false)
  })

  it('selectText([]) clears the set and prunes every scheduler track', () => {
    const h = harness()
    h.selectText(['de', 'en'])
    for (const id of ['de', 'en']) h.handleTextTrackData(id, id)
    h.selectText([])
    expect(h.selectedIds()).toEqual([])
    expect(h.scheduler.tracks).toEqual([])
    expect(h.handleTextTrackData('de', 'Hallo')).toBe(false)
  })

  it('auto-selects nothing when preferredText is absent', () => {
    const h = harness()
    h.handleTracks([track('de', 'de'), track('en', 'en'), track('ad', 'en', 'descriptions')])
    expect(h.selectedIds()).toEqual([])
    expect(h.adapterCalls).toEqual([]) // the adapter is not told to turn anything on either
    for (const id of ['de', 'en', 'ad']) expect(h.handleTextTrackData(id, id)).toBe(false)
    expect(h.scheduler.tracks).toEqual([])
    h.tick(2)
    expect(h.emitted).toEqual([])
  })

  it('captions-off ({ kinds: [] }) selects nothing, so every fetched VTT is dropped and no cue is emitted', () => {
    // The shape the consuming app passes when its caption preference is 'off':
    // preferredText={{ kinds: captionKind === 'off' ? [] : [captionKind] }}
    const h = harness()
    const text = [track('en-cc', 'en', 'captions'), track('de-cc', 'de', 'captions'), track('ad', 'en', 'descriptions')]
    h.handleTracks(text, { kinds: [] })
    expect(h.selectedIds()).toEqual([])
    expect(h.adapterCalls).toEqual([])
    for (const t of text) expect(h.handleTextTrackData(t.id, t.id)).toBe(false)
    h.tick(2)
    expect(h.emitted).toEqual([])
  })

  it('deselecting while paused emits the updated active set without waiting for a position tick', () => {
    const h = harness()
    h.selectText(['de', 'en'])
    for (const id of ['de', 'en']) h.handleTextTrackData(id, id)
    h.tick(2)
    expect(h.emitted.at(-1)).toEqual(['de:c1', 'en:c1'])

    const before = h.emitted.length
    h.selectText(['de']) // TrackSheet turns one track off while paused: no onPosition will follow
    expect(h.emitted.length).toBe(before + 1)
    expect(h.emitted.at(-1)).toEqual(['de:c1'])

    h.selectText([]) // text off entirely: the overlay must clear now, not on the next tick
    expect(h.emitted.at(-1)).toEqual([])
  })

  it('applyTextSelection reports the new set and the pruned ids without touching its inputs', () => {
    const schedulerTracks = ['de', 'en']
    const { selected, prune } = applyTextSelection(['en', 'fr'], schedulerTracks)
    expect([...selected]).toEqual(['en', 'fr'])
    expect(prune).toEqual(['de'])
    expect(schedulerTracks).toEqual(['de', 'en'])
  })
})

/**
 * The auto-selection decision on its own. These run against the same function KitPlayer calls, so
 * unlike the harness tests above they fail if the decision itself changes — including the absent-preference
 * guard, which `pickText` cannot provide: `pickText(tracks, undefined)` returns every track on purpose.
 */
describe('autoSelectedTextIds', () => {
  const text = () => [track('de', 'de'), track('en', 'en'), track('ad', 'en', 'descriptions')]

  it('selects nothing when the preference is absent', () => {
    expect(autoSelectedTextIds(text())).toEqual([])
    expect(autoSelectedTextIds(text(), undefined)).toEqual([])
  })

  it('selects nothing for captions-off ({ kinds: [] })', () => {
    expect(autoSelectedTextIds(text(), { kinds: [] })).toEqual([])
  })

  it('selects every matching track, in the preference order, when several languages are wanted', () => {
    const two = [track('de', 'de'), track('en', 'en')]
    expect(autoSelectedTextIds(two, { languages: ['de', 'en'] })).toEqual(['de', 'en'])
    expect(autoSelectedTextIds(two, { languages: ['en', 'de'] })).toEqual(['en', 'de'])
  })

  // PINNED, NOT ENDORSED. A present-but-empty preference selects EVERY track, because `pickText` reads an
  // omitted key as "any" (see pickText's doc comment and docs/decisions/0003-text-selection-defaults.md).
  // An app building the object dynamically — `{ languages: userLangs }` with `userLangs` undefined — lands
  // here. These tests record the behaviour so a change to it is a visible decision, not an accident.
  it('pins that a present-but-empty preference selects every track', () => {
    expect(autoSelectedTextIds(text(), {})).toEqual(['de', 'en', 'ad'])
    expect(autoSelectedTextIds(text(), { languages: undefined })).toEqual(['de', 'en', 'ad'])
    expect(autoSelectedTextIds(text(), { languages: undefined, kinds: undefined })).toEqual(['de', 'en', 'ad'])
  })

  it('does not reorder or otherwise mutate the caller’s track list', () => {
    const tracks = [track('de', 'de'), track('en', 'en')]
    autoSelectedTextIds(tracks, { languages: ['en', 'de'] })
    expect(tracks.map((t) => t.id)).toEqual(['de', 'en'])
  })
})

describe('KitPlayer wiring', () => {
  it('routes every text selection through the shared selectText callback', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/player/KitPlayer.tsx', import.meta.url)), 'utf8')
    // Guards the regression at its source: the preferredText path must not reach the adapter directly,
    // or the selected set stays empty and every cue is dropped. The harness above cannot see this,
    // because it mirrors the wiring rather than running the component.
    expect(src.match(/adapterRef\.current[?!]?\.selectText\(/g)).toHaveLength(1)
  })

  it('routes the preferredText auto-selection through autoSelectedTextIds', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/player/KitPlayer.tsx', import.meta.url)), 'utf8')
    // Same spirit as the assertion above, for the other half of the wiring. The absent-preference guard
    // used to be an inline ternary in the component, where no test could reach it — dropping it silently
    // auto-selected every text track. It is now a tested function, so what has to be guarded at source is
    // that the component still calls it, and does not reach for `pickText` (which selects everything when
    // handed no preference) again.
    expect(src.match(/autoSelectedTextIds\(/g)).toHaveLength(1)
    expect(src).not.toMatch(/\bpickText\b/)
  })
})
