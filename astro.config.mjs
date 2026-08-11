import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://kainnne.github.io',
  // 本機請開 http://127.0.0.1:4322/WikiNB-KCIS/ （根路徑 / 會 404，屬正常）
  // GitHub Pages 自訂網域的 workflow 會覆寫為根路徑 /。
  base: process.env.PUBLIC_BASE_PATH || '/WikiNB-KCIS/',
  integrations: [tailwind()],
  devToolbar: {
    enabled: false,
  },
});
