import { defineConfig } from '@playwright/test';

// 使用真实 Chrome、HTTP 与独立 SQLite 验证静态部署产物。 Verify exported assets with real Chrome, HTTP and isolated SQLite.
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0,
  timeout: 30_000, expect: { timeout: 5_000 },
  use: { baseURL: 'http://127.0.0.1:4186', viewport: { width: 390, height: 844 }, browserName: 'chromium', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: { command: 'node --experimental-strip-types tests/e2e-server.ts', url: 'http://127.0.0.1:4186', reuseExistingServer: false, timeout: 15_000 },
});
