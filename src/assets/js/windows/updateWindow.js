/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

"use strict";
const { app, BrowserWindow, Menu } = require("electron");
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

function createWindow() {
  destroyWindow();

  // ✅ Taille plus “premium” (moins de vide en bas)
  // Tu peux ajuster si tu veux: 480x560 / 520x600 etc.
  const WIDTH = 520;
  const HEIGHT = 560;

  updateWindow = new BrowserWindow({
    title: "Mise à jour",
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,

    icon: `./src/assets/images/icon.${os.platform() === "win32" ? "ico" : "png"}`,
    frame: false,
    show: false,

    // ✅ évite les bords moches / flash blanc
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

    // Re-center au cas où (multi-écrans)
    updateWindow.center();

    if (dev) updateWindow.webContents.openDevTools({ mode: "detach" });
    updateWindow.show();
  });
}

module.exports = {
  getWindow,
  createWindow,
  destroyWindow,
};
