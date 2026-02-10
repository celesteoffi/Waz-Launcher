/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

require("dotenv").config();

const { app, ipcMain, nativeTheme } = require("electron");
const { Microsoft } = require("minecraft-java-core");
const { autoUpdater } = require("electron-updater");

const path = require("path");
const fs = require("fs");

// -------------------- Discord Rich Presence (MAIN) --------------------
let RPC = null;
try {
  RPC = require("discord-rpc");
} catch (e) {
  console.warn("[RPC] discord-rpc not installed. Run: npm i discord-rpc");
}

const DISCORD_RPC_CLIENT_ID =
  process.env.DISCORD_RPC_CLIENT_ID || "1470721616550826105"; // <- TON Application ID

const launcherStartTimestamp = Date.now();
let rpc = null;
let rpcReady = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function setLauncherPresence(presence = {}) {
  if (!rpc || !rpcReady) return;

  const payload = {
    details: presence.details ? String(presence.details).slice(0, 128) : "UniverCraft Launcher",
    state: presence.state ? String(presence.state).slice(0, 128) : "Idle",
    startTimestamp: presence.startTimestamp ?? launcherStartTimestamp,

    // Ces assets doivent exister dans Discord Developer Portal > Rich Presence > Art Assets
    largeImageKey: presence.largeImageKey ?? "logo",
    largeImageText: presence.largeImageText ?? "UniverCraft",
    smallImageKey: presence.smallImageKey,
    smallImageText: presence.smallImageText,

    // Max 2 boutons
    buttons: Array.isArray(presence.buttons) ? presence.buttons.slice(0, 2) : undefined,
  };

  rpc.setActivity(payload).catch(() => {});
}

async function initDiscordRPC() {
  if (!RPC) return;

  if (!DISCORD_RPC_CLIENT_ID) {
    console.warn("[RPC] Missing Client ID => RPC disabled.");
    return;
  }

  try {
    RPC.register(DISCORD_RPC_CLIENT_ID);
  } catch {}

  rpc = new RPC.Client({ transport: "ipc" });

  rpc.on("ready", () => {
    rpcReady = true;
    console.log("[RPC] Connected to Discord.");

    // Presence par défaut
    setLauncherPresence({
      details: "UniverCraft Launcher",
      state: "Ouvert",
      largeImageKey: "logo",
      largeImageText: "UniverCraft",
    });
  });

  rpc.on("disconnected", () => {
    rpcReady = false;
    console.warn("[RPC] Disconnected.");
  });

  // Retry si Discord n'est pas ouvert
  for (let i = 0; i < 10; i++) {
    try {
      await rpc.login({ clientId: DISCORD_RPC_CLIENT_ID });
      return;
    } catch {
      await sleep(1500);
    }
  }

  console.warn("[RPC] Could not connect (Discord fermé ?). RPC ignorée.");
}
// ----------------------------------------------------------------------

const UpdateWindow = require("./assets/js/windows/updateWindow.js");
const MainWindow = require("./assets/js/windows/mainWindow.js");

let dev = process.env.NODE_ENV === "dev";

if (dev) {
  let appPath = path.resolve("./data/Launcher").replace(/\\/g, "/");
  let appdata = path.resolve("./data").replace(/\\/g, "/");
  if (!fs.existsSync(appPath)) fs.mkdirSync(appPath, { recursive: true });
  if (!fs.existsSync(appdata)) fs.mkdirSync(appdata, { recursive: true });
  app.setPath("userData", appPath);
  app.setPath("appData", appdata);
}

if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(() => {
    initDiscordRPC(); // <-- démarre la Rich Presence

    if (dev) return MainWindow.createWindow();
    UpdateWindow.createWindow();
  });

ipcMain.on("main-window-open", () => MainWindow.createWindow());
ipcMain.on("main-window-dev-tools", () => MainWindow.getWindow().webContents.openDevTools({ mode: "detach" }));
ipcMain.on("main-window-dev-tools-close", () => MainWindow.getWindow().webContents.closeDevTools());
ipcMain.on("main-window-close", () => MainWindow.destroyWindow());
ipcMain.on("main-window-reload", () => MainWindow.getWindow().reload());
ipcMain.on("main-window-progress", (event, options) => MainWindow.getWindow().setProgressBar(options.progress / options.size));
ipcMain.on("main-window-progress-reset", () => MainWindow.getWindow().setProgressBar(-1));
ipcMain.on("main-window-progress-load", () => MainWindow.getWindow().setProgressBar(2));
ipcMain.on("main-window-minimize", () => MainWindow.getWindow().minimize());

ipcMain.on("update-window-close", () => UpdateWindow.destroyWindow());
ipcMain.on("update-window-dev-tools", () => UpdateWindow.getWindow().webContents.openDevTools({ mode: "detach" }));
ipcMain.on("update-window-progress", (event, options) => UpdateWindow.getWindow().setProgressBar(options.progress / options.size));
ipcMain.on("update-window-progress-reset", () => UpdateWindow.getWindow().setProgressBar(-1));
ipcMain.on("update-window-progress-load", () => UpdateWindow.getWindow().setProgressBar(2));

ipcMain.handle("path-user-data", () => app.getPath("userData"));
ipcMain.handle("appData", (e) => app.getPath("appData"));

ipcMain.on("main-window-maximize", () => {
  if (MainWindow.getWindow().isMaximized()) {
    MainWindow.getWindow().unmaximize();
  } else {
    MainWindow.getWindow().maximize();
  }
});

ipcMain.on("main-window-hide", () => MainWindow.getWindow().hide());
ipcMain.on("main-window-show", () => MainWindow.getWindow().show());

ipcMain.handle("Microsoft-window", async (_, client_id) => {
  return await new Microsoft(client_id).getAuth();
});

ipcMain.handle("is-dark-theme", (_, theme) => {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return nativeTheme.shouldUseDarkColors;
});

// -------------------- RPC IPC (Renderer -> Main) --------------------
ipcMain.on("rpc-set", (event, presence) => {
  setLauncherPresence(presence || {});
});

ipcMain.on("rpc-clear", async () => {
  if (!rpc || !rpcReady) return;
  await rpc.clearActivity().catch(() => {});
});
// -------------------------------------------------------------------

app.on("window-all-closed", async () => {
  try {
    if (rpc) await rpc.clearActivity().catch(() => {});
    if (rpc) rpc.destroy?.();
  } catch {}
  app.quit();
});

autoUpdater.autoDownload = false;

ipcMain.handle("update-app", async () => {
  return await new Promise(async (resolve, reject) => {
    autoUpdater
      .checkForUpdates()
      .then((res) => resolve(res))
      .catch((error) => {
        reject({
          error: true,
          message: error,
        });
      });
  });
});

autoUpdater.on("update-available", () => {
  const updateWindow = UpdateWindow.getWindow();
  if (updateWindow) updateWindow.webContents.send("updateAvailable");
});

ipcMain.on("start-update", () => {
  autoUpdater.downloadUpdate();
});

autoUpdater.on("update-not-available", () => {
  const updateWindow = UpdateWindow.getWindow();
  if (updateWindow) updateWindow.webContents.send("update-not-available");
});

autoUpdater.on("update-downloaded", () => {
  autoUpdater.quitAndInstall();
});

autoUpdater.on("download-progress", (progress) => {
  const updateWindow = UpdateWindow.getWindow();
  if (updateWindow) updateWindow.webContents.send("download-progress", progress);
});

autoUpdater.on("error", (err) => {
  const updateWindow = UpdateWindow.getWindow();
  if (updateWindow) updateWindow.webContents.send("error", err);
});
