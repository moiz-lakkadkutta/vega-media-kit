import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cueIds, deferred, events, metadataLoaded, routeStream } from './helpers'

/**
 * The real KitPlayer + WebAdapter in Chromium (plan §5, specs 10–16): `onTracks` ordering against a real
 * `loadedmetadata`, `preferredText`, Q7, multi-track cue delivery from one `selectText([...])`, the deprecated
 * header bridge and `timeupdate`. Cue timing goes through `ref.seek()` (synchronous `scheduler.update`); only
 * the playback specs play the element for real. Specs 19–20 (KIT-012): an inline `onCue` must not rebuild the
 * scheduler, and the `ref` handed to `renderControls` must not change identity on position ticks or `onTracks`.
 * Specs 21–23 (KIT-019): a source switch tears down the previous load — no leaked listeners, no stale `onTracks`.
 * Spec 24 (KIT-026): a cue repeated across HLS segment boundaries (RFC 8216 §3.5) reaches `onCue` once and the
 * overlay draws it once, per track. Spec 25 (KIT-022 §7.2): pins why the web adapter's cancel holds on every
 * update lane — a DefaultLane switch still runs the adapter's passive cleanup inside the switch's commit.
 * Specs 10–11 (KIT-015): `ready` is reported from the join, after `onTracks`; spec 26 (KIT-028): the kit drops a
 * `ready` that would overwrite `playing`.
 */
const BASE = 'http://localhost:4173'
const trackEvents = (page: Page) => events(page).then((e) => e.filter((x) => x.type === 'tracks'))
const hasState = (page: Page, s: string) => events(page).then((e) => e.some((x) => x.type === 'state' && x.state === s))
const selectText = (page: Page, ids: string[]) => page.evaluate((ids) => window.__kit.ref!.selectText(ids), ids)
const waitForTracks = (page: Page) => expect.poll(() => trackEvents(page).then((t) => t.length)).toBe(1)
const stateEvents = (page: Page, s: string) => events(page).then((e) => e.filter((x) => x.type === 'state' && x.state === s).length)
/** `onTracks` precedes `state:ready` in the event log (KIT-015). */
const expectTracksBeforeReady = async (page: Page) => {
  const e = await events(page)
  expect(e.findIndex((x) => x.type === 'tracks')).toBeGreaterThanOrEqual(0)
  expect(e.findIndex((x) => x.type === 'tracks')).toBeLessThan(e.findIndex((x) => x.type === 'state' && x.state === 'ready'))
}

const MANIFEST_TRACKS = [
  { id: '0', language: 'de', label: 'Deutsch', kind: 'subtitles', active: false, url: `${BASE}/stream/subs/de/index.m3u8` },
  { id: '1', language: 'en', label: 'English', kind: 'subtitles', active: false, url: `${BASE}/stream/subs/en/index.m3u8` },
]
/** Stream B (`master-b`): the same ids '0'/'1' on purpose (ids are ordinals, decision 0004), different cue text. */
const MANIFEST_TRACKS_B = MANIFEST_TRACKS.map((t) => ({ ...t, url: t.url.replace('/stream/subs/', '/stream/subs-b/') }))
const cueText = (page: Page, t: number) => page.evaluate((t) => window.__kit.seek(t).map((c) => c.text), t)
/** Switch the page's source and return exactly the events the switch itself logged (setSource is synchronous). */
const setSource = (page: Page, uri: string) =>
  page.evaluate((uri) => {
    const n = window.__kit.events.length
    window.__kit.setSource(uri)
    return window.__kit.events.slice(n)
  }, uri)

test('onTracks and ready wait for the manifest: nothing is published on loadedmetadata alone', async ({ page }) => {
  const m = deferred()
  await routeStream(page, { manifest: m.promise })
  await page.goto('/player.html')
  await expect.poll(() => metadataLoaded(page)).toBe(true)
  expect(await trackEvents(page)).toHaveLength(0)
  expect(await stateEvents(page, 'ready')).toBe(0)
  m.resolve()
  await waitForTracks(page)
  await expect.poll(() => hasState(page, 'ready')).toBe(true)
  await expectTracksBeforeReady(page)
  const [t] = await trackEvents(page)
  expect(t!.type === 'tracks' && t!.tracks.text).toEqual(MANIFEST_TRACKS)
  await page.waitForTimeout(300)
  expect(await trackEvents(page)).toHaveLength(1)
})

