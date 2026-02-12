/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup } from "../utils.js";
import { rpcSet } from "../utils/discordRpc.js";

rpcSet({
  details: "In the launcher",
  state: "Home",
  largeImageKey: "logo",
  largeImageText: "Launcher",
});

const { Launch } = require("minecraft-java-core");
const { shell, ipcRenderer } = require("electron");

class Home {
  static id = "home";

  async init(config) {
    this.config = config;
    this.db = new database();

    // ✅ IMPORTANT : Toujours sécuriser config + compte avant tout
    const configClient = await this.ensureConfigClient();

    // Si aucun compte -> on renvoie au login au lieu d'afficher "undefined"
    if (!configClient.account_selected) {
      console.warn("[LOGIN] Aucun compte sélectionné/présent -> redirection login");
      changePanel("login");
      return;
    }

    // ✅ Lance tout sans bloquer : si news crash, ça ne casse plus login/instances
    await Promise.allSettled([
      this.news(),
      (async () => this.instancesSelect())(),
      (async () => this.initSkin3D())(),
    ]);

    // Socials
    this.socialLick();

    // Settings
    const settingsBtn = document.querySelector(".settings-btn");
    if (settingsBtn) settingsBtn.addEventListener("click", () => changePanel("settings"));
  }

  /* ========================== SAFE HTML HELPERS ========================== */

  escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  safeTextWithBreaks(str) {
    return this.escapeHtml(str).replace(/\n/g, "<br>");
  }

  /* ============================ ACCOUNTS HELPERS =========================== */

  /**
   * Essaie de récupérer la liste des comptes sous une forme stable:
   * - { id, data }[]
   * Compatible si la DB stocke:
   * - accounts: { "<id>": {...}, "<id2>": {...} }
   * - accounts: [ {...}, {...} ]
   */
  async getAccountsListSafe() {
    let accountsRaw = null;

    try {
      accountsRaw = await this.db.readData("accounts");
    } catch (e) {
      console.warn("[LOGIN] readData('accounts') failed:", e);
      return [];
    }

    // array
    if (Array.isArray(accountsRaw)) {
      return accountsRaw
        .filter(Boolean)
        .map((a) => {
          const id = a?.uuid || a?.id || a?.profile?.id || a?.profile?.uuid || a?.name || null;
          return id ? { id: String(id), data: a } : null;
        })
        .filter(Boolean);
    }

    // object map
    if (accountsRaw && typeof accountsRaw === "object") {
      return Object.entries(accountsRaw)
        .map(([id, data]) => (id && data ? { id: String(id), data } : null))
        .filter(Boolean);
    }

    return [];
  }

  /**
   * Lit un compte par id de manière robuste.
   * Certains "database" acceptent readData("accounts", id) uniquement,
   * d'autres stockent un objet global.
   */
  async readAccountByIdSafe(id) {
    if (!id) return null;

    // 1) voie rapide: readData("accounts", id)
    try {
      const direct = await this.db.readData("accounts", id);
      if (direct) return direct;
    } catch {}

    // 2) fallback: lire map complète
    const list = await this.getAccountsListSafe();
    const found = list.find((a) => String(a.id) === String(id));
    return found?.data ?? null;
  }

  /* ============================= CONFIG CLIENT ============================ */

  async ensureConfigClient() {
    let configClient = await this.db.readData("configClient");
    configClient = configClient ?? {};

    // Defaults launcher
    configClient.launcher_config = configClient.launcher_config ?? {
      closeLauncher: "close-all", // close-all | close-launcher
      download_multi: 10,
      intelEnabledMac: false,
    };

    // Defaults java
    configClient.java_config = configClient.java_config ?? {
      java_path: null,
      java_memory: { min: 2, max: 4 },
    };
    configClient.java_config.java_memory = configClient.java_config.java_memory ?? { min: 2, max: 4 };
    configClient.java_config.java_memory.min = configClient.java_config.java_memory.min ?? 2;
    configClient.java_config.java_memory.max = configClient.java_config.java_memory.max ?? 4;

    // Defaults game
    configClient.game_config = configClient.game_config ?? {
      screen_size: { width: 1280, height: 720 },
    };
    configClient.game_config.screen_size = configClient.game_config.screen_size ?? { width: 1280, height: 720 };
    configClient.game_config.screen_size.width = configClient.game_config.screen_size.width ?? 1280;
    configClient.game_config.screen_size.height = configClient.game_config.screen_size.height ?? 720;

    // instance select
    if (configClient.instance_selct === undefined) configClient.instance_selct = null;

    // ✅ FIX LOGIN: account_selected
    const accountsList = await this.getAccountsListSafe();
    const selectedId = configClient.account_selected ? String(configClient.account_selected) : null;
    const selectedExists = selectedId ? accountsList.some((a) => String(a.id) === selectedId) : false;

    // Si aucun compte, on met null (et init() redirigera vers login)
    if (accountsList.length === 0) {
      configClient.account_selected = null;
    } else if (!selectedId || !selectedExists) {
      // Sinon on prend le premier compte existant
      configClient.account_selected = accountsList[0].id;
    }

    // Sauvegarde sans casser
    try {
      await this.db.updateData("configClient", configClient);
    } catch (e) {
      console.warn("[CONFIG] updateData('configClient') failed:", e);
    }

    return configClient;
  }

