/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

class Home {
  static id = "home";

  async init(configArg) {
    this.config = configArg || this.config;
    this.db = new database();

    await this.news();
    this.socialLink();
    await this.instancesSelect();

    const settingsBtn = document.querySelector('.settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', () => changePanel('settings'));
  }

  async news() {
    const newsElement = document.querySelector('.news-list');
    if (!newsElement) return;

    let news = await config.getNews().then(res => res).catch(() => false);

    const makeBlock = (title, contentHtml) => {
      const blockNews = document.createElement('div');
      blockNews.classList.add('news-block');
      blockNews.innerHTML = `
        <div class="news-header">
          <img class="server-status-icon" src="assets/images/icon.png">
          <div class="header-text">
            <div class="title">${title}</div>
          </div>
          <div class="date">
            <div class="day">1</div>
            <div class="month">Janvier</div>
          </div>
        </div>
        <div class="news-content">
          <div class="bbWrapper">
            ${contentHtml}
          </div>
        </div>`;
      return blockNews;
    };

    if (!news) {
      newsElement.appendChild(
        makeBlock(
          "Erreur.",
          `<p>Impossible de contacter le serveur des news.<br>Merci de vérifier votre configuration.</p>`
        )
      );
      return;
    }

    if (!news.length) {
      newsElement.appendChild(
        makeBlock(
          "Aucune news n'est actuellement disponible.",
          `<p>Vous pourrez suivre ici toutes les news relatives au serveur.</p>`
        )
      );
      return;
    }

    for (const News of news) {
      const date = this.getdate(News.publish_date);
      const blockNews = document.createElement('div');
      blockNews.classList.add('news-block');
      blockNews.innerHTML = `
        <div class="news-header">
          <img class="server-status-icon" src="assets/images/icon.png">
          <div class="header-text">
            <div class="title">${News.title}</div>
          </div>
          <div class="date">
            <div class="day">${date.day}</div>
            <div class="month">${date.month}</div>
          </div>
        </div>
        <div class="news-content">
          <div class="bbWrapper">
            <p>${String(News.content || "").replace(/\n/g, '<br>')}</p>
            <p class="news-author">Auteur - <span>${News.author || "Inconnu"}</span></p>
          </div>
        </div>`;
      newsElement.appendChild(blockNews);
    }
  }

  // ✅ fix: currentTarget au lieu de target (sinon dataset.url peut être undefined)
  socialLink() {
    const socials = document.querySelectorAll('.social-block');
    socials.forEach(social => {
      social.addEventListener('click', (e) => {
        const url = e.currentTarget?.dataset?.url;
        if (url) shell.openExternal(url);
      });
    });
  }

