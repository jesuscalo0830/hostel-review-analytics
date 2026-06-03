import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks: {
            recharts: ['recharts'],
            motion: ['motion', 'motion/react'],
            lucide: ['lucide-react'],
            gemini: ['@google/genai'],
            firebase: ['firebase/app', 'firebase/firestore'],
            datefns: ['date-fns'],
          },
        },
      },
    },
    cacheDir: '/tmp/vite-cache',
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
