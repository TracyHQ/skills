/**
 * Whether two urls belong to the same site, for crawl scoping.
 *
 * `www.` is the one label folded away, and deliberately the only one. A site
 * whose apex redirects to `www` is one site — `deriveSiteKey` already strips the
 * label, so every crawl is seeded at the apex and would otherwise classify the
 * site's own pages as external and stop after the first fetch.
 *
 * Deeper subdomains stay separate on purpose. Folding them in needs the public
 * suffix list, and guessing without it is worse than not folding: on shared
 * suffixes like `myshopify.com` it would make two unrelated merchants' stores
 * look like one site. A checkout or cdn subdomain is a different surface anyway.
 */
export function isSameSite(a: string, b: string): boolean {
  const left = hostOf(a)
  return left !== undefined && left === hostOf(b)
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}