  async instancesSelect() {
    const configClient = await this.db.readData('configClient').catch(() => null);
    const instancesList = await config.getInstanceList().catch(() => []);
    if (!configClient || !Array.isArray(instancesList) || !instancesList.length) return;

    const auth = await this.db.readData('accounts', configClient.account_selected).catch(() => null);

    // ⚠️ ton champ est "instance_selct" (typo), on reste compatible
    let instanceSelectName = instancesList.find(i => i.name === configClient?.instance_selct)
      ? configClient.instance_selct
      : null;

    const instanceBTN = document.querySelector('.play-instance');
    const instancePopup = document.querySelector('.instance-popup');
    const instancesListPopup = document.querySelector('.instances-List');
    const instanceCloseBTN = document.querySelector('.close-popup');

    if (!instanceBTN || !instancePopup || !instancesListPopup || !instanceCloseBTN) return;

    // UI: si 1 seule instance
    if (instancesList.length === 1) {
      const sel = document.querySelector('.instance-select');
      if (sel) sel.style.display = 'none';
      instanceBTN.style.paddingRight = '0';
    }

    // Helpers access
    const isAllowed = (inst) => {
      if (!inst?.whitelistActive) return true;
      const wl = Array.isArray(inst.whitelist) ? inst.whitelist : [];
      return auth?.name ? wl.includes(auth.name) : false;
    };

    const firstAllowed = instancesList.find(isAllowed);
    const firstNonWhitelist = instancesList.find(i => i && i.whitelistActive === false);

    // ✅ instance par défaut robuste (évite crash si pas de non-whitelist)
    if (!instanceSelectName) {
      const pick = firstNonWhitelist || firstAllowed || instancesList[0];
      instanceSelectName = pick?.name;

      const cfg = await this.db.readData('configClient').catch(() => null);
      if (cfg && instanceSelectName) {
        cfg.instance_selct = instanceSelectName;
        await this.db.updateData('configClient', cfg);
      }
    }

    // ✅ si l’instance sélectionnée n’est plus autorisée => fallback
    const selectedInst = instancesList.find(i => i.name === instanceSelectName);
    if (selectedInst && !isAllowed(selectedInst)) {
      const pick = firstNonWhitelist || firstAllowed || instancesList[0];
      instanceSelectName = pick?.name;

      const cfg = await this.db.readData('configClient').catch(() => null);
      if (cfg && instanceSelectName) {
        cfg.instance_selct = instanceSelectName;
        await this.db.updateData('configClient', cfg);
      }
    }

    // setStatus initial
    const selectedNow = instancesList.find(i => i.name === instanceSelectName);
    if (selectedNow?.status) setStatus(selectedNow.status);

    // Click dans popup (⚠️ remonte au parent .instance-elements)
    instancePopup.addEventListener('click', async (e) => {
      const el = e.target?.closest?.('.instance-elements');
      if (!el) return;

      const newInstanceSelect = el.id;
      if (!newInstanceSelect) return;

      const cfg = await this.db.readData('configClient').catch(() => null);
      if (!cfg) return;

      const active = document.querySelector('.active-instance');
      if (active) active.classList.remove('active-instance');
      el.classList.add('active-instance');

      cfg.instance_selct = newInstanceSelect;
      await this.db.updateData('configClient', cfg);

      instanceSelectName = newInstanceSelect;
      instancePopup.style.display = 'none';

      const list2 = await config.getInstanceList().catch(() => []);
      const opt = list2.find(i => i.name === newInstanceSelect);
      if (opt?.status) await setStatus(opt.status);
    });

    // Open popup / start game
    instanceBTN.addEventListener('click', async (e) => {
      const cfg = await this.db.readData('configClient').catch(() => null);
      if (!cfg) return;

      const selected = cfg.instance_selct;
      const auth2 = await this.db.readData('accounts', cfg.account_selected).catch(() => null);

      if (e.target?.classList?.contains('instance-select')) {
        instancesListPopup.innerHTML = '';

        for (const inst of instancesList) {
          if (!isAllowed(inst)) continue;

          const active = inst.name === selected ? ' active-instance' : '';
          instancesListPopup.innerHTML += `<div id="${inst.name}" class="instance-elements${active}">${inst.name}</div>`;
        }

        instancePopup.style.display = 'flex';
        return;
      }

      // click ailleurs => start
      if (!e.target?.classList?.contains('instance-select')) {
        this.startGame();
      }
    });

    instanceCloseBTN.addEventListener('click', () => {
      instancePopup.style.display = 'none';
    });
  }

