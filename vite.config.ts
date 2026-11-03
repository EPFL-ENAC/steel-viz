// The playground: a Vue app in app/, served by Vite.
// pnpm dev   : dev server on PLAYGROUND_PORT (wtx runs it in the playground pane)
// pnpm build : static site in dist/
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { devTools } from './app/dev-plugin.ts';

export default defineConfig({
  root: 'app',
  plugins: [vue(), devTools()],
  server: { host: '127.0.0.1', port: Number(process.env.PLAYGROUND_PORT) || 5180, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
