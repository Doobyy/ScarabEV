import { defineConfig } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './specs',
  timeout: 60000,
  fullyParallel: false,
  retries: 1,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true
  },
  webServer: {
    command: 'node ./serve.mjs',
    cwd: __dirname,
    port: 4173,
    reuseExistingServer: true,
    timeout: 120000
  }
});
