/**
 * UniverCraft Launcher - Splash / Update Window
 * Refait & personnalisé 100% pour UniverCraft
 */

const { ipcRenderer, shell } = require("electron");
const pkg = require("../package.json");
const os = require("os");
const nodeFetch = require("node-fetch");

import { config, database } from "./utils.js";

/* ------------------------------ Helpers ---------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { timeout = 8000, headers = {} } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await nodeFetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "UniverCraftLauncher",
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatPercent(value, max) {
  if (!max || max <= 0) return "0%";
  return `${Math.floor((value / max) * 100)}%`;
}

/**
 * RPC SAFE (renderer -> main)
 * - Ne casse rien si le main n'a pas la feature
 * - Ne dépend pas de dotenv / discord-rpc ici
 */
function rpcSet(presence) {
  try {
    ipcRenderer.send("rpc-set", presence || {});
  } catch {}
}

/* ------------------------------ Splash class ----------------------------- */

class Splash {
  constructor() {
    // Elements (compat anciens + nouveaux)
    this.splashRoot = document.querySelector("#splash");
    this.splashLogoOld = document.querySelector(".splash"); // ancien <img class="splash">
    this.splashMessage = document.querySelector(".splash-message");
    this.splashAuthor = document.querySelector(".splash-author");
    this.authorSpan = document.querySelector(".splash-author .author");
    this.message = document.querySelector(".message");
    this.progress = document.querySelector("progress.progress") || document.querySelector(".progress");
    this.percentEl = document.getElementById("progress-percent"); // nouveau
    this.downloadBtn = null;

    this._interval = null;
    this._closing = false;
    this._listenersBound = false;

    this.brand = {
      name: "UniverCraft",
      discordLabel: "Discord",
      colors: ["#00c2ff", "#00d084"],
    };

    this.splashes = [
      { message: "Connexion aux serveurs d’UniverCraft…", author: "UniverCraft" },
      { message: "Préparation de votre aventure…", author: "Launcher" },
      { message: "Chargement des modules…", author: "Core" },
      { message: "Optimisation des performances…", author: "Engine" },
      { message: "Synchronisation des fichiers…", author: "Updater" },
    ];

    document.addEventListener("DOMContentLoaded", () => this.init());
    document.addEventListener("keydown", (e) => this.handleDevTools(e));
  }

