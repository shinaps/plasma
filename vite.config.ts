import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  plugins: [tailwindcss(), viteSingleFile()],
  build: { chunkSizeWarningLimit: 5000 },
});
