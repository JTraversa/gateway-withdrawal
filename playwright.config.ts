import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 45000, workers: 1, expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4173/gateway/', headless: true, launchOptions: { args: ['--no-sandbox'] } },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4173/gateway/', reuseExistingServer: !process.env.CI },
});
