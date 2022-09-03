import { execFile, exec, fork } from "child_process";
import { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import installExtension, { REDUX_DEVTOOLS } from "electron-devtools-installer";
import fetch from "electron-fetch";
import isDev from "electron-is-dev";
import * as fs from "fs/promises";
import { updateAvailable } from "gh-release-fetch";
import { version } from "../package.json";
import { sortByNameAndLoadOrder } from "./modSortingHelpers";
import { readAppConfig, setStartingAppState, writeAppConfig } from "./appConfigFunctions";
import { fetchModData, getContentModInFolder, getDataMod, getMods } from "./modFunctions";
import appData from "./appData";
import chokidar from "chokidar";
import { getSaveFiles, setupSavesWatcher } from "./gameSaves";
import windowStateKeeper from "electron-window-state";
import { readPack } from "./packFileHandler";
import { getPacksInSave, readPackData, writePack } from "./packFileSerializer";
import * as steamworks from "steamworks.js";
import * as nodePath from "path";
import * as schema from "../schema/schema_wh3.json";

// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let client: ReturnType<typeof steamworks.init>;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  // eslint-disable-line global-require
  app.quit();
}

let mainWindow: BrowserWindow | undefined;
let watcher: chokidar.FSWatcher | undefined;

const readConfig = async (mainWindow: BrowserWindow) => {
  try {
    const appState = await readAppConfig();
    if (!appData.hasReadConfig) {
      appData.hasReadConfig = true;
      setStartingAppState(appState);
    }
    mainWindow.webContents.send("fromAppConfig", appState);
  } catch (err) {
    mainWindow.webContents.send("failedReadingConfig");
    console.log(err);
  }
};

const log = (msg: string) => {
  mainWindow?.webContents.send("handleLog", msg);
  console.log(msg);
};

const removeMod = async (mainWindow: BrowserWindow, modPath: string) => {
  mainWindow?.webContents.send("removeMod", modPath);
};

const getMod = async (mainWindow: BrowserWindow, modPath: string) => {
  try {
    let mod: Mod;
    if (modPath.includes("\\content\\1142710\\")) {
      const modSubfolderName = nodePath.dirname(modPath).replace(/.*\\/, "");
      console.log("looking for ", modSubfolderName);
      mod = await getContentModInFolder(modSubfolderName, log);
    } else {
      console.log("looking for DATA MOD: ", nodePath.basename(modPath));
      mod = await getDataMod(nodePath.basename(modPath), log);
    }

    if (mod) {
      mainWindow?.webContents.send("addMod", mod);
    }
  } catch (e) {
    console.log(e);
  }
};

const getAllMods = async (mainWindow: BrowserWindow) => {
  try {
    const mods = await getMods(log);
    mainWindow?.webContents.send("modsPopulated", mods);
    readConfig(mainWindow);

    mods.forEach(async (mod) => {
      try {
        const packData = await readPack(mod.path);
        if (packData.isMovie) mainWindow.webContents.send("setPackData", packData);
      } catch (e) {
        log(e);
      }
    });

    if (!appData.saveSetupDone) {
      appData.saveSetupDone = true;
      getSaveFiles()
        .then((saves) => {
          setupSavesWatcher((saves) => mainWindow?.webContents.send("savesPopulated", saves));
          mainWindow?.webContents.send("savesPopulated", saves);
        })
        .catch();
    }

    const dataMod: Mod = {
      humanName: "",
      name: "data.pack",
      path: `${appData.dataFolder}\\data.pack`,
      imgPath: "",
      workshopId: "",
      isEnabled: true,
      modDirectory: `${appData.dataFolder}`,
      isInData: true,
      lastChanged: undefined,
      loadOrder: undefined,
      author: "",
      isDeleted: false,
      isMovie: false,
    };
    readPackData(mods.concat(dataMod));
  } catch (err) {
    console.log(err);
  }

  if (!watcher) {
    const contentFolder = appData.contentFolder.replaceAll("\\", "/").replaceAll("//", "/");
    const dataFolder = appData.dataFolder.replaceAll("\\", "/").replaceAll("//", "/");
    watcher = chokidar
      .watch([`${contentFolder}/**/*.pack`, `${dataFolder}/**/*.pack`], {
        ignoreInitial: true,
        awaitWriteFinish: true,
      })
      .on("add", (path) => {
        mainWindow.webContents.send("handleLog", "MOD ADDED: " + path);
        console.log("MOD ADDED: " + path);
        // getAllMods(mainWindow);
        getMod(mainWindow, path);
      })
      .on("unlink", (path) => {
        mainWindow.webContents.send("handleLog", "MOD REMOVED: " + path);
        console.log("MOD REMOVED: " + path);
        // getAllMods(mainWindow);
        removeMod(mainWindow, path);
      });
  }
};

