import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { lintCues } from '../../src/core'
import type { Cue } from '../../src/core'
import type { CueOverlayProps } from '../../src/cues'
import { rect } from './helpers'

/**
 * The five overlay behaviours the ticket names (line count, 42-char wrap, safe zone, two-track stacking,
 * selectable words) plus speaker/sound prefixes and the top line — plan §5, specs 1–9. All at scale 1 on a
 * 1920×1080 viewport, so every number is literal px. Text assertions are line counts (height ÷ line-height),
 * never px widths, so they hold for any sans-serif the browser picks (plan §1.9).
 */
type Extra = Omit<CueOverlayProps, 'active' | 'scale' | 'testID'>

const cue = (id: string, text: string, extra: Partial<Cue> = {}): Cue => ({ trackId: 'de', id, start: 0, end: 5, text, ...extra })
const CUE42 = cue('w42', 'The quick brown fox jumps over a lazy dog.')
const CUE95 = cue('w95', 'The quick brown fox jumps over the lazy dog while the patient owl watches from the old oak tree')
const CUE3L = cue('l3', 'Line one of three\nLine two of three\nLine three is clipped')
const DE = cue('d1', 'Hallo Welt')
const EN = cue('e1', 'Hello world', { trackId: 'en' })
const WORDS = cue('s1', 'Hello brave new world')
const SPK = cue('sp1', 'Are you coming?', { speaker: 'Maria' })
const SND = cue('sn1', 'door slams', { sound: true })
const TOP = cue('t1', 'Up here', { line: 'top' })

const setCues = (page: Page, cues: Cue[], props: Extra = {}) => page.evaluate(([c, p]) => window.__setCues(c, p), [cues, props] as const)
const computed = (page: Page, selector: string, prop: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop)

test.beforeEach(async ({ page }) => {
  await page.goto('/overlay.html')
  await expect(page.getByTestId('overlay')).toBeAttached()
})

const overlay = (page: Page) => page.getByTestId('overlay')
const topArea = (page: Page) => overlay(page).locator(':scope > div').nth(0)
const bottomArea = (page: Page) => overlay(page).locator(':scope > div').nth(1)
const text = (page: Page) => overlay(page).locator('div[dir="auto"]')

test('a three-line cue is clamped to two lines', async ({ page }) => {
  await setCues(page, [CUE3L])
  expect((await rect(text(page).first())).height).toBeCloseTo(114, 0) // 2 × 57
  expect(await computed(page, 'div[dir="auto"]', '-webkit-line-clamp')).toBe('2')
  expect(await computed(page, 'div[dir="auto"]', 'line-height')).toBe('57px')
  expect(await computed(page, 'div[dir="auto"]', 'font-size')).toBe('44px')
  await setCues(page, [DE])
  expect((await rect(text(page).first())).height).toBeCloseTo(57, 0)
})

test('42 characters fit on one line; a 95-character run-on wraps to exactly two', async ({ page }) => {
  expect(CUE42.text).toHaveLength(42)
  expect(CUE95.text).toHaveLength(95)
  await setCues(page, [CUE42])
  expect((await rect(text(page).first())).height).toBeCloseTo(57, 0)
  expect(lintCues([CUE42])).toEqual([])
  await setCues(page, [CUE95])
  expect((await rect(text(page).first())).height).toBeCloseTo(114, 0)
  const box = bottomArea(page).locator(':scope > div').nth(0)
  expect((await rect(box)).width).toBeCloseTo(1486.08, 0) // 86 % of 1728: the maxWidth bound
  expect(lintCues([CUE95])).toEqual([{ id: 'w95', problem: 'lineLength', value: 95 }])
})

test('the bottom box respects the 5 % safe zone by default', async ({ page }) => {
  await setCues(page, [CUE95])
  const b = await rect(bottomArea(page).locator(':scope > div').nth(0))
  expect(b.bottom).toBeCloseTo(1026, 0)
  expect(b.left).toBeCloseTo(216.96, 0)
  expect(b.right).toBeCloseTo(1703.04, 0)
  expect(b.left).toBeGreaterThanOrEqual(96)
  expect(b.right).toBeLessThanOrEqual(1824)
  expect(await computed(page, '[data-testid="overlay"]', 'padding')).toBe('54px 96px')
})