  /* =============================== NEWS (SAFE) ============================ */

  async news() {
    const newsElement = document.querySelector(".news-list");
    if (!newsElement) return;

    // évite l’empilement si init() est rappelé
    newsElement.innerHTML = "";

    let news = null;
    try {
      news = await config.getNews();
    } catch (err) {
      console.warn("[NEWS] getNews error:", err);
      news = false;
    }

    // Pas de news
    if (Array.isArray(news) && news.length === 0) {
      const blockNews = document.createElement("div");
      blockNews.classList.add("news-block");
      blockNews.innerHTML = `
        <div class="news-header">
          <img class="server-status-icon" src="assets/images/icon.png">
          <div class="header-text">
            <div class="title">Aucune news n'est actuellement disponible.</div>
          </div>
          <div class="date">
            <div class="day">1</div>
            <div class="month">Janvier</div>
          </div>
        </div>
        <div class="news-content">
          <div class="bbWrapper">
            <p>Vous pourrez suivre ici toutes les news relatives au serveur.</p>
          </div>
        </div>
      `;
      newsElement.appendChild(blockNews);
      return;
    }

    // Erreur / format invalide
    if (!news || !Array.isArray(news)) {
      const blockNews = document.createElement("div");
      blockNews.classList.add("news-block");
      blockNews.innerHTML = `
        <div class="news-header">
          <img class="server-status-icon" src="assets/images/icon.png">
          <div class="header-text">
            <div class="title">Erreur</div>
          </div>
          <div class="date">
            <div class="day">1</div>
            <div class="month">Janvier</div>
          </div>
        </div>
        <div class="news-content">
          <div class="bbWrapper">
            <p>Impossible de contacter le serveur des news.<br>Merci de vérifier votre configuration.</p>
          </div>
        </div>
      `;
      newsElement.appendChild(blockNews);
      return;
    }

    // Render safe
    for (const News of news) {
      const publish = News?.publish_date ?? Date.now();
      const date = this.getdate(publish);

      const title = this.escapeHtml(News?.title ?? "Sans titre");
      const author = this.escapeHtml(News?.author ?? "Inconnu");
      const content = this.safeTextWithBreaks(News?.content ?? "");

      const blockNews = document.createElement("div");
      blockNews.classList.add("news-block");
      blockNews.innerHTML = `
        <div class="news-header">
          <img class="server-status-icon" src="assets/images/icon.png">
          <div class="header-text">
            <div class="title">${title}</div>
          </div>
          <div class="date">
            <div class="day">${this.escapeHtml(date.day)}</div>
            <div class="month">${this.escapeHtml(date.month)}</div>
          </div>
        </div>
        <div class="news-content">
          <div class="bbWrapper">
            <p>${content}</p>
            <p class="news-author">Auteur - <span>${author}</span></p>
          </div>
        </div>
      `;
      newsElement.appendChild(blockNews);
    }
  }

  /* =============================== SOCIALS ================================ */

  socialLick() {
    const socials = document.querySelectorAll(".social-block");
    socials.forEach((block) => {
      block.addEventListener("click", (e) => {
        const el = e.currentTarget || e.target.closest(".social-block");
        const url = el?.dataset?.url;

        if (!url) {
          console.warn("[SOCIAL] data-url vide sur .social-block", el);
          return;
        }
        shell.openExternal(url);
      });
    });
  }

  /* ========================== SKINVIEW3D (BUNDLE) ========================= */