const createWindow = (): void => {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1024,
    defaultHeight: 800,
  });

  // Create the browser window.
  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    autoHideMenuBar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
    title: "WH3 Mod Manager",
  });

  mainWindowState.manage(mainWindow);

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Open the DevTools.
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // const server = "https://hazel-neon-gamma.vercel.app";
  // const url = `${server}/update/${process.platform}/${app.getVersion()}`;

  // autoUpdater.setFeedURL({ url });
  // setInterval(() => {
  //   try {
  //     autoUpdater.checkForUpdates();
  //   } catch {}
  // }, 60000);
  // try {
  //   autoUpdater.checkForUpdates();
  // } catch {}

  autoUpdater.on("update-downloaded", (event, releaseNotes, releaseName) => {
    const dialogOpts = {
      type: "info",
      buttons: ["Restart", "Later"],
      title: "Application Update",
      message: process.platform === "win32" ? releaseNotes : releaseName,
      detail: "A new version has been downloaded. Restart the application to apply the updates.",
    };

    dialog.showMessageBox(dialogOpts).then((returnValue) => {
      if (returnValue.response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on("error", (message) => {
    console.error("There was a problem updating the application");
    console.error(message);
  });

  mainWindow.on("page-title-updated", (evt) => {
    evt.preventDefault();
  });

  ipcMain.on("getAllModData", (event, ids: string[]) => {
    fetchModData(
      ids.filter((id) => id !== ""),
      (modData) => {
        mainWindow.webContents.send("setModData", modData);
      },
      (msg) => {
        mainWindow.webContents.send("handleLog", msg);
        console.log(msg);
      }
    );
  });

  ipcMain.on("getPacksInSave", async (event, saveName: string) => {
    mainWindow.webContents.send("packsInSave", await getPacksInSave(saveName));
  });

  ipcMain.on("readAppConfig", () => {
    getAllMods(mainWindow);
  });

  ipcMain.on("copyToData", async () => {
    const mods = await getMods(log);
    const withoutDataMods = mods.filter((mod) => !mod.isInData);
    const copyPromises = withoutDataMods.map((mod) => {
      mainWindow.webContents.send(
        "handleLog",
        `COPYING ${mod.path} to ${appData.gamePath}\\data\\${mod.name}`
      );

      return fs.copyFile(mod.path, `${appData.gamePath}\\data\\${mod.name}`);
    });

    await Promise.allSettled(copyPromises);
    getAllMods(mainWindow);
  });

  ipcMain.on("cleanData", async () => {
    const mods = await getMods(log);
    mods.forEach((mod) => {
      if (mod.isInData) mainWindow.webContents.send("handleLog", `is in data ${mod.name}`);
    });
    const modsInBothPlaces = mods.filter(
      (mod) => mod.isInData && mods.find((modSecond) => !modSecond.isInData && modSecond.name === mod.name)
    );
    const deletePromises = modsInBothPlaces.map((mod) => {
      mainWindow.webContents.send("handleLog", `DELETING ${mod.path}`);

      return fs.unlink(mod.path);
    });

    await Promise.allSettled(deletePromises);
    getAllMods(mainWindow);
  });

  ipcMain.on("saveConfig", (event, data: AppState) => {
    const enabledMods = data.currentPreset.mods.filter(
      (iterMod) => iterMod.isEnabled || data.alwaysEnabledMods.find((mod) => mod.name === iterMod.name)
    );
    const hiddenAndEnabledMods = data.hiddenMods.filter((iterMod) =>
      enabledMods.find((mod) => mod.name === iterMod.name)
    );
    mainWindow.setTitle(
      `WH3 Mod Manager: ${enabledMods.length} mods enabled` +
        (hiddenAndEnabledMods.length > 0 ? ` (${hiddenAndEnabledMods.length} of those hidden)` : "")
    );
    writeAppConfig(data);
  });

  ipcMain.removeHandler("getUpdateData");
  ipcMain.handle("getUpdateData", async () => {
    let modUpdatedExists = { updateExists: false } as ModUpdateExists;

    // return { updateExists: true, downloadURL: "http://www.google.com" } as ModUpdateExists;
    const isAvailable = await updateAvailable("Shazbot/WH3-Mod-Manager", version);
    if (!isAvailable) return modUpdatedExists;

    await fetch(`https://api.github.com/repos/Shazbot/WH3-Mod-Manager/releases/latest`)
      .then((res) => res.json())
      .then((body) => {
        body.assets.forEach((asset: { content_type: string; browser_download_url: string }) => {
          mainWindow.webContents.send("handleLog", asset.content_type == "application/x-zip-compressed");
          if (asset.content_type === "application/x-zip-compressed") {
            modUpdatedExists = {
              updateExists: true,
              downloadURL: asset.browser_download_url,
            } as ModUpdateExists;
          }
        });
      })
      .catch();

    return modUpdatedExists;
  });

  ipcMain.on("sendApiExists", async () => {
    mainWindow.webContents.send("handleLog", "API now exists");
    mainWindow.webContents.send("setIsDev", isDev);
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

app.whenReady().then(() => {
  installExtension(REDUX_DEVTOOLS)
    .then((name) => console.log(`Added Extension:  ${name}`))
    .catch((err) => console.log("An error occurred: ", err));
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// process.on("unhandledRejection", function (err) {});

ipcMain.on("openFolderInExplorer", (event, path: string) => {
  shell.showItemInFolder(path);
});

ipcMain.on("openInSteam", (event, url: string) => {
  exec(`start steam://openurl/${url}`);
});

ipcMain.on("openPack", (event, path: string) => {
  shell.openPath(path);
});
ipcMain.on("putPathInClipboard", (event, path: string) => {
  clipboard.writeText(path);
});

ipcMain.on("subscribeToMods", async (event, ids: string[]) => {
  fork(nodePath.join(__dirname, "sub.js"), [ids.join(";")], {});
  mainWindow.webContents.send("subscribedToMods", ids);
});

ipcMain.on("exportModsToClipboard", async (event, mods: Mod[]) => {
  const sortedMods = sortByNameAndLoadOrder(mods);
  const enabledMods = sortedMods.filter((mod) => mod.isEnabled);

  const exportedMods = enabledMods
    .filter((mod) => !isNaN(Number(mod.workshopId)) && !isNaN(parseFloat(mod.workshopId)))
    .map((mod) => mod.workshopId + (mod.loadOrder != null ? `;${mod.loadOrder}` : ""))
    .join("|");
  clipboard.writeText(exportedMods);
});

ipcMain.on("startGame", async (event, mods: Mod[], startGameOptions: StartGameOptions, saveName?: string) => {
  const appDataPath = app.getPath("userData");
  const userScriptPath = `${appData.gamePath}\\my_mods.txt`;

  const sortedMods = sortByNameAndLoadOrder(mods);
  const enabledMods = sortedMods.filter((mod) => mod.isEnabled);

  const dataMod: Mod = {
    humanName: "",
    name: "data.pack",
    path: `${appData.dataFolder}\\data.pack`,
    imgPath: "",
    workshopId: "",
    isEnabled: true,
    modDirectory: `${appData.dataFolder}`,
    isInData: true,
    lastChanged: undefined,
    loadOrder: undefined,
    author: "",
    isDeleted: false,
    isMovie: false,
  };

  let extraEnabledMods = "";
  if (
    startGameOptions.isMakeUnitsGeneralsEnabled ||
    startGameOptions.isScriptLoggingEnabled ||
    startGameOptions.isSkipIntroMoviesEnabled
  ) {
    await fs.mkdir(`${appDataPath}\\tempPacks`, { recursive: true });

    // const data = await readPacks(enabledMods.map((mod) => mod.path));
    const tempPackName = "!!!!out.pack";
    const tempPackPath = `${appDataPath}\\tempPacks\\${tempPackName}`;
    await writePack(tempPackPath, enabledMods.concat(dataMod), startGameOptions);

    extraEnabledMods = `\nadd_working_directory "${appDataPath}\\tempPacks";` + `\nmod "${tempPackName}";`;
  }

  const text =
    enabledMods
      .filter((mod) => !mod.isInData)
      .map((mod) => `add_working_directory "${mod.modDirectory}";`)
      .concat(enabledMods.map((mod) => `mod "${mod.name}";`))
      .join("\n") + extraEnabledMods;

  await fs.writeFile(userScriptPath, text);
  const batPath = `${appDataPath}\\game.bat`;
  let batData = `start /d "${appData.gamePath}" Warhammer3.exe`;
  if (saveName) {
    batData += ` game_startup_mode campaign_load "${saveName}" ;`;
  }
  batData += " my_mods.txt;";

  mainWindow.webContents.send("handleLog", "starting game:");
  mainWindow.webContents.send("handleLog", batData);

  await fs.writeFile(batPath, batData);
  execFile(batPath);
});