test('safeInset overrides the safe zone', async ({ page }) => {
  await setCues(page, [CUE95], { safeInset: { x: 200, y: 100 } })
  const b = await rect(bottomArea(page).locator(':scope > div').nth(0))
  expect(b.bottom).toBeCloseTo(980, 0)
  expect(b.width).toBeCloseTo(1307.2, 0)
  expect(b.left).toBeCloseTo(306.4, 0)
  expect(b.right).toBeCloseTo(1613.6, 0)
})

test('the secondary track stacks above the primary at 32 px with an 8 px gap', async ({ page }) => {
  await setCues(page, [DE, EN], { primaryTrackId: 'de' })
  const boxes = bottomArea(page).locator(':scope > div')
  await expect(boxes).toHaveCount(2)
  await expect(boxes.nth(0)).toHaveText('Hello world')
  await expect(boxes.nth(1)).toHaveText('Hallo Welt')
  const sec = await rect(boxes.nth(0))
  const prim = await rect(boxes.nth(1))
  expect(sec.bottom + 8).toBeCloseTo(prim.top, 0)
  expect(sec.top).toBeLessThan(prim.top)
  expect(prim.bottom).toBeCloseTo(1026, 0)
  expect(prim.height).toBeCloseTo(81, 0) // 57 + 2 × 12
  expect(sec.height).toBeCloseTo(66, 0) // 42 + 2 × 12
  expect(await boxes.nth(0).locator('div[dir="auto"]').evaluate((el) => getComputedStyle(el).fontSize)).toBe('32px')
  expect(await boxes.nth(1).locator('div[dir="auto"]').evaluate((el) => getComputedStyle(el).fontSize)).toBe('44px')
})

test('hideSecondary removes the secondary box', async ({ page }) => {
  await setCues(page, [DE, EN], { primaryTrackId: 'de', hideSecondary: true })
  const boxes = bottomArea(page).locator(':scope > div')
  await expect(boxes).toHaveCount(1)
  await expect(boxes.nth(0)).toHaveText('Hallo Welt')
  await expect(page.getByText('Hello world')).toHaveCount(0)
})

test('selectable underlines the focused word and labels every word', async ({ page }) => {
  await setCues(page, [WORDS], { selectable: { focusedIndex: 1 } })
  const words = overlay(page).locator('span[aria-label]')
  await expect(words).toHaveCount(4)
  expect(await words.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Hello', 'brave', 'new', 'world'])
  const deco = () => words.evaluateAll((els) => els.map((e) => getComputedStyle(e).textDecorationLine))
  expect(await deco()).toEqual(['none', 'underline', 'none', 'none'])
  // The overlay never calls onFocusWord itself: focus is app-driven (D-pad), the overlay only renders it.
  expect(await page.evaluate(() => window.__focusCalls)).toEqual([])
  await setCues(page, [WORDS], { selectable: { focusedIndex: null } })
  expect(await deco()).toEqual(['none', 'none', 'none', 'none'])
})

test('speaker and sound cues get their bracketed prefixes', async ({ page }) => {
  await setCues(page, [SPK])
  await expect(text(page).first()).toHaveText('[Maria] Are you coming?')
  await setCues(page, [SND])
  await expect(text(page).first()).toHaveText('[door slams]')
})

test('a line:top cue renders in the top area', async ({ page }) => {
  await setCues(page, [TOP, DE])
  const top = topArea(page).locator(':scope > div')
  await expect(top).toHaveCount(1)
  await expect(top.nth(0)).toHaveText('Up here')
  expect((await rect(top.nth(0))).top).toBeCloseTo(54, 0)
  const bottom = bottomArea(page).locator(':scope > div')
  await expect(bottom).toHaveCount(1)
  await expect(bottom.nth(0)).toHaveText('Hallo Welt')
})
