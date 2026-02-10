// assets/js/utils/discordRpc.js
// Simple helper to update Discord Rich Presence via IPC without crashing outside Electron.

let ipcRenderer = null;

try {
  // In some setups, require("electron") works in renderer
  ({ ipcRenderer } = require("electron"));
} catch {
  ipcRenderer = null;
}

export function rpcSet(presence) {
  try {
    if (!ipcRenderer) return;
    ipcRenderer.send("rpc-set", presence || {});
  } catch {}
}

export function rpcClear() {
  try {
    if (!ipcRenderer) return;
    ipcRenderer.send("rpc-clear");
  } catch {}
}
