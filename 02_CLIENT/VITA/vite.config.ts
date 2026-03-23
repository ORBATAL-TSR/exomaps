import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Plugin } from 'vite';

// ── Inline SRI plugin ────────────────────────────────────────────────────────
// Adds integrity="sha384-..." + crossorigin="anonymous" to every <script> and
// <link rel="stylesheet"> in the built index.html.
//
// IMPORTANT: hashes must be computed from the ACTUAL bytes written to disk, not
// from the in-memory Rollup bundle. Vite applies a modulepreload injection pass
// after generateBundle that modifies the entry chunk on disk — if we hash the
// in-memory chunk.code the hash won't match what the browser receives.
//
// Strategy: closeBundle hook (runs after all files are written) reads each
// referenced file, computes SHA-384, and patches index.html in place.
function sriPlugin(): Plugin {
  let outDir = 'dist';

  return {
    name: 'exomaps-sri',
    apply: 'build', // only runs during `vite build`, not dev server

    configResolved(config) {
      outDir = config.build.outDir;
    },

    closeBundle() {
      const htmlPath = resolve(outDir, 'index.html');
      if (!existsSync(htmlPath)) return;

      let html = readFileSync(htmlPath, 'utf-8');

      function addIntegrity(match: string, assetPath: string): string {
        if (match.includes('integrity=')) return match; // already annotated
        // assetPath is root-relative: "/assets/foo.js" → outDir/assets/foo.js
        const filePath = join(outDir, assetPath);
        if (!existsSync(filePath)) return match;
        const bytes = readFileSync(filePath);
        const hash = createHash('sha384').update(bytes).digest('base64');
        // Insert before the closing > of the tag
        return match.replace(/(\s*\/?>)$/, ` integrity="sha384-${hash}" crossorigin="anonymous"$1`);
      }

      // <script ... src="/assets/...">
      html = html.replace(
        /(<script\b[^>]+\bsrc="(\/[^"]+)"[^>]*>)/g,
        (match, _tag, src) => addIntegrity(match, src),
      );

      // <link ... href="/assets/...css">
      html = html.replace(
        /(<link\b[^>]+\bhref="(\/[^"]+\.css)"[^>]*>)/g,
        (match, _tag, href) => addIntegrity(match, href),
      );

      writeFileSync(htmlPath, html);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), sriPlugin()],
  resolve: {
    // Ensure modules importing 'three' resolve to the same copy
    dedupe: ['three', 'react', 'react-dom'],
  },
  // Tauri expects a fixed port in dev mode
  server: {
    host: true,          // bind 0.0.0.0 — accessible over LAN
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    // Proxy API calls to the Flask gateway
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  // Preview mode: serves the production build with the same proxy as dev.
  // Use this for LAN clients instead of dev mode to avoid the 686-module waterfall.
  preview: {
    host: true,
    port: 1420,
    strictPort: true,
    allowedHosts: ['exomaps.local', 'localhost', '192.168.1.77'],
    https: {
      cert: readFileSync('/home/tsr/Projects/exomaps/07_LOCALRUN/certs/exomaps.crt').toString(),
      key:  readFileSync('/home/tsr/Projects/exomaps/07_LOCALRUN/certs/exomaps.key').toString(),
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000,
      },
    },
  },
  // Build output for Tauri to bundle
  build: {
    outDir: 'dist',
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-three': ['three'],
          'vendor-r3f':   ['@react-three/fiber', '@react-three/drei'],
          // Orrery chunk: only downloaded when user first focuses a system.
          // Stable name used by the hover-prefetch dynamic import().
          'orrery':       ['./src/components/SystemFocusView'],
        },
      },
    },
  },
});
