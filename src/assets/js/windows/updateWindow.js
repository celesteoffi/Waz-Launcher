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

/**
 * Redimensionne la fenêtre selon le contenu HTML (hauteur/largeur)
 * - safe: ne casse rien si la window n'existe pas
 */
async function fitToContent(extraW = 40, extraH = 60) {
  if (!updateWindow || updateWindow.isDestroyed()) return;

  try {
    const wc = updateWindow.webContents;

    // On lit la taille réelle du contenu
    const { w, h } = await wc.executeJavaScript(
      `(() => {
        const doc = document.documentElement;
        const body = document.body;

        // largeur/hauteur "réelles" du contenu
        const contentW = Math.max(
          doc.scrollWidth, body.scrollWidth,
          doc.offsetWidth, body.offsetWidth,
          doc.clientWidth
        );

        const contentH = Math.max(
          doc.scrollHeight, body.scrollHeight,
          doc.offsetHeight, body.offsetHeight,
          doc.clientHeight
        );

        return { w: contentW, h: contentH };
      })()`,
      true
    );

    // Limites (évite que ça devienne trop petit ou trop grand)
    const minW = 420;
    const minH = 340;
    const maxW = 760;
    const maxH = 720;

    const targetW = Math.max(minW, Math.min(maxW, Math.ceil(w + extraW)));
    const targetH = Math.max(minH, Math.min(maxH, Math.ceil(h + extraH)));

    // setContentSize gère mieux que setSize pour une window sans frame
    updateWindow.setContentSize(targetW, targetH, true);
    updateWindow.center();
  } catch (e) {
    // si executeJavaScript échoue, on ne casse rien
  }
}

function createWindow() {
  destroyWindow();

  updateWindow = new BrowserWindow({
    title: "Mise à jour",
    width: 480,          // ✅ base plus cohérente
    height: 380,         // ✅ base plus cohérente
    resizable: false,
    icon: `./src/assets/images/icon.${os.platform() === "win32" ? "ico" : "png"}`,
    frame: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  Menu.setApplicationMenu(null);
  updateWindow.setMenuBarVisibility(false);

  updateWindow.loadFile(path.join(`${app.getAppPath()}/src/index.html`));

  updateWindow.once("ready-to-show", async () => {
    if (!updateWindow) return;
    if (dev) updateWindow.webContents.openDevTools({ mode: "detach" });

    // ✅ auto-fit au démarrage
    await fitToContent();
    updateWindow.show();
  });

  // ✅ Re-fit après chargement complet
  updateWindow.webContents.on("did-finish-load", () => {
    fitToContent();
  });

  // ✅ IPC appelé depuis ton index.js (requestFit())
  ipcMain.removeAllListeners("update-window-fit");
  ipcMain.on("update-window-fit", () => fitToContent());
}

module.exports = {
  getWindow,
  createWindow,
  destroyWindow,
};
