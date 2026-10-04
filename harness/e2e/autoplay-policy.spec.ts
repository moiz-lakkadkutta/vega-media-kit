import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { events, routeStream } from './helpers'

/**
 * Spec 42 (KIT-025): the real KitPlayer + WebAdapter in a Chromium that refuses autoplay without a user gesture.
 * Its own file because `launchOptions` is worker-scoped: Playwright allows overriding it only at the top level of a
 * file, and the config launches every other spec with `--autoplay-policy=no-user-gesture-required`.
 */
test.use({ launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] } })

const errorEvents = (page: Page) => events(page).then((e) => e.filter((x) => x.type === 'error'))
const hasState = (page: Page, s: string) => events(page).then((e) => e.some((x) => x.type === 'state' && x.state === s))

test('autoplay blocked by policy reports one non-fatal PLAY_REJECTED and the load still reports ready (KIT-025)', async ({ page }) => {
  await routeStream(page)
  await page.goto('/player.html?autoplay=1')
  await expect.poll(() => errorEvents(page)).toEqual([expect.objectContaining({ type: 'error', code: 'PLAY_REJECTED', fatal: false })])
  await expect.poll(() => hasState(page, 'ready')).toBe(true)
  await page.waitForTimeout(300)
  expect(await errorEvents(page)).toHaveLength(1)
  expect(await hasState(page, 'playing')).toBe(false)
  expect(await page.evaluate(() => window.__kit.unhandled)).toEqual([])
  expect(await page.evaluate(() => window.__kit.state())).toBe('ready')
})
