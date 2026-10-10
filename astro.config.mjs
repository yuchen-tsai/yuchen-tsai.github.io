// @ts-check
import { defineConfig } from 'astro/config';

// Fully static build, deployed to GitHub Pages by .github/workflows/deploy.yml.
export default defineConfig({
  site: 'https://yuchen-tsai.github.io',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
});