test('onTracks waits for loadedmetadata, and ready follows onTracks: a resolved manifest alone publishes nothing', async ({ page }) => {
  const md = deferred()
  const hits = await routeStream(page, { media: md.promise })
  await page.goto('/player.html')
  await expect.poll(() => hits).toContain('fetch master')
  await page.waitForTimeout(500)
  expect(await trackEvents(page)).toHaveLength(0)
  expect(await hasState(page, 'ready')).toBe(false)
  md.resolve()
  await waitForTracks(page)
  // Both land only once the element has its metadata, and `ready` after `onTracks` (decision 0008).
  await expect.poll(() => hasState(page, 'ready')).toBe(true)
  expect(await trackEvents(page)).toHaveLength(1)
  await expectTracksBeforeReady(page)
  expect(await stateEvents(page, 'ready')).toBe(1)
})

test('preferredText auto-selects a manifest track even when the manifest lands after loadedmetadata', async ({ page }) => {
  const m = deferred()
  await routeStream(page, { manifest: m.promise })
  await page.goto('/player.html?preferred=' + encodeURIComponent('{"languages":["en"]}'))
  await expect.poll(() => metadataLoaded(page)).toBe(true)
  m.resolve()
  // No selectText from the test: the appliedPrefs latch (decision 0004) must fire on the manifest tracks.
  await expect.poll(() => cueIds(page, 2)).toEqual(['1:c1'])
})

test('Q7: a manifest .m3u8 subtitle track is resolved through its segments', async ({ page }) => {
  const hits = await routeStream(page)
  await page.goto('/player.html')
  await waitForTracks(page)
  await selectText(page, ['1'])
  await expect.poll(() => cueIds(page, 9)).toEqual(['1:c3']) // segment 2, 8–10 s
  expect(await cueIds(page, 2)).toEqual(['1:c1'])
  expect(await cueIds(page, 7.5)).toEqual([])
  for (const h of ['fetch subs/en/index.m3u8', 'fetch subs/en/seg-0.vtt', 'fetch subs/en/seg-1.vtt']) expect(hits).toContain(h)
  // The media playlist itself never reaches the scheduler as text.
  for (const t of [0.5, 2, 5, 9, 12]) {
    const texts = await page.evaluate((t) => window.__kit.seek(t).map((c) => c.text), t)
    for (const x of texts) expect(x.startsWith('#')).toBe(false)
  }
})

test("one selectText with two ids delivers both tracks' cues and the overlay stacks them", async ({ page }) => {
  const hits = await routeStream(page)
  await page.goto('/player.html?primary=0')
  await waitForTracks(page)
  await selectText(page, ['0', '1'])
  await expect.poll(() => cueIds(page, 2).then((ids) => ids.sort())).toEqual(['0:c1', '1:c1'])
  // Read in the same task as the seek, so a later timeupdate cannot repaint between the seek and the read.
  const snap = await page.evaluate(() => window.__kit.seekSnapshot(2))
  expect(snap.ids.sort()).toEqual(['0:c1', '1:c1'])
  expect(snap.boxes).toHaveLength(2)
  expect(snap.boxes[0]).toMatchObject({ text: 'Hello world', fontSize: '32px' }) // secondary (en) above
  expect(snap.boxes[1]).toMatchObject({ text: 'Hallo Welt', fontSize: '44px' }) // primary (de) below
  expect(snap.boxes[0]!.top).toBeLessThan(snap.boxes[1]!.top)
  for (const h of ['fetch subs/de/index.m3u8', 'fetch subs/de/seg-0.vtt', 'fetch subs/de/seg-1.vtt', 'fetch subs/en/index.m3u8', 'fetch subs/en/seg-0.vtt', 'fetch subs/en/seg-1.vtt'])
    expect(hits).toContain(h)
})

