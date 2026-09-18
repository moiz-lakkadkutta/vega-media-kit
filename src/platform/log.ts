const warned = new Set<string>()
/** Warn once per (module, os) with a link to the doc explaining the gap — good library manners and quotable feedback. */
export function warnOnce(module: string, os: string, doc: string): void {
  const key = `${module}:${os}`
  if (warned.has(key)) return
  warned.add(key)
  // eslint-disable-next-line no-console
  console.debug(`[vega-media-kit] ${module} is a no-op on ${os}. See ${doc}`)
}
export const DOCS = 'https://github.com/moiz-lakkadkutta/vega-media-kit/blob/main/docs/platform-bindings.md'

const deprecated = new Set<string>()
/** Warn once per `what` that a feature is deprecated, with the doc that says what to do instead. console.warn, not debug. */
export function deprecateOnce(what: string, doc: string): void {
  if (deprecated.has(what)) return
  deprecated.add(what)
  // eslint-disable-next-line no-console
  console.warn(`[vega-media-kit] ${what} is deprecated and will be removed in the next minor release. See ${doc}`)
}
export const DEPRECATION_DOCS = 'https://github.com/moiz-lakkadkutta/vega-media-kit/blob/main/docs/getting-started.md#text-tracks'
