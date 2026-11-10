// ../../../src/preload/extensions-bridge.ts
var import_electron = require("electron");
var bridge = {
  request: (payload, binary) => import_electron.ipcRenderer.invoke("msb:extension-bridge", payload, binary)
};
import_electron.contextBridge.exposeInMainWorld("extensionsBridge", bridge);
