import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = fileURLToPath(new URL('./src/shared', import.meta.url))
const rendererSrc = fileURLToPath(new URL('./src/renderer/src', import.meta.url))

const alias = {
  '@shared': shared,
  '@renderer': rendererSrc
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          format: 'es'
        }
      }
    }
  }
})
