import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 완전 클라이언트 사이드 PWA.
// base: 정적 호스팅 루트면 '/'. GitHub Pages 프로젝트 페이지(https://<user>.github.io/<repo>/)면
//       빌드 시 PAGES_BASE 환경변수로 '/<repo>/' 를 넘긴다 (deploy 워크플로에서 자동 설정).
const base = process.env.PAGES_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      // start_url / scope / id 는 지정하지 않는다 → 플러그인이 base 로부터 자동 계산 (서브경로 배포 호환)
      manifest: {
        name: '명함 스캐너',
        short_name: '명함스캐너',
        description: '명함 사진에서 텍스트를 추출해 연락처로 정리합니다. 모든 처리는 기기 안에서 이뤄집니다.',
        lang: 'ko',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 셸만 프리캐시(설치 빠르게). tesseract wasm/worker/traineddata 는 아래 runtimeCaching 으로 첫 스캔 때 캐시.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['**/tesseract/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/\/tesseract\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/tesseract/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-assets-v1',
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
