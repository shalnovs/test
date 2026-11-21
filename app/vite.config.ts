import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4311' }, watch: { ignored: ['**/target/**', '**/src-tauri/**'] } },
  build: { target: 'es2022' },
});
