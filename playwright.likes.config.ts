import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/likes',
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    channel: process.env.LIKES_BROWSER_CHANNEL,
  },
  webServer: [
    {
      command: 'node --import tsx scripts/likes-dev.ts',
      url: 'http://127.0.0.1:3001/api/likes',
      env: {
        PERSONAL_SITE_ORIGIN: 'http://localhost:5173',
        PERSONAL_SITE_OWNER_KEY: 'local-development-key-32-characters-only',
        LIKES_DEV_MOCK_AI: '1',
        LIKES_LOCAL_DATABASE: '/tmp/nimo-likes-browser-db',
        LIKES_LOCAL_STORAGE: '/tmp/nimo-likes-browser-files',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm run start:web -- --host localhost',
      url: 'http://localhost:5173',
      env: { LIKES_API_PROXY: 'http://127.0.0.1:3001' },
      reuseExistingServer: false,
    },
  ],
});