  async initSkin3D() {
    if (!window.skinview3d) {
      console.warn("[SKIN3D] skinview3d.bundle.js non chargé");
      return;
    }

    const { SkinViewer, IdleAnimation } = window.skinview3d;

    const canvas = document.getElementById("skin3d");
    if (!canvas) return;

    // éviter le viewer en double
    try {
      this.skinViewer?.dispose?.();
    } catch {}
    this.skinViewer = null;

    const loadingEl =
      document.getElementById("skin3d-loading") || document.querySelector(".skin-loading");

    if (loadingEl) {
      loadingEl.style.display = "block";
      loadingEl.style.opacity = "1";
      loadingEl.textContent = "Chargement...";
    }

    this.skinViewer = new SkinViewer({
      canvas,
      width: 260,
      height: 380,
    });

    this.skinViewer.background = null;

    // Cadrage / centrage (ajuste si tu veux)
    this.skinViewer.fov = 45;
    this.skinViewer.zoom = 0.95;

    this.skinViewer.autoRotate = true;
    this.skinViewer.autoRotateSpeed = 0.8;
    this.skinViewer.animation = new IdleAnimation();

    // recadrage fin (monte/descend)
    this.skinViewer.camera.position.x = 0;
    this.skinViewer.camera.position.y = 16;
    this.skinViewer.camera.lookAt(0, 16, 0);

    // Charge skin
    const configClient = await this.ensureConfigClient();
    if (!configClient.account_selected) {
      if (loadingEl) loadingEl.textContent = "Aucun compte";
      return;
    }

    const auth = await this.readAccountByIdSafe(configClient.account_selected);
    const name = auth?.name || auth?.username || auth?.profile?.name || "Steve";
    const skinUrl = `https://minotar.net/skin/${encodeURIComponent(name)}`;

    try {
      await this.skinViewer.loadSkin(skinUrl);

      if (loadingEl) {
        loadingEl.style.opacity = "0";
        setTimeout(() => (loadingEl.style.display = "none"), 200);
      }
    } catch (e) {
      console.warn("[SKIN3D] loadSkin failed:", e);
      if (loadingEl) {
        loadingEl.style.opacity = "1";
        loadingEl.style.display = "block";
        loadingEl.textContent = "Impossible de charger le skin";
      }
    }
  }

  destroySkin3D() {
    try {
      if (this._skinResizeObs) {
        this._skinResizeObs.disconnect();
        this._skinResizeObs = null;
      }
      if (this.skinViewer) {
        this.skinViewer.dispose();
        this.skinViewer = null;
      }
    } catch {}
  }

  /* ============================ INSTANCES SELECT =========================== */

