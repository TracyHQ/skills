import { runCrawl } from './crawler'

/**
 * The one door into the measuring engine from outside the desktop app.
 *
 * stdout carries only machine-readable lines, one JSON object per line, so a caller can narrate a
 * run while it happens instead of waiting for the end:
 *   {"type":"progress", ...}  every beat of the run
 *   {"type":"summary", ...}   exactly once, last
 * Everything else — logs, warnings, the failure message — goes to stderr, where it cannot be
 * mistaken for data.
 */
type Platform = 'wordpress' | 'shopify' | 'joomla'

const PLATFORMS: Platform[] = ['wordpress', 'shopify', 'joomla']

const USAGE =
  'usage: scan --site <url> --workspace <path> [--platform wordpress|shopify|joomla]\n'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const emit = (payload: unknown) => process.stdout.write(`${JSON.stringify(payload)}\n`)

const fail = (message: string, code: number): never => {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

async function main() {
  const site = arg('site')
  const workspace = arg('workspace')
  if (!site || !workspace) fail(USAGE, 2)

  // The crawler builds every address off this one, so a bad value must fail here with a sentence
  // the caller can act on, not three phases later inside a fetch.
  try {
    new URL(site!)
  } catch {
    fail(`--site must be an absolute URL, got: ${site}\n${USAGE}`, 2)
  }

  const platformArg = arg('platform')
  if (platformArg !== undefined && !PLATFORMS.includes(platformArg as Platform)) {
    fail(`--platform must be one of ${PLATFORMS.join(', ')}, got: ${platformArg}\n${USAGE}`, 2)
  }
  // Null is a real answer, not a missing one: the engine treats it as "platform unknown" and reads
  // the site the way any visitor would.
  const platform = (platformArg ?? null) as Platform | null

  const { report, changed } = await runCrawl({
    siteKey: site!,
    workspacePath: workspace!,
    platform,
    onProgress: (p) => emit({ type: 'progress', ...p })
  })

  emit({ type: 'summary', report, changed })
}

main().catch((error) => {
  process.stderr.write(`scan failed: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
