import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const root = import.meta.dirname;

/**
 * The packaged app's Content Security Policy: code and assets only from the bundle, connections only
 * to the local backend. Injected at build time only, because Vite's dev server serves inline scripts.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // ** Inline style attributes come from React and Radix positioning, so inline styles stay allowed.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'aperture-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/** Builds the Electron main process, the sandboxed preload script and the React renderer into out/. */
export default defineConfig({
  main: {
    build: { lib: { entry: resolve(root, 'electron/main.ts') } },
  },
  preload: {
    build: {
      // ** A sandboxed preload can't be an ES module, so it is bundled as CommonJS.
      lib: { entry: resolve(root, 'electron/preload.ts'), formats: ['cjs'] },
      rollupOptions: { output: { entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root,
    plugins: [react(), contentSecurityPolicy()],
    server: { port: 5173, strictPort: true },
    build: { rollupOptions: { input: resolve(root, 'index.html') } },
  },
});
