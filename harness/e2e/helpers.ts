/**
 * Shared helpers for the Playwright harness (docs/plans/KIT-005-harness.md §4.9).
 *
 * Media fixture provenance — `harness/fixtures/black-15s.webm` is synthetic (ffmpeg's lavfi `color` source,
 * no third-party content), generated once from the repo root with:
 *
 *   ffmpeg -hide_banner -y -f lavfi -i color=c=black:s=64x36:r=2 -t 15 -c:v libvpx-vp9 -b:v 10k -an harness/fixtures/black-15s.webm
 *
 * Verify: `ffprobe -v error -show_entries format=duration:stream=codec_name -of default=nw=1 harness/fixtures/black-15s.webm`
 * → codec_name=vp9, duration=15.000000; 1168 bytes.
 */
import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const FIX = (rel: string) => fileURLToPath(new URL(`../fixtures/${rel}`, import.meta.url))

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/**
 * Serve /stream/** from fixtures. The master URL is two things: the playlist body when the adapter `fetch`es
 * it, and the WebM when the `<video>` element loads it (`resourceType() === 'media'`). Either half can be
 * held behind a gate so a spec controls the order in which the adapter sees them.
 *
 * `respond` (KIT-016) replaces the fixture for a relative path with a status/body of the spec's choosing, or
 * `'abort'` (a network failure). It is applied after the `hold` gate, so a spec can hold a request and then fail it.
 * `mediaRespond` (KIT-025) does the same for the media half of a `master*` path, after the `media` gate and the
 * per-path `mediaHold` gate.
 */
export type RouteOverride = { status: number; body?: string; contentType?: string } | 'abort'
export async function routeStream(
  page: Page,
  gates: {
    manifest?: Promise<void>
    media?: Promise<void>
    hold?: Record<string, Promise<void>>
    respond?: Record<string, RouteOverride>
    /** KIT-025: per `master*` path, holds the `<video>` element's media request (`media` holds every one). */
    mediaHold?: Record<string, Promise<void>>
    /** KIT-025: per `master*` path, replaces the `<video>` element's media response (the manifest stays real). */
    mediaRespond?: Record<string, RouteOverride>
  } = {},
) {
  const hits: string[] = []
  await page.route('**/stream/**', async (route) => {
    const req = route.request()
    const rel = new URL(req.url()).pathname.replace(/^\/stream\//, '')
    hits.push(`${req.resourceType()} ${rel}`)
    // The player page loads `/stream/master` (no extension): Chromium sniffs `.m3u8` in a media URL before
    // demuxing and would refuse the WebM. The on-disk fixture keeps its `.m3u8` name (plan §13). `master-b`
    // is the second source for the source-switch specs: same subtitle ids, different cue text. `master-c` repeats
    // cues across segment boundaries (KIT-026). `master-d` adds an audio-description rendition (KIT-014).
    if (/^master(-[bcd])?(\.m3u8)?$/.test(rel) && req.resourceType() === 'media') {
      await gates.media
      await gates.mediaHold?.[rel]
      const o = gates.mediaRespond?.[rel]
      if (o === 'abort') return route.abort('failed')
      if (o) {
        return route.fulfill({ status: o.status, body: o.body ?? '', contentType: o.contentType ?? 'text/plain' })
      }
      // Chromium marks a media resource seekable only when the server honours Range (Accept-Ranges + 206);
      // a bare 200 loads but clamps every seek to 0 (probe, §10 step 1). Chromium sends `Range: bytes=0-`.
      const body = readFileSync(FIX('black-15s.webm'))
      const m = /bytes=(\d+)-(\d*)/.exec((await req.allHeaders())['range'] ?? '')
      const start = m ? Number(m[1]) : 0
      const end = m?.[2] ? Number(m[2]) : body.length - 1
      const slice = body.subarray(start, end + 1)
      return route.fulfill({
        status: m ? 206 : 200,
        body: slice,
        headers: {
          'content-type': 'video/webm',
          'content-length': String(slice.length),
          'accept-ranges': 'bytes',
          ...(m ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}),
        },
      })
    }
    if (/^master(-[bcd])?(\.m3u8)?$/.test(rel)) await gates.manifest
    await gates.hold?.[rel] // one text path held back, so a spec can make a fetch resolve late on purpose
    const override = gates.respond?.[rel]
    if (override === 'abort') return route.abort('failed')
    if (override) return route.fulfill({ status: override.status, body: override.body ?? '', contentType: override.contentType ?? 'text/plain' })
    return route.fulfill({ path: FIX(`stream/${/^master(-[bcd])?$/.test(rel) ? `${rel}.m3u8` : rel}`), contentType: rel.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'text/vtt' })
  })
  return hits
}

export const rect = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  })

export const events = (page: Page) => page.evaluate(() => window.__kit.events)

/**
 * The element has its metadata (`readyState >= HAVE_METADATA`; for `src` when given). Since KIT-015 `ready`
 * waits for the manifest as well, so a spec that holds the manifest needs this witness, not `state:ready`.
 */
export const metadataLoaded = (page: Page, src?: string) =>
  page
    .getByTestId('kit-video')
    .evaluate((v: HTMLVideoElement, src) => v.readyState >= 1 && (src === undefined || v.getAttribute('src') === src), src)

export const cueIds = (page: Page, t: number) =>
  page.evaluate((t) => window.__kit.seek(t).map((c) => `${c.trackId}:${c.id}`), t)