test('deprecated x-kit-text-urls still adds ids the manifest did not produce, after the manifest tracks', async ({ page }) => {
  await routeStream(page)
  await page.goto('/player.html?textUrls=' + encodeURIComponent('{"legacy-en":"/stream/legacy-en.vtt"}'))
  await waitForTracks(page)
  const [t] = await trackEvents(page)
  const text = t!.type === 'tracks' ? t!.tracks.text : []
  expect(text.map((x) => x.id)).toEqual(['0', '1', 'legacy-en'])
  expect(text[2]).toEqual({ id: 'legacy-en', language: 'legacy', label: 'legacy-en', kind: 'subtitles', active: false, url: '/stream/legacy-en.vtt' })
  await selectText(page, ['legacy-en'])
  await expect.poll(() => cueIds(page, 2.5)).toEqual(['legacy-en:L1'])
})

test('a playing element drives cues through timeupdate', async ({ page }) => {
  await routeStream(page)
  await page.goto('/player.html')
  await waitForTracks(page)
  await selectText(page, ['0'])
  await expect.poll(() => cueIds(page, 2)).toEqual(['0:c1']) // the VTT arrived (nothing starts before 1.0 s)
  expect(await cueIds(page, 0)).toEqual([]) // back to 0, nothing active
  const before = (await events(page)).length // the seeks above logged their own cue events; count only playback's
  await page.evaluate(() => window.__kit.play())
  await expect
    .poll(() => events(page).then((e) => e.slice(before).some((x) => x.type === 'cue' && x.ids.includes('0:c1'))), { timeout: 5_000 })
    .toBe(true)
  expect(await hasState(page, 'playing')).toBe(true)
  expect(await page.getByTestId('kit-video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(1)
})

test('switching source clears the cues and re-applies preferredText to the new source', async ({ page }) => {
  await routeStream(page)
  await page.goto('/player.html?preferred=' + encodeURIComponent('{"languages":["de"]}'))
  await waitForTracks(page)
  await expect.poll(() => cueText(page, 2)).toEqual(['Hallo Welt']) // A's de is '0', auto-selected, cue on screen

  const during = await setSource(page, '/stream/master-b')
  // (a) The reset itself emits onCue([]) — once, synchronously, before B has loaded anything (0005 §2.3).
  expect(during.filter((e) => e.type === 'cue')).toEqual([{ type: 'cue', ids: [] }])
  expect(during.some((e) => e.type === 'tracks')).toBe(false) // no synthetic onTracks (0005 §3)

  // (b) Exactly one more onTracks, and it is B's list: same ids, B's urls.
  await expect.poll(() => trackEvents(page).then((t) => t.length)).toBe(2)
  const [, b] = await trackEvents(page)
  expect(b!.type === 'tracks' && b!.tracks.text).toEqual(MANIFEST_TRACKS_B)

  // (c) preferredText is re-applied on B: id '0' again, but B's text — and A's text never reappears in between.
  const seen: string[][] = []
  await expect
    .poll(async () => {
      const t = await cueText(page, 2)
      seen.push(t)
      return t
    })
    .toEqual(['Zweite Quelle'])
  for (const sample of seen) expect([[], ['Zweite Quelle']]).toContainEqual(sample)
  expect(await cueIds(page, 2)).toEqual(['0:c1']) // the id collides with A's by construction; only the text tells
  await page.waitForTimeout(300)
  expect(await trackEvents(page)).toHaveLength(2)
})

test('VTT fetched for the previous source is dropped even though the new source selected the same id', async ({ page }) => {
  // A's fetch for '0' is held on one of its segments (fetchHlsVtt joins all segments before delivering), so it
  // resolves only after B has selected '0' and B's own VTT has landed — the race in 0005 §4, made deterministic.
  const late = deferred()
  const hits = await routeStream(page, { hold: { 'subs/de/seg-1.vtt': late.promise } })
  await page.goto('/player.html?preferred=' + encodeURIComponent('{"languages":["de"]}'))
  await waitForTracks(page)
  await expect.poll(() => hits).toContain('fetch subs/de/seg-1.vtt') // A's fetch is in flight
  expect(await cueText(page, 2)).toEqual([]) // and has not delivered

  await setSource(page, '/stream/master-b')
  await expect.poll(() => cueText(page, 2)).toEqual(['Zweite Quelle']) // B selected '0' and its VTT landed

  const delivered = page.waitForResponse('**/stream/subs/de/seg-1.vtt').then((r) => r.finished())
  late.resolve() // A's VTT for '0' arrives now, through the handler A's selectText captured
  await delivered // the body is in the page; fetchHlsVtt's join and the adapter's onTextTrackData are microtasks away
  await page.waitForTimeout(500)
  // Seek where B has nothing first: A's c3 (8–10 s) would show up here. It also empties the active set, so the
  // t=2 read below is a fresh emission — A's and B's first cue are both '0:c1', and a same-id replacement is
  // invisible to the scheduler's id-based change detection; only the text tells, and only after a change.
  expect(await cueText(page, 9)).toEqual([]) // A's second segment did not land
  expect(await cueText(page, 2)).toEqual(['Zweite Quelle']) // still B, not 'Hallo Welt'
})

test('an inline onCue does not rebuild the scheduler: cues survive re-renders', async ({ page }) => {
  // `?inlineCallbacks=1`: onCue/onPosition are fresh arrows on every App render, the way an app that did not
  // read the README passes them. The scheduler must be constructed once and read the latest onCue through a
  // ref; if it is keyed on onCue's identity, every render drops every loaded track and t=2 reads `[]`.
  await routeStream(page)
  await page.goto('/player.html?inlineCallbacks=1&preferred=' + encodeURIComponent('{"languages":["de"]}'))
  await waitForTracks(page)
  await expect.poll(() => cueIds(page, 2)).toEqual(['0:c1']) // de auto-selected, VTT landed in the scheduler
  const renders = await page.evaluate(() => window.__kit.renders())
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__kit.rerender())
  expect(await page.evaluate(() => window.__kit.renders())).toBeGreaterThanOrEqual(renders + 3) // KitPlayer did re-render
  // Leave the active set first: the scheduler only emits on change, so a stale `kit.active` cannot pass for a cue.
  expect(await cueIds(page, 0)).toEqual([])
  expect(await cueIds(page, 2)).toEqual(['0:c1'])
})

test('the ref handed to renderControls is stable across position ticks and onTracks', async ({ page }) => {
  await routeStream(page)
  await page.goto('/player.html')
  await waitForTracks(page) // onTracks → setTracks → a re-render; api must not follow `tracks`
  await page.evaluate(() => window.__kit.play())
  await expect.poll(() => page.evaluate(() => window.__kit.positionTicks), { timeout: 5_000 }).toBeGreaterThanOrEqual(3)
  // Each timeupdate → setPosition → a re-render of KitPlayer, so the assertion below is not vacuous.
  expect(await page.evaluate(() => window.__kit.renders())).toBeGreaterThanOrEqual(4)
  expect(await page.evaluate(() => window.__kit.refIdentities())).toBe(1)
})

// KIT-019: the web adapter's load effect must tear down the previous load — its element listeners and its
// in-flight manifest/metadata promise — when `source.uri` changes. Before the fix, every switch added five more
// listeners (so `ready` and `timeupdate` multiplied) and a superseded load could still publish its `onTracks`.

test('after two source switches each load reports loading and ready once and each timeupdate one position tick', async ({ page }) => {
  await routeStream(page)
  await page.goto('/player.html')
  await waitForTracks(page)
  expect(await stateEvents(page, 'ready')).toBe(1)
  expect(await stateEvents(page, 'loading')).toBe(1)
  await setSource(page, '/stream/master-b')
  await expect.poll(() => trackEvents(page).then((t) => t.length)).toBe(2)
  await setSource(page, '/stream/master')
  await expect.poll(() => trackEvents(page).then((t) => t.length)).toBe(3)
  await page.waitForTimeout(300) // let any duplicate `ready` from a leaked listener land before counting
  expect(await stateEvents(page, 'ready')).toBe(3) // one per load, not 1 + 2 + 3
  expect(await stateEvents(page, 'loading')).toBe(3)

  // Count the element's own timeupdates next to the kit's onPosition calls, reset and read in one task each.
  await page.evaluate(() => {
    const v = document.querySelector('video')!
    ;(window as unknown as { __tu: number }).__tu = 0
    v.addEventListener('timeupdate', () => (window as unknown as { __tu: number }).__tu++)
    window.__kit.positionTicks = 0
    window.__kit.play()
  })
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tu: number }).__tu), { timeout: 5_000 }).toBeGreaterThanOrEqual(3)
  const { tu, ticks } = await page.evaluate(() => {
    document.querySelector('video')!.pause()
    return { tu: (window as unknown as { __tu: number }).__tu, ticks: window.__kit.positionTicks }
  })
  expect(ticks).toBe(tu) // one onPosition per timeupdate, not three
  // `playing` fires once per play() too — a leaked `play` listener would report it once per past load.
  expect(await stateEvents(page, 'playing')).toBe(1)
})

