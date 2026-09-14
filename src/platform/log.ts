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
