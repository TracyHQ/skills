/**
 * The crawler introduces itself (spec §5). The version keeps the string honest across releases;
 * the URL gives a site owner somewhere to read about the bot and how to opt out.
 *
 * The version arrives through the environment because the engine no longer lives inside the
 * desktop app: Tracy Desk sets `TRACY_SCAN_VERSION` to its own version, and a hand-run scan
 * leaves it unset. What must not change is the rest of the string, which is what a site owner
 * sees in their log.
 */
const version = process.env.TRACY_SCAN_VERSION ?? 'unknown'

export const CRAWLER_USER_AGENT = `TracyBot/${version} (+https://trytracy.com/bot)`
