const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("mindbox", {
  desktop: true,
  version: process.versions.electron,
});
