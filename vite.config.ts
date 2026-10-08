import { defineConfig } from 'vite';

// Fully static, client-side app. No server-side logic is used at runtime.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
