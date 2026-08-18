import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The registry's own tests, plus the site-scan engine's — the engine moved here from tracy-desk
  // with its suite attached, and a suite nothing runs is not a safety net.
  test: { include: ['src/**/*.test.ts', 'skills/**/__tests__/**/*.test.ts'] }
})
