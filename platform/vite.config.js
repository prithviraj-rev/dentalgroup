import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the Express server under /app in production; under Vite on :5174 in development,
// with the API proxied to the server so the session cookie stays same-origin.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/platform-api': 'http://localhost:3000', '/connect': 'http://localhost:3000' },
  },
  build: { chunkSizeWarningLimit: 900 },
});
