"use strict";
const electron = require("electron");
const IPC = {
  getAppInfo: "app:get-info",
  pickFolders: "folders:pick",
  listFolders: "folders:list",
  removeFolder: "folders:remove",
  openFolder: "shell:open-folder",
  startIndex: "index:start",
  cancelIndex: "index:cancel",
  getIndexProgress: "index:progress-get",
  getIndexStats: "index:stats",
  refreshFile: "index:refresh-file",
  ocrFile: "index:ocr-file",
  search: "search:query",
  openFile: "shell:open-file",
  revealFile: "shell:reveal-file",
  openParentFolder: "shell:open-parent",
  listLogs: "logs:list",
  clearLogs: "logs:clear",
  progressEvent: "index:progress-event",
  logEvent: "index:log-event"
};
function subscribe(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  electron.ipcRenderer.on(channel, wrapped);
  return () => electron.ipcRenderer.removeListener(channel, wrapped);
}
const api = {
  getAppInfo: () => electron.ipcRenderer.invoke(IPC.getAppInfo),
  pickFolders: () => electron.ipcRenderer.invoke(IPC.pickFolders),
  listFolders: () => electron.ipcRenderer.invoke(IPC.listFolders),
  removeFolder: (id) => electron.ipcRenderer.invoke(IPC.removeFolder, id),
  startIndex: (mode) => electron.ipcRenderer.invoke(IPC.startIndex, mode),
  cancelIndex: () => electron.ipcRenderer.invoke(IPC.cancelIndex),
  getIndexProgress: () => electron.ipcRenderer.invoke(IPC.getIndexProgress),
  getIndexStats: () => electron.ipcRenderer.invoke(IPC.getIndexStats),
  refreshFile: (id) => electron.ipcRenderer.invoke(IPC.refreshFile, id),
  ocrFile: (id) => electron.ipcRenderer.invoke(IPC.ocrFile, id),
  search: (request) => electron.ipcRenderer.invoke(IPC.search, request),
  openFile: (id) => electron.ipcRenderer.invoke(IPC.openFile, id),
  revealFile: (id) => electron.ipcRenderer.invoke(IPC.revealFile, id),
  openParentFolder: (id) => electron.ipcRenderer.invoke(IPC.openParentFolder, id),
  openFolder: (id) => electron.ipcRenderer.invoke(IPC.openFolder, id),
  listLogs: (limit) => electron.ipcRenderer.invoke(IPC.listLogs, limit),
  clearLogs: () => electron.ipcRenderer.invoke(IPC.clearLogs),
  onIndexProgress: (listener) => subscribe(IPC.progressEvent, listener),
  onIndexLog: (listener) => subscribe(IPC.logEvent, listener)
};
electron.contextBridge.exposeInMainWorld("api", api);
