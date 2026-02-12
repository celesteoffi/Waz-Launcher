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

    // News + socials + instance select
    await this.news();
    this.socialLick();
    await this.instancesSelect();

    // Skin 3D (bundle chargé via <script src="./js/libs/skinview3d.bundle.js">)
    this.initSkin3D().catch((e) => console.warn("[SKIN3D] init error:", e));

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

  safeContent(str) {
    // autorise uniquement le texte + retours ligne -> <br>
    return this.escapeHtml(str).replace(/\n/g, "<br>");
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

    // afficher "Chargement..." AU DÉBUT
    if (loadingEl) {
      loadingEl.style.display = "block";
      loadingEl.style.opacity = "1";
      loadingEl.textContent = "Chargement...";
    }

    // Crée viewer
    this.skinViewer = new SkinViewer({
      canvas,
      width: 260,
      height: 380,
    });

    this.skinViewer.background = null;
    this.skinViewer.fov = 45;
    this.skinViewer.zoom = 0.95;

    this.skinViewer.autoRotate = true;
    this.skinViewer.autoRotateSpeed = 0.8;
    this.skinViewer.animation = new IdleAnimation();

    // Cadrage fin
    this.skinViewer.camera.position.x = 0;
    this.skinViewer.camera.position.y = 16;
    this.skinViewer.camera.lookAt(0, 16, 0);

    // Charge skin (minotar)
    const configClient = await this.ensureConfigClient();
    const auth = await this.db.readData("accounts", configClient.account_selected);

    const name = auth?.name || "Steve";
    const skinUrl = `https://minotar.net/skin/${encodeURIComponent(name)}`;

    try {
      await this.skinViewer.loadSkin(skinUrl);

      // ✅ IMPORTANT : cacher "Chargement..." UNIQUEMENT si le skin est chargé
      if (loadingEl) {
        loadingEl.style.opacity = "0";
        setTimeout(() => {
          loadingEl.style.display = "none";
        }, 200);
      }
    } catch (e) {
      console.warn("[SKIN3D] loadSkin failed:", e);

      // si erreur, laisse un message (au lieu de rester sur "Chargement...")
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

  async resolveSkinUrlSafe() {
    const fallbackLocal = "assets/images/default-skin.png";

    const configClient = await this.ensureConfigClient();
    const auth = await this.db.readData("accounts", configClient.account_selected);

    const name = auth?.name || auth?.username || auth?.profile?.name || "Joueur";

    let uuid = auth?.uuid || auth?.profile?.id || auth?.profile?.uuid || null;
    if (uuid) uuid = String(uuid).replace(/-/g, "");

    if (uuid && uuid.length >= 32) {
      return { name, skinUrl: `https://crafatar.com/skins/${uuid}` };
    }

    if (name) {
      return { name, skinUrl: `https://minotar.net/skin/${encodeURIComponent(name)}` };
    }

    return { name, skinUrl: fallbackLocal };
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

    // Erreur serveur news
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

    // Render (SAFE)
    for (const News of news) {
      const date = this.getdate(News.publish_date);

      const title = this.escapeHtml(News.title ?? "Sans titre");
      const author = this.escapeHtml(News.author ?? "Inconnu");
      const content = this.safeContent(News.content ?? "");

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

  /* ============================= CONFIG CLIENT ============================ */

  async ensureConfigClient() {
    let configClient = await this.db.readData("configClient");
    configClient = configClient ?? {};

    configClient.launcher_config = configClient.launcher_config ?? {
      closeLauncher: "close-all", // close-all | close-launcher
      download_multi: 10,
      intelEnabledMac: false,
    };

    configClient.java_config = configClient.java_config ?? {
      java_path: null,
      java_memory: { min: 2, max: 4 },
    };
    configClient.java_config.java_memory = configClient.java_config.java_memory ?? { min: 2, max: 4 };
    configClient.java_config.java_memory.min = configClient.java_config.java_memory.min ?? 2;
    configClient.java_config.java_memory.max = configClient.java_config.java_memory.max ?? 4;

    configClient.game_config = configClient.game_config ?? {
      screen_size: { width: 1280, height: 720 },
    };
    configClient.game_config.screen_size = configClient.game_config.screen_size ?? { width: 1280, height: 720 };
    configClient.game_config.screen_size.width = configClient.game_config.screen_size.width ?? 1280;
    configClient.game_config.screen_size.height = configClient.game_config.screen_size.height ?? 720;

    if (configClient.instance_selct === undefined) configClient.instance_selct = null;

    try {
      await this.db.updateData("configClient", configClient);
    } catch {}

    return configClient;
  }

  /* ============================ INSTANCES SELECT =========================== */

  async instancesSelect() {
    let configClient = await this.ensureConfigClient();
    let auth = await this.db.readData("accounts", configClient.account_selected);
    let instancesList = await config.getInstanceList();

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

    if (!instanceSelect) {
      let newInstanceSelect = instancesList.find((i) => i.whitelistActive == false) ?? instancesList[0];
      configClient.instance_selct = newInstanceSelect?.name ?? null;
      instanceSelect = configClient.instance_selct;
      await this.db.updateData("configClient", configClient);
    }

    for (let instance of instancesList) {
      if (instance.whitelistActive) {
        let whitelist = instance.whitelist?.find((w) => w == auth?.name);
        if (whitelist !== auth?.name) {
          if (instance.name == instanceSelect) {
            let newInstanceSelect = instancesList.find((i) => i.whitelistActive == false) ?? instancesList[0];
            configClient.instance_selct = newInstanceSelect?.name ?? null;
            instanceSelect = configClient.instance_selct;
            setStatus(newInstanceSelect?.status ?? instance.status);
            await this.db.updateData("configClient", configClient);
          }
        }
      } else {
        console.log(`Initializing instance ${instance.name}...`);
      }
      if (instance.name == instanceSelect) setStatus(instance.status);
    }

    instancePopup.addEventListener("click", async (e) => {
      let configClient = await this.ensureConfigClient();

      if (e.target.classList.contains("instance-elements")) {
        let newInstanceSelect = e.target.id;
        let activeInstanceSelect = document.querySelector(".active-instance");

        if (activeInstanceSelect) activeInstanceSelect.classList.toggle("active-instance");
        e.target.classList.add("active-instance");

        configClient.instance_selct = newInstanceSelect;
        await this.db.updateData("configClient", configClient);

        instanceSelect = newInstanceSelect;

        instancePopup.style.display = "none";
        let instance = await config.getInstanceList();
        let options = instance.find((i) => i.name == configClient.instance_selct);
        await setStatus(options?.status);

        // refresh skin
        this.initSkin3D().catch(() => {});
      }
    });

    instanceBTN.addEventListener("click", async (e) => {
      let configClient = await this.ensureConfigClient();
      let instanceSelect = configClient.instance_selct;
      let auth = await this.db.readData("accounts", configClient.account_selected);

      if (e.target.classList.contains("instance-select")) {
        instancesListPopup.innerHTML = "";

        for (let instance of instancesList) {
          const isAllowed =
            !instance.whitelistActive ||
            (Array.isArray(instance.whitelist) && instance.whitelist.includes(auth?.name));

          if (!isAllowed) continue;

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
    let instances = await config.getInstanceList();
    let authenticator = await this.db.readData("accounts", configClient.account_selected);
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
      console.error("[LAUNCH] Instance introuvable, configClient=", configClient, "instances=", instances);
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
      console.error("[LAUNCH] options=", options);
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
      console.error("[LAUNCH] loaderCfg=", loaderCfg);
      return;
    }

    const loaderType = loaderCfg.loadder_type ?? loaderCfg.loader_type ?? loaderCfg.type ?? "none";
    const loaderBuild = loaderCfg.loadder_version ?? loaderCfg.loader_version ?? loaderCfg.build;

    let opt = {
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
      if (infoStarting) infoStarting.innerHTML = `Demarrage en cours...`;
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
      console.log("Close");
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
    let date = new Date(e);
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    let day = date.getDate();
    let allMonth = [
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
    return { year: year, month: allMonth[month - 1], day: day };
  }
}

export default Home;
