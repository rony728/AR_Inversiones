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
        theme_color: '#002444',
        background_color: '#f2f7fb',
        display: 'standalone',
        lang: 'es-HN',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
    }),
  ],
  server: {
    port: 5174,
    strictPort: true,
  },
});
