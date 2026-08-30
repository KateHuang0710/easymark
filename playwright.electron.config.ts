import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/electron',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  // Each test launches its own Electron app against its own temp profile;
  // one worker keeps the disk assertions and app lifecycle predictable.
  workers: 1,
  reporter: [['list']],
})
