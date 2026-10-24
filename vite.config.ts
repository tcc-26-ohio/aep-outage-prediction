import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { rollupOptions: { input: { main: 'index.html', map: 'map.html', client: 'client.html' } } },
});
