import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 渲染层构建：只出 dist/（Tauri 的 frontendDist）。
// 目标 chrome109 = Win7 上 WebView2 固定版 109 的下限；旧 Electron 版为 chrome108，兼容性只升不降。
export default defineConfig({
  plugins: [vue()],
  root: 'src/renderer',
  clearScreen: false,
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
    }
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome109'
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] }
  }
})
