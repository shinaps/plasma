import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { monacoIcons } from './scripts/monaco-icons.ts';
export default defineConfig({
  plugins: [monacoIcons(), tailwindcss(), viteSingleFile()],
  build: { chunkSizeWarningLimit: 5000 },
});
