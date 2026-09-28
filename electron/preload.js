const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  version: process.versions.electron,
  saveSecret: secret => ipcRenderer.invoke("desktop-config:save", secret),
});
