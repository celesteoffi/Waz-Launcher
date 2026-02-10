/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground } from '../utils.js'
import { rpcSet } from "../utils/discordRpc.js";

rpcSet({
  details: "In the launcher",
  state: "Settings",
  largeImageKey: "logo",
  largeImageText: "Launcher",
});

const { ipcRenderer } = require('electron');
const os = require('os');

class Settings {
  static id = "settings";

  async init(config) {
    this.config = config;
    this.db = new database();

    // ✅ Important : on s'assure que configClient a un schema complet dès l'entrée settings
    await this.ensureConfigClient();

    this.navBTN()
    this.accounts()
    this.ram()
    this.javaPath()
    this.resolution()
    this.launcher()
  }

  // ✅ Assure un schema DB complet et évite tous les "Cannot set properties of undefined"
  async ensureConfigClient() {
    let c = await this.db.readData('configClient')
    c = c ?? {}

    c.launcher_config = c.launcher_config ?? {
      closeLauncher: "close-launcher", // close-launcher | close-all | close-none
      download_multi: 5,
      intelEnabledMac: false,
      theme: "auto"
    }

    c.java_config = c.java_config ?? {
      java_path: null,
      java_memory: { min: 2, max: 4 }
    }
    c.java_config.java_memory = c.java_config.java_memory ?? { min: 2, max: 4 }
    c.java_config.java_memory.min = Number(c.java_config.java_memory.min ?? 2)
    c.java_config.java_memory.max = Number(c.java_config.java_memory.max ?? 4)

    c.game_config = c.game_config ?? {
      screen_size: { width: 1920, height: 1080 }
    }
    c.game_config.screen_size = c.game_config.screen_size ?? { width: 1920, height: 1080 }
    c.game_config.screen_size.width = Number(c.game_config.screen_size.width ?? 1920)
    c.game_config.screen_size.height = Number(c.game_config.screen_size.height ?? 1080)

    if (c.instance_selct === undefined) c.instance_selct = null
    if (c.account_selected === undefined) c.account_selected = null

    // sauvegarde si besoin (si ton DB.updateData accepte ce format)
    try { await this.db.updateData('configClient', c) } catch (_) {}

    return c
  }

  navBTN() {
    document.querySelector('.nav-box').addEventListener('click', e => {
      if (e.target.classList.contains('nav-settings-btn')) {
        let id = e.target.id

        let activeSettingsBTN = document.querySelector('.active-settings-BTN')
        let activeContainerSettings = document.querySelector('.active-container-settings')

        if (id == 'save') {
          if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
          document.querySelector('#account').classList.add('active-settings-BTN');

          if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
          document.querySelector(`#account-tab`).classList.add('active-container-settings');
          return changePanel('home')
        }

        if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
        e.target.classList.add('active-settings-BTN');

        if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
        document.querySelector(`#${id}-tab`).classList.add('active-container-settings');
      }
    })
  }

  accounts() {
    document.querySelector('.accounts-list').addEventListener('click', async e => {
      let popupAccount = new popup()
      try {
        let id = e.target.id
        if (e.target.classList.contains('account')) {
          popupAccount.openPopup({
            title: 'Connexion',
            content: 'Veuillez patienter...',
            color: 'var(--color)'
          })

          if (id == 'add') {
            document.querySelector('.cancel-home').style.display = 'inline'
            return changePanel('login')
          }

          let account = await this.db.readData('accounts', id);
          let configClient = await this.setInstance(account);
          await accountSelect(account);
          configClient.account_selected = account.ID;
          return await this.db.updateData('configClient', configClient);
        }

        if (e.target.classList.contains("delete-profile")) {
          popupAccount.openPopup({
            title: 'Connexion',
            content: 'Veuillez patienter...',
            color: 'var(--color)'
          })
          await this.db.deleteData('accounts', id);
          let deleteProfile = document.getElementById(`${id}`);
          let accountListElement = document.querySelector('.accounts-list');
          accountListElement.removeChild(deleteProfile);

          if (accountListElement.children.length == 1) return changePanel('login');

          let configClient = await this.db.readData('configClient');

          if (configClient.account_selected == id) {
            let allAccounts = await this.db.readAllData('accounts');
            configClient.account_selected = allAccounts[0].ID
            accountSelect(allAccounts[0]);
            let newInstanceSelect = await this.setInstance(allAccounts[0]);
            configClient.instance_selct = newInstanceSelect.instance_selct
            return await this.db.updateData('configClient', configClient);
          }
        }
      } catch (err) {
        console.error(err)
      } finally {
        popupAccount.closePopup();
      }
    })
  }