test("a superseded load's onTracks never publishes: A's manifest released after B completes", async ({ page }) => {
  // Hold A's manifest (not its media), so A's element has its metadata but its Promise.all is still pending.
  const a = deferred()
  const hits = await routeStream(page, { hold: { master: a.promise } })
  await page.goto('/player.html?preferred=' + encodeURIComponent('{"languages":["de"]}'))
  await expect.poll(() => metadataLoaded(page)).toBe(true)
  expect(hits).toContain('fetch master')
  expect(await trackEvents(page)).toHaveLength(0)

  await setSource(page, '/stream/master-b')
  await waitForTracks(page) // B's, the only one so far
  await expect.poll(() => cueText(page, 2)).toEqual(['Zweite Quelle'])

  const released = page.waitForResponse((r) => new URL(r.url()).pathname === '/stream/master' && r.request().resourceType() === 'fetch').then((r) => r.finished())
  a.resolve()
  await released
  await page.waitForTimeout(500)
  const t = await trackEvents(page)
  expect(t).toHaveLength(1)
  expect(t[0]!.type === 'tracks' && t[0]!.tracks.text).toEqual(MANIFEST_TRACKS_B)
  expect((await page.evaluate(() => window.__kit.ref!.getTracks())).text).toEqual(MANIFEST_TRACKS_B)
  expect(await cueText(page, 9)).toEqual([]) // A's c3 would show here
  expect(await cueText(page, 2)).toEqual(['Zweite Quelle'])
  expect(await stateEvents(page, 'ready')).toBe(1) // B's only: A's `ready` is inside its cancelled join
})

