"use strict";

/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

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

  updateWindow = new BrowserWindow({
    title: "Mise à jour",

    // ✅ Taille FIXE (pas d'auto-resize)
    width: 400,
    height: 500,

    resizable: false,
    frame: false,
    show: false,

    // optionnel (si tu veux éviter un fond blanc pendant le blur)
    // backgroundColor: "#00000000",

    icon: `./src/assets/images/icon.${os.platform() === "win32" ? "ico" : "png"}`,

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
    if (dev) updateWindow.webContents.openDevTools({ mode: "detach" });
    updateWindow.show();
  });
}

module.exports = {
  getWindow,
  createWindow,
  destroyWindow,
};
