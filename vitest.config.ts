import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The registry's own tests, plus the site-scan engine's — the engine moved here from tracy-desk
  // with its suite attached, and a suite nothing runs is not a safety net.
  // `scripts/` is here because the repo's own gates live there and they were the last thing
  // with no tests — check-skill shipped seven rules whose only evidence was a hand-run against
  // the tree that day. A gate nobody checks is the defect that gate exists to find.
  test: {
    include: [
      'src/**/*.test.ts',
      'skills/**/__tests__/**/*.test.ts',
      'scripts/**/__tests__/**/*.test.ts'
    ]
  }
})
