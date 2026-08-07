import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 4 — the browser harness.
 *
 * Two viewports, because the walkthrough's core scenario is a phone put face-up
 * on a table and its keepsake scenario is someone sitting at a desk. Anything
 * that only works on one of those is not finished.
 *
 * Chromium is launched with audio unblocked and muted: the smoke test has to
 * actually start a session (Tone needs an AudioContext to resolve `play()`),
 * but nothing should come out of the machine's speakers while it runs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5177',
    trace: 'off',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5177 --strictPort',
    url: 'http://localhost:5177',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
