import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le front (port 5173) proxifie /api vers le dev-server local (port 4000)
// qui lit/ecrit les .txt du mod.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