  async startGame() {
    const launch = new Launch();
    const configClient = await this.db.readData('configClient').catch(() => null);
    if (!configClient) return;

    const instances = await config.getInstanceList().catch(() => []);
    const authenticator = await this.db.readData('accounts', configClient.account_selected).catch(() => null);

    const options = instances.find(i => i.name === configClient.instance_selct);
    if (!options) {
      const popupError = new popup();
      popupError.openPopup({
        title: 'Erreur',
        content: `Instance introuvable : ${configClient.instance_selct}`,
        color: 'red',
        options: true
      });
      return;
    }

    const playInstanceBTN = document.querySelector('.play-instance');
    const infoStartingBOX = document.querySelector('.info-starting-game');
    const infoStarting = document.querySelector(".info-starting-game-text");
    const progressBar = document.querySelector('.progress-bar');

    const opt = {
      url: options.url,
      authenticator,
      timeout: 10000,
      path: `${await appdata()}/${process.platform === 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
      instance: options.name,
      version: options.loadder.minecraft_version,
      detached: configClient.launcher_config.closeLauncher === "close-all" ? false : true,
      downloadFileMultiple: configClient.launcher_config.download_multi,
      intelEnabledMac: configClient.launcher_config.intelEnabledMac,

      loader: {
        type: options.loadder.loadder_type,
        build: options.loadder.loadder_version,
        enable: options.loadder.loadder_type === 'none' ? false : true
      },

      verify: options.verify,
      ignored: [...(options.ignored || [])],
      javaPath: configClient.java_config.java_path,

      screen: {
        width: configClient.game_config.screen_size.width,
        height: configClient.game_config.screen_size.height
      },

      memory: {
        min: `${configClient.java_config.java_memory.min * 1024}M`,
        max: `${configClient.java_config.java_memory.max * 1024}M`
      }
    };

    launch.Launch(opt);

    if (playInstanceBTN) playInstanceBTN.style.display = "none";
    if (infoStartingBOX) infoStartingBOX.style.display = "block";
    if (progressBar) progressBar.style.display = "";
    ipcRenderer.send('main-window-progress-load');

    launch.on('progress', (progress, size) => {
      if (infoStarting) infoStarting.innerHTML = `Téléchargement ${((progress / size) * 100).toFixed(0)}%`;
      ipcRenderer.send('main-window-progress', { progress, size });
      if (progressBar) {
        progressBar.value = progress;
        progressBar.max = size;
      }
    });

    launch.on('check', (progress, size) => {
      if (infoStarting) infoStarting.innerHTML = `Vérification ${((progress / size) * 100).toFixed(0)}%`;
      ipcRenderer.send('main-window-progress', { progress, size });
      if (progressBar) {
        progressBar.value = progress;
        progressBar.max = size;
      }
    });

    launch.on('patch', () => {
      ipcRenderer.send('main-window-progress-load');
      if (infoStarting) infoStarting.innerHTML = `Patch en cours...`;
    });

    launch.on('data', () => {
      if (progressBar) progressBar.style.display = "none";
      if (configClient.launcher_config.closeLauncher === 'close-launcher') {
        ipcRenderer.send("main-window-hide");
      }
      new logger('Minecraft', '#36b030');
      ipcRenderer.send('main-window-progress-load');
      if (infoStarting) infoStarting.innerHTML = `Démarrage en cours...`;
    });

    launch.on('close', () => {
      if (configClient.launcher_config.closeLauncher === 'close-launcher') {
        ipcRenderer.send("main-window-show");
      }
      ipcRenderer.send('main-window-progress-reset');
      if (infoStartingBOX) infoStartingBOX.style.display = "none";
      if (playInstanceBTN) playInstanceBTN.style.display = "flex";
      if (infoStarting) infoStarting.innerHTML = `Vérification`;
      new logger(pkg.name, '#7289da');
    });

    launch.on('error', (err) => {
      const popupError = new popup();
      popupError.openPopup({
        title: 'Erreur',
        content: err?.error || err?.message || String(err),
        color: 'red',
        options: true
      });

      if (configClient.launcher_config.closeLauncher === 'close-launcher') {
        ipcRenderer.send("main-window-show");
      }
      ipcRenderer.send('main-window-progress-reset');
      if (infoStartingBOX) infoStartingBOX.style.display = "none";
      if (playInstanceBTN) playInstanceBTN.style.display = "flex";
      if (infoStarting) infoStarting.innerHTML = `Vérification`;
      new logger(pkg.name, '#7289da');
      console.log(err);
    });
  }

  getdate(e) {
    const date = new Date(e);
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11
    const day = date.getDate();
    const allMonth = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return { year, month: allMonth[month] || "janvier", day };
  }
}

export default Home;