  async setInstance(auth) {
    let configClient = await this.ensureConfigClient()
    let instanceSelect = configClient.instance_selct
    let instancesList = await config.getInstanceList()

    for (let instance of instancesList) {
      if (instance.whitelistActive) {
        let whitelist = instance.whitelist?.find(whitelist => whitelist == auth.name)
        if (whitelist !== auth.name) {
          if (instance.name == instanceSelect) {
            let newInstanceSelect = instancesList.find(i => i.whitelistActive == false) ?? instancesList[0]
            configClient.instance_selct = newInstanceSelect?.name ?? null
            await setStatus(newInstanceSelect?.status)
          }
        }
      }
    }
    return configClient
  }

  async ram() {
    let configClient = await this.ensureConfigClient()

    let totalMem = Math.trunc(os.totalmem() / 1073741824 * 10) / 10;
    let freeMem = Math.trunc(os.freemem() / 1073741824 * 10) / 10;

    document.getElementById("total-ram").textContent = `${totalMem} Go`;
    document.getElementById("free-ram").textContent = `${freeMem} Go`;

    let sliderDiv = document.querySelector(".memory-slider");
    sliderDiv.setAttribute("max", Math.trunc((80 * totalMem) / 100));

    let ram = configClient?.java_config?.java_memory ? {
      ramMin: Number(configClient.java_config.java_memory.min),
      ramMax: Number(configClient.java_config.java_memory.max)
    } : { ramMin: 2, ramMax: 4 };

    // ✅ clamp
    if (totalMem < ram.ramMin) ram.ramMin = 1;
    if (ram.ramMax < ram.ramMin) ram.ramMax = ram.ramMin + 1;
    if (ram.ramMax > Math.trunc((80 * totalMem) / 100)) ram.ramMax = Math.trunc((80 * totalMem) / 100);

    // ✅ on persiste si on a corrigé
    configClient.java_config = configClient.java_config ?? {}
    configClient.java_config.java_memory = { min: ram.ramMin, max: ram.ramMax }
    await this.db.updateData('configClient', configClient);

    let slider = new Slider(".memory-slider", parseFloat(ram.ramMin), parseFloat(ram.ramMax));

    let minSpan = document.querySelector(".slider-touch-left span");
    let maxSpan = document.querySelector(".slider-touch-right span");

    minSpan.setAttribute("value", `${ram.ramMin} Go`);
    maxSpan.setAttribute("value", `${ram.ramMax} Go`);

    slider.on("change", async (min, max) => {
      let configClient = await this.ensureConfigClient()
      minSpan.setAttribute("value", `${min} Go`);
      maxSpan.setAttribute("value", `${max} Go`);

      configClient.java_config = configClient.java_config ?? {}
      configClient.java_config.java_memory = { min: Number(min), max: Number(max) }

      await this.db.updateData('configClient', configClient);
    });
  }

