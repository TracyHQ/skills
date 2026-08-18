/**
 * Folder slug for a site's workspace (spec §2.2.4): host + path of the siteKey,
 * lowercased, everything outside [a-z0-9.-] collapsed to a dash. The scheme is
 * dropped — `deriveSiteKey` already made the address canonical, the slug only
 * has to be a readable, filesystem-safe folder name.
 *
 * It travels with the engine because it names the page files on disk: change one
 * character here and every `surface/pages/*.json` written by a previous run stops
 * being found, which reads as a site that lost all its pages.
 */
export function siteSlug(siteKey: string): string {
  const noScheme = siteKey.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  return noScheme
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}
