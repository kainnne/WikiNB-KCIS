import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://zx50416.github.io',
  // 本機請開 http://127.0.0.1:4322/WikiNB-KCIS/ （根路徑 / 會 404，屬正常）
  base: '/WikiNB-KCIS/',
  integrations: [tailwind()],
  devToolbar: {
    enabled: false,
  },
});