  async javaPath() {
    let javaPathText = document.querySelector(".java-path-txt")
    javaPathText.textContent = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/runtime`;

    let configClient = await this.ensureConfigClient()
    let javaPath = configClient?.java_config?.java_path || 'Utiliser la version de java livre avec le launcher';
    let javaPathInputTxt = document.querySelector(".java-path-input-text");
    let javaPathInputFile = document.querySelector(".java-path-input-file");
    javaPathInputTxt.value = javaPath;

    document.querySelector(".java-path-set").addEventListener("click", async () => {
      javaPathInputFile.value = '';
      javaPathInputFile.click();
      await new Promise((resolve) => {
        let interval;
        interval = setInterval(() => {
          if (javaPathInputFile.value != '') resolve(clearInterval(interval));
        }, 100);
      });

      if (javaPathInputFile.value.replace(".exe", '').endsWith("java") || javaPathInputFile.value.replace(".exe", '').endsWith("javaw")) {
        let configClient = await this.ensureConfigClient()
        let file = javaPathInputFile.files[0].path;
        javaPathInputTxt.value = file;

        configClient.java_config = configClient.java_config ?? {}
        configClient.java_config.java_path = file

        await this.db.updateData('configClient', configClient);
      } else alert("Le nom du fichier doit être java ou javaw");
    });

    document.querySelector(".java-path-reset").addEventListener("click", async () => {
      let configClient = await this.ensureConfigClient()
      javaPathInputTxt.value = 'Utiliser la version de java livre avec le launcher';

      configClient.java_config = configClient.java_config ?? {}
      configClient.java_config.java_path = null

      await this.db.updateData('configClient', configClient);
    });
  }

  async resolution() {
    let configClient = await this.ensureConfigClient()
    let resolution = configClient?.game_config?.screen_size || { width: 1920, height: 1080 };

    let width = document.querySelector(".width-size");
    let height = document.querySelector(".height-size");
    let resolutionReset = document.querySelector(".size-reset");

    width.value = resolution.width;
    height.value = resolution.height;

    width.addEventListener("change", async () => {
      let configClient = await this.ensureConfigClient()
      configClient.game_config = configClient.game_config ?? {}
      configClient.game_config.screen_size = configClient.game_config.screen_size ?? {}

      configClient.game_config.screen_size.width = Number(width.value);
      await this.db.updateData('configClient', configClient);
    })

    height.addEventListener("change", async () => {
      let configClient = await this.ensureConfigClient()
      configClient.game_config = configClient.game_config ?? {}
      configClient.game_config.screen_size = configClient.game_config.screen_size ?? {}

      configClient.game_config.screen_size.height = Number(height.value);
      await this.db.updateData('configClient', configClient);
    })

    resolutionReset.addEventListener("click", async () => {
      let configClient = await this.ensureConfigClient()
      configClient.game_config = configClient.game_config ?? {}
      configClient.game_config.screen_size = { width: 854, height: 480 };

      width.value = 854;
      height.value = 480;

      await this.db.updateData('configClient', configClient);
    })
  }

  async launcher() {
    let configClient = await this.ensureConfigClient()

    let maxDownloadFiles = Number(configClient?.launcher_config?.download_multi ?? 5);
    let maxDownloadFilesInput = document.querySelector(".max-files");
    let maxDownloadFilesReset = document.querySelector(".max-files-reset");
    maxDownloadFilesInput.value = maxDownloadFiles;

    maxDownloadFilesInput.addEventListener("change", async () => {
      let configClient = await this.ensureConfigClient()
      configClient.launcher_config = configClient.launcher_config ?? {}
      configClient.launcher_config.download_multi = Number(maxDownloadFilesInput.value);
      await this.db.updateData('configClient', configClient);
    })

    maxDownloadFilesReset.addEventListener("click", async () => {
      let configClient = await this.ensureConfigClient()
      maxDownloadFilesInput.value = 5
      configClient.launcher_config = configClient.launcher_config ?? {}
      configClient.launcher_config.download_multi = 5;
      await this.db.updateData('configClient', configClient);
    })

    let themeBox = document.querySelector(".theme-box");
    let theme = configClient?.launcher_config?.theme || "auto";

    if (theme == "auto") {
      document.querySelector('.theme-btn-auto')?.classList.add('active-theme');
    } else if (theme == "dark") {
      document.querySelector('.theme-btn-sombre')?.classList.add('active-theme');
    } else if (theme == "light") {
      document.querySelector('.theme-btn-clair')?.classList.add('active-theme');
    }

    themeBox.addEventListener("click", async e => {
      if (e.target.classList.contains('theme-btn')) {
        let activeTheme = document.querySelector('.active-theme');
        if (e.target.classList.contains('active-theme')) return
        activeTheme?.classList.remove('active-theme');

        if (e.target.classList.contains('theme-btn-auto')) {
          setBackground();
          theme = "auto";
          e.target.classList.add('active-theme');
        } else if (e.target.classList.contains('theme-btn-sombre')) {
          setBackground(true);
          theme = "dark";
          e.target.classList.add('active-theme');
        } else if (e.target.classList.contains('theme-btn-clair')) {
          setBackground(false);
          theme = "light";
          e.target.classList.add('active-theme');
        }

        let configClient = await this.ensureConfigClient()
        configClient.launcher_config = configClient.launcher_config ?? {}
        configClient.launcher_config.theme = theme;
        await this.db.updateData('configClient', configClient);
      }
    })

    let closeBox = document.querySelector(".close-box");
    let closeLauncher = configClient?.launcher_config?.closeLauncher || "close-launcher";

    if (closeLauncher == "close-launcher") {
      document.querySelector('.close-launcher')?.classList.add('active-close');
    } else if (closeLauncher == "close-all") {
      document.querySelector('.close-all')?.classList.add('active-close');
    } else if (closeLauncher == "close-none") {
      document.querySelector('.close-none')?.classList.add('active-close');
    }

    closeBox.addEventListener("click", async e => {
      if (e.target.classList.contains('close-btn')) {
        let activeClose = document.querySelector('.active-close');
        if (e.target.classList.contains('active-close')) return
        activeClose?.classList.toggle('active-close');

        let configClient = await this.ensureConfigClient()
        configClient.launcher_config = configClient.launcher_config ?? {}

        if (e.target.classList.contains('close-launcher')) {
          e.target.classList.toggle('active-close');
          configClient.launcher_config.closeLauncher = "close-launcher";
          await this.db.updateData('configClient', configClient);
        } else if (e.target.classList.contains('close-all')) {
          e.target.classList.toggle('active-close');
          configClient.launcher_config.closeLauncher = "close-all";
          await this.db.updateData('configClient', configClient);
        } else if (e.target.classList.contains('close-none')) {
          e.target.classList.toggle('active-close');
          configClient.launcher_config.closeLauncher = "close-none";
          await this.db.updateData('configClient', configClient);
        }
      }
    })
  }
}

export default Settings;
