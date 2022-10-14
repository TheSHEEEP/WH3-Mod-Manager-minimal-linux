import { Pack, PackCollisions } from "./packFileTypes";
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
import { readPackHeader } from "./packFileHandler";
import {
  addFakeUpdate,
  getPacksInSave,
  mergeMods,
  readPack,
  readPackData,
  writePack,
} from "./packFileSerializer";
import * as nodePath from "path";
import { getCompatData } from "./packFileDataManager";
import { format } from "date-fns";
import {
  appendPackFileCollisions,
  appendPackTableCollisions,
  removeFromPackFileCollisions,
  removeFromPackTableCollisions,
} from "./readPacksWorker";
import { isMainThread } from "worker_threads";
import electronLog from "electron-log";
import * as fsExtra from "fs-extra";

// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

process.noAsar = true;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  // eslint-disable-line global-require
  app.quit();
}

if (isMainThread) {
  process.umask(0);

  console.log = (...args) => {
    electronLog.info(...args);
  };
}

let mainWindow: BrowserWindow | undefined;
let contentWatcher: chokidar.FSWatcher | undefined;
let dataWatcher: chokidar.FSWatcher | undefined;
let downloadsWatcher: chokidar.FSWatcher | undefined;
let mergedWatcher: chokidar.FSWatcher | undefined;

const readConfig = async (mainWindow: BrowserWindow) => {
  try {
    const appState = await readAppConfig();
    if (!appData.hasReadConfig) {
      setStartingAppState(appState);
    }
    mainWindow.webContents.send("fromAppConfig", appState);
  } catch (err) {
    mainWindow.webContents.send("failedReadingConfig");
    console.log(err);
  } finally {
    appData.hasReadConfig = true;
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
      console.log("looking for DATA MOD: ", modPath);
      mod = await getDataMod(modPath, log);
    }

    if (mod) {
      mainWindow?.webContents.send("addMod", mod);
    }
  } catch (e) {
    console.log(e);
  }
};

const appendPacksData = async (newPack: Pack) => {
  while (!appData.packsData) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (appData.packsData && appData.packsData.every((pack) => pack.path != newPack.path)) {
    appData.packsData.push(newPack);
  }
};
const appendCollisions = async (newPack: Pack) => {
  while (!appData.compatData) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (appData.compatData) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    appData.compatData.packTableCollisions = appendPackTableCollisions(
      appData.packsData,
      appData.compatData.packTableCollisions,
      newPack
    );
    appData.compatData.packFileCollisions = appendPackFileCollisions(
      appData.packsData,
      appData.compatData.packFileCollisions,
      newPack
    );

    mainWindow?.webContents.send("setPackCollisions", {
      packFileCollisions: appData.compatData.packFileCollisions,
      packTableCollisions: appData.compatData.packTableCollisions,
    } as PackCollisions);
  }
};

const onNewPackFound = async (path: string) => {
  if (!mainWindow) return;
  mainWindow.webContents.send("handleLog", "MOD ADDED: " + path);
  console.log("MOD ADDED: " + path);
  await getMod(mainWindow, path);
  const newPack = await readPack(path);

  appendPacksData(newPack);
  appendCollisions(newPack);
};
const onPackDeleted = async (path: string) => {
  if (!mainWindow) return;
  mainWindow.webContents.send("handleLog", "MOD REMOVED: " + path);
  console.log("MOD REMOVED: " + path);
  await removeMod(mainWindow, path);

  if (appData.packsData && appData.packsData.some((pack) => pack.path == path)) {
    appData.packsData = appData.packsData.filter((pack) => pack.path != path);
  }

  if (appData.compatData) {
    appData.compatData.packTableCollisions = removeFromPackTableCollisions(
      appData.compatData.packTableCollisions,
      nodePath.basename(path)
    );
    appData.compatData.packFileCollisions = removeFromPackFileCollisions(
      appData.compatData.packFileCollisions,
      nodePath.basename(path)
    );

    mainWindow?.webContents.send("setPackCollisions", {
      packFileCollisions: appData.compatData.packFileCollisions,
      packTableCollisions: appData.compatData.packTableCollisions,
    } as PackCollisions);
  }
};

