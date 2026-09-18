import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cueIds, deferred, events, routeStream } from './helpers'

/**
 * The real KitPlayer + WebAdapter in Chromium (plan §5, specs 10–16): `onTracks` ordering against a real
 * `loadedmetadata`, `preferredText`, Q7, multi-track cue delivery from one `selectText([...])`, the deprecated
 * header bridge and `timeupdate`. Cue timing goes through `ref.seek()` (synchronous `scheduler.update`); only
 * the last spec plays the element for real.
 */
const BASE = 'http://localhost:4173'
const trackEvents = (page: Page) => events(page).then((e) => e.filter((x) => x.type === 'tracks'))
const hasState = (page: Page, s: string) => events(page).then((e) => e.some((x) => x.type === 'state' && x.state === s))
const selectText = (page: Page, ids: string[]) => page.evaluate((ids) => window.__kit.ref!.selectText(ids), ids)
const waitForTracks = (page: Page) => expect.poll(() => trackEvents(page).then((t) => t.length)).toBe(1)

const MANIFEST_TRACKS = [
  { id: '0', language: 'de', label: 'Deutsch', kind: 'subtitles', active: false, url: `${BASE}/stream/subs/de/index.m3u8` },
  { id: '1', language: 'en', label: 'English', kind: 'subtitles', active: false, url: `${BASE}/stream/subs/en/index.m3u8` },
]

test('onTracks waits for the manifest: nothing is published on loadedmetadata alone', async ({ page }) => {
  const m = deferred()
  await routeStream(page, { manifest: m.promise })
  await page.goto('/player.html')
  await expect.poll(() => hasState(page, 'ready')).toBe(true)
  expect(await trackEvents(page)).toHaveLength(0)
  m.resolve()
  await waitForTracks(page)
  const [t] = await trackEvents(page)
  expect(t!.type === 'tracks' && t!.tracks.text).toEqual(MANIFEST_TRACKS)
  await page.waitForTimeout(300)
  expect(await trackEvents(page)).toHaveLength(1)
})

test('onTracks waits for loadedmetadata: a resolved manifest alone publishes nothing', async ({ page }) => {
  const md = deferred()
  const hits = await routeStream(page, { media: md.promise })
  await page.goto('/player.html')
  await expect.poll(() => hits).toContain('fetch master')
  await page.waitForTimeout(500)
  expect(await trackEvents(page)).toHaveLength(0)
  expect(await hasState(page, 'ready')).toBe(false)
  md.resolve()
  await waitForTracks(page)
  // Both land only once the element has its metadata. The order between `tracks` and `state:ready` is not
  // asserted here — no adapter-wide contract exists yet (Fire OS emits tracks→ready, Vega ready→tracks, web
  // is race-dependent: a manifest that settled first reaches `Promise.all(...).then` in the microtask
  // checkpoint Chromium runs between the two loadedmetadata listeners). See TASKS.md follow-up.
  await expect.poll(() => hasState(page, 'ready')).toBe(true)
  expect(await trackEvents(page)).toHaveLength(1)
})

test('preferredText auto-selects a manifest track even when the manifest lands after ready', async ({ page }) => {
  const m = deferred()
  await routeStream(page, { manifest: m.promise })
  await page.goto('/player.html?preferred=' + encodeURIComponent('{"languages":["en"]}'))
  await expect.poll(() => hasState(page, 'ready')).toBe(true)
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
