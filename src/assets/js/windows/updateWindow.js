/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

"use strict";

const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const os = require("os");

let dev = process.env.DEV_TOOL === "open";
let updateWindow = undefined;

function getWindow() {
  return updateWindow;
}

function destroyWindow() {
  if (!updateWindow) return;
  updateWindow.close();
  updateWindow = undefined;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Ajuste la fenêtre à la taille du contenu HTML
 */
function fitToContent(win, { minW = 420, minH = 520, maxW = 820, maxH = 900 } = {}) {
  if (!win || win.isDestroyed()) return;

  const wc = win.webContents;

  // On mesure la taille réelle du rendu (scrollWidth/scrollHeight)
  wc.executeJavaScript(
    `(() => {
      const doc = document.documentElement;
      const body = document.body;
      const w = Math.max(doc.scrollWidth, body.scrollWidth, doc.clientWidth);
      const h = Math.max(doc.scrollHeight, body.scrollHeight, doc.clientHeight);
      return { w, h };
    })()`,
    true
  )
    .then(({ w, h }) => {
      if (!w || !h) return;

      // + marges pour bordures/ombres
      const targetW = clamp(Math.ceil(w) + 40, minW, maxW);
      const targetH = clamp(Math.ceil(h) + 40, minH, maxH);

      const [curW, curH] = win.getSize();
      if (Math.abs(curW - targetW) < 2 && Math.abs(curH - targetH) < 2) return;

      win.setSize(targetW, targetH, true);
      win.center();
    })
    .catch(() => {});
}

function createWindow() {
  destroyWindow();

  updateWindow = new BrowserWindow({
    title: "Mise à jour",
    width: 520,
    height: 620,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    icon: `./src/assets/images/icon.${os.platform() === "win32" ? "ico" : "png"}`,
    frame: false,
    show: false,
    backgroundColor: "#0b0f14",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  Menu.setApplicationMenu(null);
  updateWindow.setMenuBarVisibility(false);

  updateWindow.loadFile(path.join(`${app.getAppPath()}/src/index.html`));

  updateWindow.once("ready-to-show", () => {
    if (!updateWindow) return;

    // Devtools si besoin
    if (dev) updateWindow.webContents.openDevTools({ mode: "detach" });

    updateWindow.show();

    // Premier auto-fit après rendu
    setTimeout(() => fitToContent(updateWindow), 120);
    setTimeout(() => fitToContent(updateWindow), 400);
  });

  // Auto-fit après chaque fin de chargement
  updateWindow.webContents.on("did-finish-load", () => {
    setTimeout(() => fitToContent(updateWindow), 80);
  });

  // Auto-fit quand la page bouge (anim/transition)
  updateWindow.webContents.on("dom-ready", () => {
    setTimeout(() => fitToContent(updateWindow), 80);
  });
}

/**
 * IPC: le renderer demande un refit (quand message/progress change)
 */
ipcMain.on("update-window-fit", () => {
  const win = getWindow();
  if (!win) return;
  // petit debounce naturel
  setTimeout(() => fitToContent(win), 40);
});

module.exports = {
  getWindow,
  createWindow,
  destroyWindow,
};