const getAllMods = async (mainWindow: BrowserWindow) => {
  try {
    const mods = await getMods(log);
    mainWindow?.webContents.send("modsPopulated", mods);
    readConfig(mainWindow);

    mods.forEach(async (mod) => {
      try {
        if (mod == null || mod.path == null) {
          console.log(mod);
        }
        const packHeaderData = await readPackHeader(mod.path);
        if (packHeaderData.isMovie) mainWindow.webContents.send("setPackHeaderData", packHeaderData);
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
      size: 0,
    };
    console.log("READING PACKS");
    const newPacksData = await readPackData(mods.concat(dataMod));
    appData.packsData = newPacksData;
    getCompatData(newPacksData).then((compatData) => {
      appData.compatData = compatData;
      mainWindow?.webContents.send("setPackCollisions", compatData);
    });
  } catch (err) {
    console.log(err);
  }

  if (isDev) {
    await contentWatcher?.close();
    await dataWatcher?.close();
    await downloadsWatcher?.close();
    await mergedWatcher?.close();
  }

  if (!contentWatcher || isDev) {
    const contentFolder = appData.contentFolder.replaceAll("\\", "/").replaceAll("//", "/");
    console.log("content folder:", contentFolder);
    contentWatcher = chokidar
      .watch(`${contentFolder}/**/*.pack`, {
        ignoreInitial: true,
        ignored: /whmm_backups/,
      })
      .on("add", async (path) => {
        console.log("NEW CONTENT ADD", path);
        onNewPackFound(path);
      })
      .on("unlink", async (path) => {
        console.log("NEW CONTENT UNLINK", path);
        onPackDeleted(path);
      });
  }
  if (!downloadsWatcher || isDev) {
    const downloadsFolder = appData.contentFolder
      .replaceAll("\\", "/")
      .replaceAll("//", "/")
      .replace("/content/", "/downloads/");
    console.log("downloads folder:", downloadsFolder);
    downloadsWatcher = chokidar
      .watch(`${downloadsFolder}/**/*.pack`, {
        ignoreInitial: true,
        awaitWriteFinish: true,
        ignored: /whmm_backups/,
      })
      .on("add", async (path) => {
        console.log("NEW DOWNLOADS ADD", path);
        fork(nodePath.join(__dirname, "sub.js"), ["justRun"], {});
      })
      .on("unlink", async (path) => {
        console.log("NEW DOWNLOADS UNLINK", path);
      });
  }
  if (!dataWatcher || isDev) {
    const dataFolder = appData.dataFolder.replaceAll("\\", "/").replaceAll("//", "/");
    dataWatcher = chokidar
      .watch([`${dataFolder}/*.pack`], {
        ignoreInitial: true,
        awaitWriteFinish: true,
        ignored: /whmm_backups/,
      })
      .on("add", async (path) => {
        onNewPackFound(path);
      })
      .on("unlink", async (path) => {
        onPackDeleted(path);
      });
  }
  if (!mergedWatcher || isDev) {
    const dataFolder = appData.dataFolder.replaceAll("\\", "/").replaceAll("//", "/");
    mergedWatcher = chokidar
      .watch([`${dataFolder}/merged/*.pack`], {
        ignoreInitial: false,
        awaitWriteFinish: true,
        ignored: /whmm_backups/,
      })
      .on("add", async (path) => {
        onNewPackFound(path);
      })
      .on("unlink", async (path) => {
        onPackDeleted(path);
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
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#374151",
      symbolColor: "#9ca3af",
      height: 28,
    },
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
    if (isDev) return;

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
      `WH3 Mod Manager v${version}: ${enabledMods.length} mods enabled` +
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

process.on("unhandledRejection", (err) => {
  console.log(err);
});
process.on("uncaughtException", (err) => {
  console.log(err);
});

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
ipcMain.on("updateMod", async (event, mod: Mod, contentMod: Mod) => {
  const uploadFolderName = contentMod.workshopId;
  const uploadFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_uploads_" + uploadFolderName);

  await fs.rm(uploadFolderPath, { recursive: true, force: true });
  await fs.mkdir(uploadFolderPath, { recursive: true });

  await fs.link(mod.path, nodePath.join(uploadFolderPath, mod.name));
  await fs.link(mod.imgPath, nodePath.join(uploadFolderPath, nodePath.basename(mod.imgPath)));

  const child = fork(
    nodePath.join(__dirname, "sub.js"),
    ["update", contentMod.workshopId, uploadFolderPath],
    {}
  );
  child.on("message", (folderPath: string) => {
    console.log("child says delete");
    fs.rm(folderPath, { recursive: true, force: true });
  });
});
ipcMain.on("fakeUpdatePack", async (event, mod: Mod) => {
  try {
    const uploadFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_backups");
    const backupFilePath = nodePath.join(
      uploadFolderPath,
      nodePath.parse(mod.name).name +
        "-" +
        format(new Date(), "dd-MM-yyyy-HH-mm") +
        nodePath.parse(mod.name).ext
    );
    const uploadFilePath = nodePath.join(
      uploadFolderPath,
      nodePath.parse(mod.name).name +
        "-NEW-" +
        format(new Date(), "dd-MM-yyyy-HH-mm") +
        nodePath.parse(mod.name).ext
    );

    await fs.mkdir(uploadFolderPath, { recursive: true });
    await fs.copyFile(mod.path, backupFilePath);
    await addFakeUpdate(mod.path, uploadFilePath);

    const command = `cd /d "${nodePath.dirname(mod.path)}" && del "${nodePath.basename(
      mod.path
    )}" && move /y "whmm_backups\\${nodePath.basename(uploadFilePath)}" "${nodePath.basename(mod.path)}"`;
    console.log(command);

    exec(command);
  } catch (e) {
    console.log(e);
  }
});

ipcMain.on("makePackBackup", async (event, mod: Mod) => {
  try {
    const uploadFolderPath = nodePath.join(nodePath.dirname(mod.path), "whmm_backups");
    const backupFilePath = nodePath.join(
      uploadFolderPath,
      nodePath.parse(mod.name).name +
        "-" +
        format(new Date(), "dd-MM-yyyy-HH-mm") +
        nodePath.parse(mod.name).ext
    );
    await fs.mkdir(uploadFolderPath, { recursive: true });
    await fs.copyFile(mod.path, backupFilePath);
  } catch (e) {
    console.log(e);
  }
});
ipcMain.on("forceModDownload", async (event, mod: Mod) => {
  try {
    fork(nodePath.join(__dirname, "sub.js"), ["download", mod.workshopId], {});
  } catch (e) {
    console.log(e);
  }
});
ipcMain.on("reMerge", async (event, mod: Mod, modsToMerge: Mod[]) => {
  try {
    mergeMods(modsToMerge, mod.name);
  } catch (e) {
    console.log(e);
  }
});
ipcMain.on("deletePack", async (event, mod: Mod) => {
  try {
    await fsExtra.remove(mod.path);
  } catch (e) {
    console.log(e);
  }
});
ipcMain.on("forceDownloadMods", async (event, modIds: string[]) => {
  try {
    fork(nodePath.join(__dirname, "sub.js"), ["download", modIds.join(";")], {});
  } catch (e) {
    console.log(e);
  }
});
ipcMain.on("mergeMods", async (event, mods: Mod[]) => {
  try {
    mergeMods(mods).then((targetPath) => {
      mainWindow.webContents.send("createdMergedPack", targetPath);
    });
  } catch (e) {
    console.log(e);
  }
});

ipcMain.on("subscribeToMods", async (event, ids: string[]) => {
  fork(nodePath.join(__dirname, "sub.js"), ["sub", ids.join(";")], {});
  await new Promise((resolve) => setTimeout(resolve, 500));
  fork(nodePath.join(__dirname, "sub.js"), ["download", ids.join(";")], {});
  await new Promise((resolve) => setTimeout(resolve, 1000));
  fork(nodePath.join(__dirname, "sub.js"), ["justRun"], {});
  await new Promise((resolve) => setTimeout(resolve, 500));
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
    size: 0,
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
    await writePack(appData.packsData, tempPackPath, enabledMods.concat(dataMod), startGameOptions);

    extraEnabledMods = `\nadd_working_directory "${appDataPath}\\tempPacks";` + `\nmod "${tempPackName}";`;
  }

  const modPathsInsideMergedMods = enabledMods
    .filter((mod) => mod.mergedModsData)
    .map((mod) => mod.mergedModsData.map((mod) => mod.path))
    .flatMap((paths) => paths);

  const enabledModsWithoutMergedInMods = enabledMods.filter(
    (mod) => !modPathsInsideMergedMods.some((path) => path == mod.path)
  );

  const text =
    enabledModsWithoutMergedInMods
      .filter((mod) => nodePath.relative(appData.dataFolder, mod.modDirectory) != "")
      .map((mod) => `add_working_directory "${mod.modDirectory}";`)
      .concat(enabledModsWithoutMergedInMods.map((mod) => `mod "${mod.name}";`))
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
