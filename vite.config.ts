import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webExtension from 'vite-plugin-web-extension';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: './src/manifest.json',
      disableAutoLaunch: true,
      skipManifestValidation: true,
      additionalInputs: ['src/welcome/welcome.html'],
    }),
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  define: {
    '__APP_VERSION__': JSON.stringify(manifest.version),
  },
});