test("a superseded load's onTracks cannot latch preferredText: A's manifest released before B's", async ({ page }) => {
  // The worse ordering (0005 §3 amendment): A's onTracks lands after the reset but before B's, so without the
  // cancel the kit's appliedPrefs latches on A's list, auto-selects A's '0' and B's preferredText never applies.
  const a = deferred()
  const b = deferred()
  const hits = await routeStream(page, { hold: { master: a.promise, 'master-b': b.promise } })
  await page.goto('/player.html?preferred=' + encodeURIComponent('{"languages":["de"]}'))
  await expect.poll(() => metadataLoaded(page)).toBe(true)
  expect(hits).toContain('fetch master')

  await setSource(page, '/stream/master-b')
  await expect.poll(() => hits).toContain('fetch master-b')
  await expect.poll(() => metadataLoaded(page, '/stream/master-b')).toBe(true) // B's metadata is in, only its manifest is held

  const releasedA = page.waitForResponse((r) => new URL(r.url()).pathname === '/stream/master' && r.request().resourceType() === 'fetch').then((r) => r.finished())
  a.resolve()
  await releasedA
  await page.waitForTimeout(500)
  expect(await trackEvents(page)).toHaveLength(0) // A published nothing after the switch
  expect(hits.filter((h) => h.startsWith('fetch subs/'))).toEqual([]) // and selected nothing of A's

  b.resolve()
  await waitForTracks(page)
  const [t] = await trackEvents(page)
  expect(t!.type === 'tracks' && t!.tracks.text).toEqual(MANIFEST_TRACKS_B)
  await expect.poll(() => cueText(page, 2)).toEqual(['Zweite Quelle']) // B's preferredText applied, B's cues
  expect(hits.some((h) => h.startsWith('fetch subs/de/'))).toBe(false)
  expect(await stateEvents(page, 'ready')).toBe(1) // B's only
})

