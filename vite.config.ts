import {defineConfig} from 'vite';

export default defineConfig({
  // Relative, so the build works from a GitHub Pages project subpath
  base: './',
  server: {port: 5199, strictPort: true}
});
