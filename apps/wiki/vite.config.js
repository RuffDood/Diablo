import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Wiki public — site statique, aucune API/backend. Port distinct de l'admin (5173).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
  },
});
