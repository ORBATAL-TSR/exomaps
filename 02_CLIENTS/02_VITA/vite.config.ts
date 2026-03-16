import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@exomaps/shared': path.resolve(__dirname, '../SHARED/src'),
    },
    // Ensure SHARED modules importing 'three' resolve to the desktop copy
    dedupe: ['three', 'react', 'react-dom'],
  },
  // Tauri expects a fixed port in dev mode
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    // Allow serving files from the SHARED workspace (shaders, geometry, etc.)
    fs: {
      allow: [
        path.resolve(__dirname, '..'),  // 02_CLIENTS/ parent — covers SHARED/
      ],
    },
    // Proxy API calls to the Flask gateway
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  // Build output for Tauri to bundle
  build: {
    outDir: 'dist',
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