  async init() {
    try {
      // RPC: update window ouverte
      rpcSet({
        details: "UniverCraft Launcher",
        state: "Démarrage…",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      // Theme
      const db = new database();
      const configClient = await db.readData("configClient");
      const theme = configClient?.launcher_config?.theme || "auto";

      const isDarkTheme = await ipcRenderer.invoke("is-dark-theme", theme).then((r) => r);
      document.body.className = isDarkTheme ? "dark global" : "light global";

      // Windows: init progress in taskbar
      if (process.platform === "win32") ipcRenderer.send("update-window-progress-load");

      await this.playIntro();
      await this.checkUpdateFlow();
    } catch (err) {
      console.error(err);

      rpcSet({
        details: "UniverCraft Launcher",
        state: "Erreur au démarrage",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      this.shutdown(`Erreur au démarrage :<br>${this.escapeHtml(err.message || String(err))}`);
    }
  }

  /* ------------------------------ Intro anim ------------------------------ */

  async playIntro() {
    if (this.splashRoot) this.splashRoot.style.display = "block";

    // Message initial (random) + rotation douce
    this.setSplash(this.randomSplash());

    // Petite anim de l'ancien logo si encore présent
    await sleep(120);
    if (this.splashLogoOld) this.splashLogoOld.classList.add("opacity");
    await sleep(380);
    if (this.splashLogoOld) this.splashLogoOld.classList.add("translate");

    // Afficher textes
    await sleep(220);
    this.splashMessage?.classList.add("opacity");
    this.splashAuthor?.classList.add("opacity");
    this.message?.classList.add("opacity");

    // Rotation messages toutes les 2.6s (jusqu’à update)
    this._interval = setInterval(() => {
      if (this._closing) return;
      this.setSplash(this.randomSplash());
    }, 2600);
  }

  randomSplash() {
    return this.splashes[Math.floor(Math.random() * this.splashes.length)];
  }

  setSplash({ message, author }) {
    if (this.splashMessage) this.splashMessage.textContent = message || "";
    if (this.authorSpan) this.authorSpan.textContent = author ? `@${author}` : "";

    // RPC: petit statut
    rpcSet({
      details: "UniverCraft Launcher",
      state: message || "Initialisation…",
      largeImageKey: "logo",
      largeImageText: "UniverCraft",
    });
  }

  /* ------------------------------ Update flow ----------------------------- */

  async checkUpdateFlow() {
    this.setStatus("Recherche de mise à jour…");
    this.hideDownloadButton();
    this.hideProgress();

    rpcSet({
      details: "UniverCraft Launcher",
      state: "Recherche de mise à jour…",
      largeImageKey: "logo",
      largeImageText: "UniverCraft",
      smallImageKey: "download",
      smallImageText: "Update",
    });

    this.bindIpcOnce();

    try {
      // Lancer check auto-updater côté main process
      await ipcRenderer.invoke("update-app");
      // => Suite via events: updateAvailable / update-not-available / error
    } catch (err) {
      console.error(err);

      rpcSet({
        details: "UniverCraft Launcher",
        state: "Erreur recherche update",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      this.shutdown(`Erreur lors de la recherche de mise à jour :<br>${this.escapeHtml(err.message)}`);
    }
  }

  bindIpcOnce() {
    if (this._listenersBound) return;
    this._listenersBound = true;

    // Update disponible
    ipcRenderer.on("updateAvailable", async () => {
      if (this._closing) return;

      rpcSet({
        details: "UniverCraft Launcher",
        state: "Mise à jour disponible",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
        smallImageKey: "download",
        smallImageText: "Update",
      });

      // stop rotation messages
      this.stopSplashRotation();

      this.setStatus("Mise à jour disponible !");
      this.hideDownloadButton();

      // Windows: download + install auto
      if (os.platform() === "win32") {
        this.showProgress();
        this.setProgress(0, 1);
        ipcRenderer.send("start-update");
        return;
      }

      // Linux/mac: propose download externe (GitHub assets)
      await this.downloadUpdateExternal();
    });

    // Progress download (Windows)
    ipcRenderer.on("download-progress", (event, progress) => {
      if (this._closing) return;

      const transferred = progress?.transferred ?? 0;
      const total = progress?.total ?? 0;

      ipcRenderer.send("update-window-progress", { progress: transferred, size: total });
      this.showProgress();
      this.setProgress(transferred, total);
      this.updatePercent(transferred, total);

      // Status plus "premium"
      if (total > 0) {
        const pct = Math.floor((transferred / total) * 100);

        rpcSet({
          details: "UniverCraft Launcher",
          state: `Téléchargement MAJ… (${pct}%)`,
          largeImageKey: "logo",
          largeImageText: "UniverCraft",
          smallImageKey: "download",
          smallImageText: `${pct}%`,
        });

        this.setStatus(`Téléchargement de la mise à jour… <span style="opacity:.8">(${pct}%)</span>`);
      } else {
        rpcSet({
          details: "UniverCraft Launcher",
          state: "Téléchargement MAJ…",
          largeImageKey: "logo",
          largeImageText: "UniverCraft",
          smallImageKey: "download",
          smallImageText: "Update",
        });

        this.setStatus("Téléchargement de la mise à jour…");
      }
    });

    // Pas d’update
    ipcRenderer.on("update-not-available", async () => {
      if (this._closing) return;

      rpcSet({
        details: "UniverCraft Launcher",
        state: "Aucune mise à jour",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      this.stopSplashRotation();
      this.setStatus("Aucune mise à jour disponible.");
      await sleep(500);
      await this.maintenanceCheck();
    });

    // Erreur auto-updater
    ipcRenderer.on("error", (event, err) => {
      if (this._closing) return;
      const msg = err?.message || String(err || "Erreur inconnue");

      rpcSet({
        details: "UniverCraft Launcher",
        state: "Erreur updater",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      this.shutdown(this.escapeHtml(msg));
    });
  }

  stopSplashRotation() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  /* ------------------------------ External update (mac/linux) ------------- */

  getLatestReleaseForOS(osKey, preferredExt, assets) {
    // osKey: 'mac' / 'linux'
    const list = (assets || []).filter((a) => {
      const name = (a.name || "").toLowerCase();
      return name.includes(osKey) && name.endsWith(preferredExt);
    });

    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list[0] || null;
  }

  async downloadUpdateExternal() {
    try {
      rpcSet({
        details: "UniverCraft Launcher",
        state: "Récupération release GitHub…",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
        smallImageKey: "download",
        smallImageText: "GitHub",
      });

      this.setStatus("Récupération de la dernière version…");

      const repoURL = pkg.repository.url
        .replace("git+", "")
        .replace(".git", "")
        .replace("https://github.com/", "")
        .split("/");

      const owner = repoURL[0];
      const repo = repoURL[1];

      // API repos/releases (direct, fiable)
      const releases = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases`, {
        timeout: 9000,
        headers: { Accept: "application/vnd.github+json" },
      });

      const latest = releases?.[0];
      const assets = latest?.assets || [];

      let picked = null;

      if (os.platform() === "darwin") {
        picked = this.getLatestReleaseForOS("mac", ".dmg", assets);
      } else if (os.platform() === "linux") {
        // AppImage recommandé
        picked =
          this.getLatestReleaseForOS("linux", ".appimage", assets) ||
          this.getLatestReleaseForOS("linux", ".deb", assets);
      }

      if (!picked) {
        this.setStatus(
          `Mise à jour disponible, mais aucun fichier compatible n’a été trouvé.<br>` +
            `<span style="opacity:.8">Ouvre la page GitHub pour télécharger.</span><br>` +
            `<div class="download-update" id="download-update-btn">Ouvrir GitHub</div>`
        );
        this.attachDownloadButton(() => shell.openExternal(latest?.html_url || pkg.homepage));
        return;
      }

      this.setStatus(
        `Mise à jour disponible !<br>` +
          `<span style="opacity:.8">${this.escapeHtml(picked.name)}</span><br>` +
          `<div class="download-update" id="download-update-btn">Télécharger</div>`
      );

      this.attachDownloadButton(() => {
        shell.openExternal(picked.browser_download_url);

        rpcSet({
          details: "UniverCraft Launcher",
          state: "Téléchargement externe lancé…",
          largeImageKey: "logo",
          largeImageText: "UniverCraft",
        });

        this.shutdown("Téléchargement lancé…");
      });
    } catch (err) {
      console.error(err);

      rpcSet({
        details: "UniverCraft Launcher",
        state: "Erreur GitHub (fallback)",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      this.setStatus(
        `Impossible de récupérer la mise à jour.<br>` +
          `<span style="opacity:.85">Vérifie ta connexion internet.</span>`
      );
      await sleep(900);
      return this.maintenanceCheck(); // fallback: continue
    }
  }

  attachDownloadButton(onClick) {
    // le bouton est injecté via innerHTML -> on récupère et on bind
    const btn = document.getElementById("download-update-btn") || document.querySelector(".download-update");
    if (!btn) return;

    // éviter multi-bind
    btn.replaceWith(btn.cloneNode(true));
    const fresh = document.getElementById("download-update-btn") || document.querySelector(".download-update");
    if (!fresh) return;

    fresh.addEventListener("click", onClick);
    this.downloadBtn = fresh;
  }

  hideDownloadButton() {
    const btn = document.getElementById("download-update-btn") || document.querySelector(".download-update");
    if (btn) btn.remove();
    this.downloadBtn = null;
  }

  /* ------------------------------ Maintenance / start ---------------------- */

  async maintenanceCheck() {
    try {
      rpcSet({
        details: "UniverCraft Launcher",
        state: "Vérification des services…",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      this.setStatus("Vérification de l’état des services…");
      const res = await config.GetConfig();

      if (res?.maintenance) {
        rpcSet({
          details: "UniverCraft Launcher",
          state: "Maintenance en cours",
          largeImageKey: "logo",
          largeImageText: "UniverCraft",
        });
        return this.shutdown(res.maintenance_message || "Maintenance en cours.");
      }

      return this.startLauncher();
    } catch (e) {
      console.error(e);

      rpcSet({
        details: "UniverCraft Launcher",
        state: "Offline (pas d'internet)",
        largeImageKey: "logo",
        largeImageText: "UniverCraft",
      });

      return this.shutdown("Aucune connexion internet détectée,<br>veuillez réessayer ultérieurement.");
    }
  }

  startLauncher() {
    this.setStatus("Démarrage du launcher…");
    this._closing = true;
    this.stopSplashRotation();

    rpcSet({
      details: "UniverCraft Launcher",
      state: "Ouverture du launcher…",
      largeImageKey: "logo",
      largeImageText: "UniverCraft",
      smallImageKey: "play",
      smallImageText: "Launch",
    });

    ipcRenderer.send("main-window-open");
    ipcRenderer.send("update-window-close");
  }

  /* ------------------------------ UI utilities ----------------------------- */

  setStatus(html) {
    if (!this.message) return;
    this.message.innerHTML = html;
  }

showProgress() {
  const wrap = document.getElementById("progress-wrap");
  if (wrap) wrap.classList.add("show");
  if (this.percentEl) this.percentEl.textContent = this.percentEl.textContent || "0%";
}

hideProgress() {
  const wrap = document.getElementById("progress-wrap");
  if (wrap) wrap.classList.remove("show");
  this.setProgress(0, 0);
  this.updatePercent(0, 0);
}

  setProgress(value, max) {
    if (!this.progress) return;
    this.progress.value = value || 0;
    this.progress.max = max || 0;
  }

  updatePercent(value, max) {
    if (!this.percentEl) return;
    this.percentEl.textContent = formatPercent(value, max);
  }

  shutdown(text) {
    if (this._closing) return;
    this._closing = true;
    this.stopSplashRotation();
    this.hideDownloadButton();

    rpcSet({
      details: "UniverCraft Launcher",
      state: "Fermeture…",
      largeImageKey: "logo",
      largeImageText: "UniverCraft",
    });

    const safe = text || "Arrêt…";
    this.setStatus(`${safe}<br><span style="opacity:.85">Arrêt dans <b id="shutdown-count">5</b>s</span>`);

    let i = 5;
    const timer = setInterval(() => {
      i -= 1;
      const el = document.getElementById("shutdown-count");
      if (el) el.textContent = String(clamp(i, 0, 99));
      if (i <= 0) {
        clearInterval(timer);
        ipcRenderer.send("update-window-close");
      }
    }, 1000);
  }

  escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  /* ------------------------------ Devtools -------------------------------- */

  handleDevTools(e) {
    const isCtrlShiftI = e.ctrlKey && e.shiftKey && (e.key === "I" || e.keyCode === 73);
    const isF12 = e.key === "F12" || e.keyCode === 123;
    if (isCtrlShiftI || isF12) ipcRenderer.send("update-window-dev-tools");
  }
}

new Splash();
