import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/windows',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'windows-launcher',
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