test('a cue repeated across segment boundaries reaches onCue once and the overlay draws it once (KIT-026)', async ({ page }) => {
  const hits = await routeStream(page)
  // Encoded: a literal `/stream/` in the query would make routeStream's `**/stream/**` glob swallow the page itself.
  await page.goto('/player.html?src=' + encodeURIComponent('/stream/master-c') + '&primary=0')
  await waitForTracks(page)
  await selectText(page, ['0', '1'])
  // Class A: the verbatim repeat in seg-1/seg-2. One cue per track, one box per track, each text exactly once.
  await expect.poll(() => cueIds(page, 8).then((ids) => ids.sort())).toEqual(['0:c3', '1:c3'])
  const a = await page.evaluate(() => window.__kit.seekSnapshot(8))
  expect(a.ids.sort()).toEqual(['0:c3', '1:c3'])
  expect(a.boxes).toHaveLength(2)
  expect(a.boxes.map((b) => b.text)).toEqual(['Spans second boundary', 'Über die zweite Grenze']) // textContent: doubled text would read "…boundarySpans second boundary"
  // Class B: the clipped repeat in seg-0/seg-1 is one cue with the earlier start.
  const b = await page.evaluate(() => window.__kit.seekSnapshot(5))
  expect(b.ids.sort()).toEqual(['0:c2', '1:c2'])
  expect(b.boxes.map((x) => x.text)).toEqual(['Spans first boundary', 'Über die erste Grenze']) // before the fix: '0:c3'/'1:c3' here
  // Ids continue without gaps: the drop happened before parsing.
  expect((await cueIds(page, 11)).sort()).toEqual(['0:c4', '1:c4'])
  expect(await cueIds(page, 6.75)).toEqual([])
  // Every segment was fetched; the de-dupe is in the join, not in what was requested.
  for (const t of ['en', 'de']) for (const s of ['seg-0', 'seg-1', 'seg-2']) expect(hits).toContain(`fetch subs-c/${t}/${s}.vtt`)
})

test("a source switch from a timer (DefaultLane) tears down the previous load inside the same commit: A's manifest handed over one microtask after the reset still cannot publish", async ({ page }) => {
  // Pins the coupling in KitPlayer's reset (KIT-022 §1): its setTracks/setPosition are SyncLane (issued during
  // layout), so React flushes the adapters' passive effects before that sync work, still inside the commit. A's
  // manifest is released from App's layout effect in B's commit — after the reset, before the adapter's passive
  // effect would run on its own — and handed over one microtask later. By then `<video src>` must be B's.
  const hits = await routeStream(page)
  await page.goto('/player.html?hold=' + encodeURIComponent('/stream/master') + '&preferred=' + encodeURIComponent('{"languages":["de"]}'))
  await expect.poll(() => metadataLoaded(page)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__kit.heldReady())).toBe(true)
  expect(await trackEvents(page)).toHaveLength(0)

  await page.evaluate(() => window.__kit.setSourceDeferred('/stream/master-b'))
  await expect.poll(() => trackEvents(page).then((t) => t.length)).toBeGreaterThanOrEqual(1)
  await page.waitForTimeout(300)
  const t = await trackEvents(page)
  expect(t).toHaveLength(1)
  expect(t[0]!.type === 'tracks' && t[0]!.tracks.text).toEqual(MANIFEST_TRACKS_B)
  const diag = await page.evaluate(() => window.__kit.diag)
  expect(diag.releasedAt?.videoSrc).toBe('/stream/master') // released before the adapter's passive effect
  expect(diag.handover?.videoSrc).toBe('/stream/master-b') // the pin: the passive effect ran before the hand-over
  expect(hits.some((h) => h.startsWith('fetch subs/de/'))).toBe(false)
  await expect.poll(() => cueText(page, 2)).toEqual(['Zweite Quelle'])
})

test("ready does not overwrite playing: a load whose manifest lands after play() stays 'playing' and reports no ready (KIT-028)", async ({ page }) => {
  const m = deferred()
  await routeStream(page, { manifest: m.promise })
  await page.goto('/player.html')
  await expect.poll(() => metadataLoaded(page)).toBe(true)
  expect(await stateEvents(page, 'ready')).toBe(0)
  await page.evaluate(() => window.__kit.play())
  await expect.poll(() => hasState(page, 'playing')).toBe(true)
  m.resolve()
  await waitForTracks(page)
  await page.waitForTimeout(300)
  expect(await stateEvents(page, 'ready')).toBe(0)
  expect(await page.evaluate(() => window.__kit.state())).toBe('playing')
  const states = (await events(page)).filter((x) => x.type === 'state')
  expect(states.at(-1)).toEqual({ type: 'state', state: 'playing' })
})