  async instancesSelect() {
    let configClient = await this.ensureConfigClient();

    // ✅ Si pas de compte, on stop (init() gère la redirection)
    if (!configClient.account_selected) return;

    let auth = await this.readAccountByIdSafe(configClient.account_selected);

    let instancesList = [];
    try {
      instancesList = await config.getInstanceList();
    } catch (e) {
      console.error("[INSTANCE] getInstanceList failed:", e);
      return;
    }

    let instanceSelect = instancesList.find((i) => i.name == configClient?.instance_selct)
      ? configClient?.instance_selct
      : null;

    let instanceBTN = document.querySelector(".play-instance");
    let instancePopup = document.querySelector(".instance-popup");
    let instancesListPopup = document.querySelector(".instances-List");
    let instanceCloseBTN = document.querySelector(".close-popup");

    if (!instanceBTN || !instancePopup || !instancesListPopup || !instanceCloseBTN) {
      console.warn("[INSTANCE] éléments UI manquants");
      return;
    }

    if (instancesList.length === 1) {
      const sel = document.querySelector(".instance-select");
      if (sel) sel.style.display = "none";
      instanceBTN.style.paddingRight = "0";
    }

    // Choix auto instance si vide
    if (!instanceSelect) {
      let newInstanceSelect = instancesList.find((i) => i.whitelistActive == false) ?? instancesList[0];
      configClient.instance_selct = newInstanceSelect?.name ?? null;
      instanceSelect = configClient.instance_selct;
      await this.db.updateData("configClient", configClient);
    }

    // Status + whitelist
    for (let instance of instancesList) {
      if (instance.whitelistActive) {
        const wlOk = Array.isArray(instance.whitelist) && instance.whitelist.includes(auth?.name);
        if (!wlOk && instance.name === instanceSelect) {
          let newInstanceSelect = instancesList.find((i) => i.whitelistActive == false) ?? instancesList[0];
          configClient.instance_selct = newInstanceSelect?.name ?? null;
          instanceSelect = configClient.instance_selct;
          setStatus(newInstanceSelect?.status ?? instance.status);
          await this.db.updateData("configClient", configClient);
        }
      }
      if (instance.name == instanceSelect) setStatus(instance.status);
    }

    // Click selection
    instancePopup.addEventListener("click", async (e) => {
      let configClient = await this.ensureConfigClient();

      if (e.target.classList.contains("instance-elements")) {
        let newInstanceSelect = e.target.id;

        let activeInstanceSelect = document.querySelector(".active-instance");
        if (activeInstanceSelect) activeInstanceSelect.classList.remove("active-instance");
        e.target.classList.add("active-instance");

        configClient.instance_selct = newInstanceSelect;
        await this.db.updateData("configClient", configClient);

        instancePopup.style.display = "none";

        const list = await config.getInstanceList();
        const options = list.find((i) => i.name == configClient.instance_selct);
        await setStatus(options?.status);

        // refresh skin
        this.initSkin3D().catch(() => {});
      }
    });

    instanceBTN.addEventListener("click", async (e) => {
      let configClient = await this.ensureConfigClient();
      if (!configClient.account_selected) return;

      let instanceSelect = configClient.instance_selct;
      let auth = await this.readAccountByIdSafe(configClient.account_selected);

      if (e.target.classList.contains("instance-select")) {
        instancesListPopup.innerHTML = "";

        for (let instance of instancesList) {
          const allowed =
            !instance.whitelistActive ||
            (Array.isArray(instance.whitelist) && instance.whitelist.includes(auth?.name));

          if (!allowed) continue;

          const active = instance.name == instanceSelect ? " active-instance" : "";
          instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements${active}">${instance.name}</div>`;
        }

        instancePopup.style.display = "flex";
        return;
      }

      if (!e.target.classList.contains("instance-select")) this.startGame();
    });

    instanceCloseBTN.addEventListener("click", () => (instancePopup.style.display = "none"));
  }

  /* ================================ LAUNCH ================================ */

