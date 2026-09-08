import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/AR_Inversiones/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'AR Inversiones',
        short_name: 'AR Inversiones',
        description: 'Gestión empresarial de inversiones',
        theme_color: '#102a43',
        background_color: '#f6f8fb',
        display: 'standalone',
        lang: 'es-HN',
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
