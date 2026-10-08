import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: 'github-pages', base: '/Transly/', plugins: [react()], css: { postcss: { plugins: [tailwindcss()] } }, resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } }, publicDir: '../public', build: { outDir: '../dist-pages', emptyOutDir: true } });
