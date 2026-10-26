import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages 프로젝트 사이트는 https://<user>.github.io/<repo>/ 경로에서 서비스된다.
// 가계부(index.html)와 3D 대시보드(dashboard.html) 두 페이지를 빌드한다.
export default defineConfig({
  base: '/hsh_budgetbook/',
  build: {
    // three.js(약 560kB, gzip 140kB)는 대시보드에서만 따로 불러오는 청크라 경고 기준을 그보다 조금 높인다.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard.html'),
      },
    },
  },
});
