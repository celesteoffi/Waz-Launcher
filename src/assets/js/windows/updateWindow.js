"use strict";

const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const os = require("os");

let dev = process.env.DEV_TOOL === "open";
let updateWindow;

/* =========================
   Auto fit contenu (IMPORTANT)
   ========================= */
async function fitWindow() {
  if (!updateWindow) return;

  try {
    const size = await updateWindow.webContents.executeJavaScript(`
      ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight
      })
    `);

    const width  = Math.max(460, size.w + 40);
    const height = Math.max(320, size.h + 40);

    updateWindow.setContentSize(width, height);
    updateWindow.center();
  } catch {}
}

function getWindow() {
  return updateWindow;
}

function destroyWindow() {
  if (!updateWindow) return;
  updateWindow.close();
  updateWindow = undefined;
}

function createWindow() {
  destroyWindow();

  updateWindow = new BrowserWindow({
    title: "Mise à jour",

    /* ✅ Taille de base très petite */
    width: 460,
    height: 340,

    frame: false,
    resizable: false,
    show: false,

    backgroundColor: "#00000000",

    icon: `./src/assets/images/icon.${os.platform() === "win32" ? "ico" : "png"}`,

    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  Menu.setApplicationMenu(null);

  updateWindow.loadFile(
    path.join(`${app.getAppPath()}/src/index.html`)
  );

  /* ===== AUTO RESIZE ===== */
  updateWindow.once("ready-to-show", async () => {
    await fitWindow();
    if (dev) updateWindow.webContents.openDevTools({ mode: "detach" });
    updateWindow.show();
  });

  updateWindow.webContents.on("did-finish-load", fitWindow);

  ipcMain.removeAllListeners("update-window-fit");
  ipcMain.on("update-window-fit", fitWindow);
}

module.exports = {
  getWindow,
  createWindow,
  destroyWindow,
};
