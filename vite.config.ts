import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: process.env.LIKES_API_PROXY
      ? {
          '/api/likes': process.env.LIKES_API_PROXY,
          '/.well-known/oauth': process.env.LIKES_API_PROXY,
        }
      : undefined,
  },
});
