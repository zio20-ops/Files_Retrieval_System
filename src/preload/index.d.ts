import type { AppBridgeApi } from '../shared/ipc'

declare global {
  interface Window {
    api: AppBridgeApi
  }
}

export {}