  async startGame() {
    let launch = new Launch();
    let configClient = await this.ensureConfigClient();

    if (!configClient.account_selected) {
      const p = new popup();
      p.openPopup({
        title: "Erreur",
        content: "Aucun compte n'est connecté. Merci de vous connecter.",
        color: "red",
        options: true,
      });
      changePanel("login");
      return;
    }

    let instances = await config.getInstanceList();
    let authenticator = await this.readAccountByIdSafe(configClient.account_selected);
    let options = instances.find((i) => i.name == configClient.instance_selct);

    let playInstanceBTN = document.querySelector(".play-instance");
    let infoStartingBOX = document.querySelector(".info-starting-game");
    let infoStarting = document.querySelector(".info-starting-game-text");
    let progressBar = document.querySelector(".progress-bar");

    if (!options) {
      const p = new popup();
      p.openPopup({
        title: "Erreur",
        content: `Instance introuvable : "${configClient.instance_selct}"`,
        color: "red",
        options: true,
      });
      return;
    }

    const loaderCfg = options.loader ?? options.loadder;
    if (!loaderCfg) {
      const p = new popup();
      p.openPopup({
        title: "Erreur",
        content: `Configuration invalide : champ "loader" manquant (ou "loadder").`,
        color: "red",
        options: true,
      });
      return;
    }

    const minecraftVersion = loaderCfg.minecraft_version ?? loaderCfg.minecraftVersion;
    if (!minecraftVersion) {
      const p = new popup();
      p.openPopup({
        title: "Erreur",
        content: `Configuration invalide : "minecraft_version" manquant dans loader.`,
        color: "red",
        options: true,
      });
      return;
    }

    const loaderType = loaderCfg.loadder_type ?? loaderCfg.loader_type ?? loaderCfg.type ?? "none";
    const loaderBuild = loaderCfg.loadder_version ?? loaderCfg.loader_version ?? loaderCfg.build;

    const opt = {
      url: options.url,
      authenticator,
      timeout: 10000,
      path: `${await appdata()}/${process.platform == "darwin" ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
      instance: options.name,
      version: minecraftVersion,
      detached: configClient.launcher_config?.closeLauncher == "close-all" ? false : true,
      downloadFileMultiple: configClient.launcher_config?.download_multi ?? 10,
      intelEnabledMac: configClient.launcher_config?.intelEnabledMac ?? false,

      loader: {
        type: loaderType,
        build: loaderBuild,
        enable: loaderType == "none" ? false : true,
      },

      verify: options.verify,
      ignored: [...(options.ignored ?? [])],
      javaPath: configClient.java_config?.java_path ?? null,

      screen: {
        width: configClient.game_config?.screen_size?.width ?? 1280,
        height: configClient.game_config?.screen_size?.height ?? 720,
      },

      memory: {
        min: `${((configClient.java_config?.java_memory?.min ?? 2) * 1024)}M`,
        max: `${((configClient.java_config?.java_memory?.max ?? 4) * 1024)}M`,
      },
    };

    launch.Launch(opt);

    if (playInstanceBTN) playInstanceBTN.style.display = "none";
    if (infoStartingBOX) infoStartingBOX.style.display = "block";
    if (progressBar) progressBar.style.display = "";
    ipcRenderer.send("main-window-progress-load");

    launch.on("extract", (extract) => {
      ipcRenderer.send("main-window-progress-load");
      console.log(extract);
    });

    launch.on("progress", (progress, size) => {
      if (infoStarting) infoStarting.innerHTML = `Téléchargement ${((progress / size) * 100).toFixed(0)}%`;
      ipcRenderer.send("main-window-progress", { progress, size });
      if (progressBar) {
        progressBar.value = progress;
        progressBar.max = size;
      }
    });

    launch.on("check", (progress, size) => {
      if (infoStarting) infoStarting.innerHTML = `Vérification ${((progress / size) * 100).toFixed(0)}%`;
      ipcRenderer.send("main-window-progress", { progress, size });
      if (progressBar) {
        progressBar.value = progress;
        progressBar.max = size;
      }
    });

    launch.on("patch", (patch) => {
      console.log(patch);
      ipcRenderer.send("main-window-progress-load");
      if (infoStarting) infoStarting.innerHTML = `Patch en cours...`;
    });

    launch.on("data", (e) => {
      if (progressBar) progressBar.style.display = "none";
      if (configClient.launcher_config?.closeLauncher == "close-launcher") {
        ipcRenderer.send("main-window-hide");
      }
      new logger("Minecraft", "#36b030");
      ipcRenderer.send("main-window-progress-load");
      if (infoStarting) infoStarting.innerHTML = `Démarrage en cours...`;
      console.log(e);
    });

    launch.on("close", () => {
      if (configClient.launcher_config?.closeLauncher == "close-launcher") {
        ipcRenderer.send("main-window-show");
      }
      ipcRenderer.send("main-window-progress-reset");
      if (infoStartingBOX) infoStartingBOX.style.display = "none";
      if (playInstanceBTN) playInstanceBTN.style.display = "flex";
      if (infoStarting) infoStarting.innerHTML = `Vérification`;
      new logger(pkg.name, "#7289da");
    });

    launch.on("error", (err) => {
      let popupError = new popup();
      popupError.openPopup({
        title: "Erreur",
        content: err?.error ?? err?.message ?? JSON.stringify(err),
        color: "red",
        options: true,
      });

      if (configClient.launcher_config?.closeLauncher == "close-launcher") {
        ipcRenderer.send("main-window-show");
      }
      ipcRenderer.send("main-window-progress-reset");
      if (infoStartingBOX) infoStartingBOX.style.display = "none";
      if (playInstanceBTN) playInstanceBTN.style.display = "flex";
      if (infoStarting) infoStarting.innerHTML = `Vérification`;
      new logger(pkg.name, "#7289da");
      console.log(err);
    });
  }

  /* =============================== DATE UTILS ============================= */

  getdate(e) {
    const date = new Date(e);
    const year = date.getFullYear();
    const monthIndex = date.getMonth(); // 0..11
    const day = date.getDate();

    const allMonth = [
      "janvier",
      "février",
      "mars",
      "avril",
      "mai",
      "juin",
      "juillet",
      "août",
      "septembre",
      "octobre",
      "novembre",
      "décembre",
    ];

    return { year, month: allMonth[monthIndex], day };
  }
}

export default Home;
