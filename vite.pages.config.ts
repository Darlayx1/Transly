import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'NEXT_PUBLIC_SUPABASE_');
  return { root: 'github-pages', base: '/Transly/', plugins: [react()],
    define: {
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ''),
      'process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''),
    },
    css: { postcss: { plugins: [tailwindcss()] } }, resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } }, publicDir: '../public', build: { outDir: '../dist-pages', emptyOutDir: true },
  };
});
