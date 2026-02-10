/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js'
import { rpcSet } from "../utils/discordRpc.js";

rpcSet({
  details: "In the launcher",
  state: "Home",
  largeImageKey: "logo",
  largeImageText: "Launcher",
});


const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

class Home {
  static id = "home";

  async init(config) {
    this.config = config;
    this.db = new database();
    this.news()
    this.socialLick()
    this.instancesSelect()
    document.querySelector('.settings-btn').addEventListener('click', e => changePanel('settings'))
  }

  async news() {
    let newsElement = document.querySelector('.news-list');
    let news = await config.getNews().then(res => res).catch(err => false);
    if (news) {
      if (!news.length) {
        let blockNews = document.createElement('div');
        blockNews.classList.add('news-block');
        blockNews.innerHTML = `
          <div class="news-header">
            <img class="server-status-icon" src="assets/images/icon.png">
            <div class="header-text">
              <div class="title">Aucun news n'ai actuellement disponible.</div>
            </div>
            <div class="date">
              <div class="day">1</div>
              <div class="month">Janvier</div>
            </div>
          </div>
          <div class="news-content">
            <div class="bbWrapper">
              <p>Vous pourrez suivre ici toutes les news relative au serveur.</p>
            </div>
          </div>`
        newsElement.appendChild(blockNews);
      } else {
        for (let News of news) {
          let date = this.getdate(News.publish_date)
          let blockNews = document.createElement('div');
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
                <p>${(News.content ?? '').replace(/\n/g, '</br>')}</p>
                <p class="news-author">Auteur - <span>${News.author ?? 'Inconnu'}</span></p>
              </div>
            </div>`
          newsElement.appendChild(blockNews);
        }
      }
    } else {
      let blockNews = document.createElement('div');
      blockNews.classList.add('news-block');
      blockNews.innerHTML = `
        <div class="news-header">
          <img class="server-status-icon" src="assets/images/icon.png">
          <div class="header-text">
            <div class="title">Error.</div>
          </div>
          <div class="date">
            <div class="day">1</div>
            <div class="month">Janvier</div>
          </div>
        </div>
        <div class="news-content">
          <div class="bbWrapper">
            <p>Impossible de contacter le serveur des news.</br>Merci de vérifier votre configuration.</p>
          </div>
        </div>`
      newsElement.appendChild(blockNews);
    }
  }

socialLick() {
  const socials = document.querySelectorAll('.social-block');

  socials.forEach(block => {
    block.addEventListener('click', (e) => {
      // ✅ Toujours récupérer l'élément .social-block même si on clique sur l'icône dedans
      const el = e.currentTarget || e.target.closest('.social-block');
      const url = el?.dataset?.url;

      if (!url) {
        console.warn('[SOCIAL] data-url vide sur .social-block', el);
        return;
      }
      shell.openExternal(url);
    });
  });
}

  async ensureConfigClient() {
    let configClient = await this.db.readData('configClient')
    configClient = configClient ?? {}

    configClient.launcher_config = configClient.launcher_config ?? {
      closeLauncher: "close-all", // close-all | close-launcher
      download_multi: 10,
      intelEnabledMac: false
    }

    configClient.java_config = configClient.java_config ?? {
      java_path: null,
      java_memory: { min: 2, max: 4 }
    }
    configClient.java_config.java_memory = configClient.java_config.java_memory ?? { min: 2, max: 4 }
    configClient.java_config.java_memory.min = configClient.java_config.java_memory.min ?? 2
    configClient.java_config.java_memory.max = configClient.java_config.java_memory.max ?? 4

    configClient.game_config = configClient.game_config ?? {
      screen_size: { width: 1280, height: 720 }
    }
    configClient.game_config.screen_size = configClient.game_config.screen_size ?? { width: 1280, height: 720 }
    configClient.game_config.screen_size.width = configClient.game_config.screen_size.width ?? 1280
    configClient.game_config.screen_size.height = configClient.game_config.screen_size.height ?? 720

    // instance selection field
    if (configClient.instance_selct === undefined) configClient.instance_selct = null

    // (Optionnel) sauver en DB si le schema était incomplet
    try { await this.db.updateData('configClient', configClient) } catch (e) { /* ignore */ }

    return configClient
  }

  async instancesSelect() {
    let configClient = await this.ensureConfigClient()
    let auth = await this.db.readData('accounts', configClient.account_selected)
    let instancesList = await config.getInstanceList()
    let instanceSelect = instancesList.find(i => i.name == configClient?.instance_selct) ? configClient?.instance_selct : null

    let instanceBTN = document.querySelector('.play-instance')
    let instancePopup = document.querySelector('.instance-popup')
    let instancesListPopup = document.querySelector('.instances-List')
    let instanceCloseBTN = document.querySelector('.close-popup')

    if (instancesList.length === 1) {
      document.querySelector('.instance-select').style.display = 'none'
      instanceBTN.style.paddingRight = '0'
    }

    if (!instanceSelect) {
      let newInstanceSelect = instancesList.find(i => i.whitelistActive == false) ?? instancesList[0]
      let configClient = await this.ensureConfigClient()
      configClient.instance_selct = newInstanceSelect?.name ?? null
      instanceSelect = configClient.instance_selct
      await this.db.updateData('configClient', configClient)
    }

    for (let instance of instancesList) {
      if (instance.whitelistActive) {
        let whitelist = instance.whitelist?.find(whitelist => whitelist == auth?.name)
        if (whitelist !== auth?.name) {
          if (instance.name == instanceSelect) {
            let newInstanceSelect = instancesList.find(i => i.whitelistActive == false) ?? instancesList[0]
            let configClient = await this.ensureConfigClient()
            configClient.instance_selct = newInstanceSelect?.name ?? null
            instanceSelect = configClient.instance_selct
            setStatus(newInstanceSelect?.status ?? instance.status)
            await this.db.updateData('configClient', configClient)
          }
        }
      } else {
        console.log(`Initializing instance ${instance.name}...`)
      }
      if (instance.name == instanceSelect) setStatus(instance.status)
    }

    instancePopup.addEventListener('click', async e => {
      let configClient = await this.ensureConfigClient()

      if (e.target.classList.contains('instance-elements')) {
        let newInstanceSelect = e.target.id
        let activeInstanceSelect = document.querySelector('.active-instance')

        if (activeInstanceSelect) activeInstanceSelect.classList.toggle('active-instance');
        e.target.classList.add('active-instance');

        configClient.instance_selct = newInstanceSelect
        await this.db.updateData('configClient', configClient)

        // ✅ FIX: ne pas mettre un tableau
        instanceSelect = newInstanceSelect

        instancePopup.style.display = 'none'
        let instance = await config.getInstanceList()
        let options = instance.find(i => i.name == configClient.instance_selct)
        await setStatus(options?.status)
      }
    })

    instanceBTN.addEventListener('click', async e => {
      let configClient = await this.ensureConfigClient()
      let instanceSelect = configClient.instance_selct
      let auth = await this.db.readData('accounts', configClient.account_selected)

      if (e.target.classList.contains('instance-select')) {
        instancesListPopup.innerHTML = ''
        for (let instance of instancesList) {
          if (instance.whitelistActive) {
            instance.whitelist?.map(whitelist => {
              if (whitelist == auth?.name) {
                if (instance.name == instanceSelect) {
                  instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements active-instance">${instance.name}</div>`
                } else {
                  instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements">${instance.name}</div>`
                }
              }
            })
          } else {
            if (instance.name == instanceSelect) {
              instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements active-instance">${instance.name}</div>`
            } else {
              instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements">${instance.name}</div>`
            }
          }
        }

        instancePopup.style.display = 'flex'
      }

      if (!e.target.classList.contains('instance-select')) this.startGame()
    })

    instanceCloseBTN.addEventListener('click', () => instancePopup.style.display = 'none')
  }

  async startGame() {
    let launch = new Launch()
    let configClient = await this.ensureConfigClient()
    let instances = await config.getInstanceList()
    let authenticator = await this.db.readData('accounts', configClient.account_selected)
    let options = instances.find(i => i.name == configClient.instance_selct)

    let playInstanceBTN = document.querySelector('.play-instance')
    let infoStartingBOX = document.querySelector('.info-starting-game')
    let infoStarting = document.querySelector(".info-starting-game-text")
    let progressBar = document.querySelector('.progress-bar')

    // ✅ Anti-crash: instance introuvable
    if (!options) {
      const p = new popup()
      p.openPopup({
        title: 'Erreur',
        content: `Instance introuvable : "${configClient.instance_selct}"`,
        color: 'red',
        options: true
      })
      console.error('[LAUNCH] Instance introuvable, configClient=', configClient, 'instances=', instances)
      return
    }

    // ✅ Compat: "loader" OU "loadder" (typo fréquente)
    const loaderCfg = options.loader ?? options.loadder

    if (!loaderCfg) {
      const p = new popup()
      p.openPopup({
        title: 'Erreur',
        content: `Configuration invalide : champ "loader" manquant (ou "loadder").`,
        color: 'red',
        options: true
      })
      console.error('[LAUNCH] options=', options)
      return
    }

    const minecraftVersion = loaderCfg.minecraft_version ?? loaderCfg.minecraftVersion
    if (!minecraftVersion) {
      const p = new popup()
      p.openPopup({
        title: 'Erreur',
        content: `Configuration invalide : "minecraft_version" manquant dans loader.`,
        color: 'red',
        options: true
      })
      console.error('[LAUNCH] loaderCfg=', loaderCfg)
      return
    }

    const loaderType = loaderCfg.loadder_type ?? loaderCfg.loader_type ?? loaderCfg.type ?? 'none'
    const loaderBuild = loaderCfg.loadder_version ?? loaderCfg.loader_version ?? loaderCfg.build

    let opt = {
      url: options.url,
      authenticator,
      timeout: 10000,
      path: `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
      instance: options.name,
      version: minecraftVersion,
      detached: configClient.launcher_config?.closeLauncher == "close-all" ? false : true,
      downloadFileMultiple: configClient.launcher_config?.download_multi ?? 10,
      intelEnabledMac: configClient.launcher_config?.intelEnabledMac ?? false,

      loader: {
        type: loaderType,
        build: loaderBuild,
        enable: loaderType == 'none' ? false : true
      },

      verify: options.verify,
      ignored: [...(options.ignored ?? [])],
      javaPath: configClient.java_config?.java_path ?? null,

      screen: {
        width: configClient.game_config?.screen_size?.width ?? 1280,
        height: configClient.game_config?.screen_size?.height ?? 720
      },

      memory: {
        min: `${((configClient.java_config?.java_memory?.min ?? 2) * 1024)}M`,
        max: `${((configClient.java_config?.java_memory?.max ?? 4) * 1024)}M`
      }
    }

    launch.Launch(opt);

    playInstanceBTN.style.display = "none"
    infoStartingBOX.style.display = "block"
    progressBar.style.display = "";
    ipcRenderer.send('main-window-progress-load')

    launch.on('extract', extract => {
      ipcRenderer.send('main-window-progress-load')
      console.log(extract);
    });

    launch.on('progress', (progress, size) => {
      infoStarting.innerHTML = `Téléchargement ${((progress / size) * 100).toFixed(0)}%`
      ipcRenderer.send('main-window-progress', { progress, size })
      progressBar.value = progress;
      progressBar.max = size;
    });

    launch.on('check', (progress, size) => {
      infoStarting.innerHTML = `Vérification ${((progress / size) * 100).toFixed(0)}%`
      ipcRenderer.send('main-window-progress', { progress, size })
      progressBar.value = progress;
      progressBar.max = size;
    });

    launch.on('estimated', (time) => {
      let hours = Math.floor(time / 3600);
      let minutes = Math.floor((time - hours * 3600) / 60);
      let seconds = Math.floor(time - hours * 3600 - minutes * 60);
      console.log(`${hours}h ${minutes}m ${seconds}s`);
    })

    launch.on('speed', (speed) => {
      console.log(`${(speed / 1067008).toFixed(2)} Mb/s`)
    })

    launch.on('patch', patch => {
      console.log(patch);
      ipcRenderer.send('main-window-progress-load')
      infoStarting.innerHTML = `Patch en cours...`
    });

    launch.on('data', (e) => {
      progressBar.style.display = "none"
      if (configClient.launcher_config?.closeLauncher == 'close-launcher') {
        ipcRenderer.send("main-window-hide")
      };
      new logger('Minecraft', '#36b030');
      ipcRenderer.send('main-window-progress-load')
      infoStarting.innerHTML = `Demarrage en cours...`
      console.log(e);
    })

    launch.on('close', code => {
      if (configClient.launcher_config?.closeLauncher == 'close-launcher') {
        ipcRenderer.send("main-window-show")
      };
      ipcRenderer.send('main-window-progress-reset')
      infoStartingBOX.style.display = "none"
      playInstanceBTN.style.display = "flex"
      infoStarting.innerHTML = `Vérification`
      new logger(pkg.name, '#7289da');
      console.log('Close');
    });

    launch.on('error', err => {
      let popupError = new popup()

      popupError.openPopup({
        title: 'Erreur',
        content: err?.error ?? err?.message ?? JSON.stringify(err),
        color: 'red',
        options: true
      })

      if (configClient.launcher_config?.closeLauncher == 'close-launcher') {
        ipcRenderer.send("main-window-show")
      };
      ipcRenderer.send('main-window-progress-reset')
      infoStartingBOX.style.display = "none"
      playInstanceBTN.style.display = "flex"
      infoStarting.innerHTML = `Vérification`
      new logger(pkg.name, '#7289da');
      console.log(err);
    });
  }

  getdate(e) {
    let date = new Date(e)
    let year = date.getFullYear()
    let month = date.getMonth() + 1
    let day = date.getDate()
    let allMonth = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
    return { year: year, month: allMonth[month - 1], day: day }
  }
}

export default Home;
