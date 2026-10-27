import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppBridgeApi } from '../shared/ipc'
import type { IndexProgress, LogEntry } from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped as never)
  return () => ipcRenderer.removeListener(channel, wrapped as never)
}

const api: AppBridgeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),

  pickFolders: () => ipcRenderer.invoke(IPC.pickFolders),
  listFolders: () => ipcRenderer.invoke(IPC.listFolders),
  removeFolder: (id) => ipcRenderer.invoke(IPC.removeFolder, id),

  startIndex: (mode) => ipcRenderer.invoke(IPC.startIndex, mode),
  cancelIndex: () => ipcRenderer.invoke(IPC.cancelIndex),
  getIndexProgress: () => ipcRenderer.invoke(IPC.getIndexProgress),
  getIndexStats: () => ipcRenderer.invoke(IPC.getIndexStats),
  refreshFile: (id) => ipcRenderer.invoke(IPC.refreshFile, id),
  ocrFile: (id) => ipcRenderer.invoke(IPC.ocrFile, id),
  search: (request) => ipcRenderer.invoke(IPC.search, request),
  openFile: (id) => ipcRenderer.invoke(IPC.openFile, id),
  revealFile: (id) => ipcRenderer.invoke(IPC.revealFile, id),
  openParentFolder: (id) => ipcRenderer.invoke(IPC.openParentFolder, id),
  openFolder: (id) => ipcRenderer.invoke(IPC.openFolder, id),
  listLogs: (limit) => ipcRenderer.invoke(IPC.listLogs, limit),
  clearLogs: () => ipcRenderer.invoke(IPC.clearLogs),
  onIndexProgress: (listener) => subscribe<IndexProgress>(IPC.progressEvent, listener),
  onIndexLog: (listener) => subscribe<LogEntry>(IPC.logEvent, listener)
}

contextBridge.exposeInMainWorld('api', api)
