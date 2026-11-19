// Compile les composants React de Twiin en UN fichier (public/ui/twiin-ui.js + .css) que la page charge avec <script>.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: path.resolve(__dirname, '../public/ui'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry: path.resolve(__dirname, 'src/main.tsx'), name: 'TwiinUI', formats: ['iife'], fileName: () => 'twiin-ui.js' },
    rollupOptions: { output: { assetFileNames: 'twiin-ui[extname]' } },
  },
});
