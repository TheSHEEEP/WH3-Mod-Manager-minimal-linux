import { execFile } from "child_process";
import { app, BrowserWindow, ipcMain, autoUpdater, dialog } from "electron";
import * as fs from "fs/promises";
import Registry from "winreg";
import * as VDF from "@node-steam/vdf";
import installExtension, { REDUX_DEVTOOLS } from "electron-devtools-installer";
import fetch from "electron-fetch";
import isDev from "electron-is-dev";

// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  // eslint-disable-line global-require
  app.quit();
}

const regKey = new Registry({
  // new operator is optional
  hive: Registry.HKLM, // open registry hive HKEY_CURRENT_USER
  key: "\\SOFTWARE\\Wow6432Node\\Valve\\Steam", // key containing autostart programs
});

const getDataMods = async (gameDir: string): Promise<Mod[]> => {
  const vanillaPacks: string[] = [];
  const dataPacks: Mod[] = [];

  return fs.readFile(`${gameDir}\\data\\manifest.txt`, "utf8").then(async (data) => {
    const re = /([^\s]+)/;
    const dataPath = `${gameDir}\\data`;
    data.split("\n").map((line) => {
      const found = line.match(re);
      if (found) {
        // console.log(found[1]);
        vanillaPacks.push(found[1]);
      }
    });

    const files = await fs.readdir(dataPath, { withFileTypes: true });

    files
      .filter(
        (file) =>
          file.isFile() &&
          file.name.endsWith(".pack") &&
          !vanillaPacks.find((vanillaPack) => file.name.includes(vanillaPack))
      )
      .map(async (file) => {
        const lastChanged = await fs.stat(`${dataPath}\\${file.name}`).then((stats) => {
          return stats.atimeMs;
        });

        const mod: Mod = {
          humanName: "",
          name: file.name,
          path: `${dataPath}\\${file.name}`,
          modDirectory: dataPath,
          imgPath: "",
          workshopId: file.name,
          isEnabled: false,
          isInData: true,
          lastChanged,
        };
        dataPacks.push(mod);
      });

    return dataPacks;
  });
};

const appData: AppData = {
  presets: [],
  gamePath: "",
};

const readConfig = (mainWindow: BrowserWindow) => {
  const userData = app.getPath("userData");
  fs.readFile(`${userData}\\config.json`, "utf8")
    .then((data) => {
      const appState = JSON.parse(data) as AppState;

      mainWindow.webContents.send("fromAppConfig", appState);
    })
    .catch();
};

const mods: Mod[] = [];
const getMods = (mainWindow: BrowserWindow) => {
  regKey.values(async function (err, items: { name: string; value: string }[] /* array of RegistryItem */) {
    if (err) console.log("ERROR: " + err);
    else {
      const installPathObj = items.find((x) => x.name === "InstallPath");
      if (installPathObj) {
        const installPath = installPathObj.value;
        const libFoldersPath = `${installPath}\\steamapps\\libraryfolders.vdf`;

        fs.readFile(libFoldersPath, "utf8").then((data) => {
          const object = VDF.parse(data).libraryfolders;
          const paths = [];
          for (const property in object) {
            paths.push(object[property].path);
          }

          paths.find((path) => {
            const worshopFilePath = `${path}\\steamapps\\appmanifest_1142710.acf`;
            fs.readFile(worshopFilePath).then(async () => {
              // console.log(worshopFilePath);
              const contentFolder = `${path}\\steamapps\\workshop\\content\\1142710`;
              appData.gamePath = `${path}\\steamapps\\common\\Total War WARHAMMER III`;

              const dataMods = await getDataMods(`${path}\\steamapps\\common\\Total War WARHAMMER III`);
              mods.push(...dataMods);

              const files = await fs.readdir(contentFolder, { withFileTypes: true });
              const newMods = files
                .filter((file) => file.isDirectory())
                .map(async (file) => {
                  // console.log(`${contentFolder}\\${file.name}`);
                  const files = await fs.readdir(`${contentFolder}\\${file.name}`, { withFileTypes: true });

                  const pack = files.find((file) => file.name.endsWith(".pack"));
                  const img = files.find((file) => file !== pack);

                  if (pack) {
                    const lastChanged = await fs
                      .stat(`${contentFolder}\\${file.name}\\${pack.name}`)
                      .then((stats) => {
                        return stats.atimeMs;
                      });
                    // console.log(pack.name);
                    const packPath = `${contentFolder}\\${file.name}\\${pack.name}`;
                    const imgPath = `${contentFolder}\\${file.name}\\${img.name}`;
                    const mod: Mod = {
                      humanName: "",
                      name: pack.name,
                      path: packPath,
                      modDirectory: `${contentFolder}\\${file.name}`,
                      imgPath: imgPath,
                      workshopId: file.name,
                      isEnabled: false,
                      isInData: false,
                      lastChanged,
                    };
                    return mod;
                  }
                });

              const a = await Promise.allSettled(newMods);
              a.forEach((result) => {
                const mod = (result as PromiseFulfilledResult<Mod>).value;
                mods.push(mod);
              });

              mainWindow.webContents.send("modsPopulated", mods);
              readConfig(mainWindow);
            });
          });
        });
      }
    }
  });
};

const createWindow = (): void => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    height: 800,
    width: 1024,
    autoHideMenuBar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools.
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  const server = "https://hazel-neon-gamma.vercel.app";
  const url = `${server}/update/${process.platform}/${app.getVersion()}`;

  autoUpdater.setFeedURL({ url });
  setInterval(() => {
    try {
      autoUpdater.checkForUpdates();
    } catch {}
  }, 60000);
  try {
    autoUpdater.checkForUpdates();
  } catch {}

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

  ipcMain.on("getAllModData", (event, ids: string[]) => {
    console.log("GET ALL MOD DATA ENTERED");
    mainWindow.webContents.send("handleLog", "GET ALL MOD DATA ENTERED");
    ids
      .filter((id) => id !== "")
      .forEach(async (workshopId, index) => {
        // await new Promise((resolve) => setTimeout(resolve, index * 20));
        fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`)
          .then((res) => res.text())
          .then((body) => {
            const regexpSize = /<div class="workshopItemTitle">(.+)<\/div>/;
            const match = body.match(regexpSize);
            // console.log(match[1]);
            // mainWindow.webContents.send("handleLog", match[1]);

            let reqModIds: string[] = [];
            const requiredItemsContainerInnerRegex = /id="RequiredItems"(.+?)<\/div>/s;
            const requiredItemsContainerInner = body.match(requiredItemsContainerInnerRegex);
            if (requiredItemsContainerInner && requiredItemsContainerInner[1]) {
              const requiredModsIdsRegex = /filedetails\/\?id=(\w+)/gs;
              const requiredModsIds = requiredItemsContainerInner[1].matchAll(requiredModsIdsRegex);
              reqModIds = [...requiredModsIds].map((matchAllResult) => matchAllResult[1]);
            }
            const modData = { workshopId, humanName: match[1], reqModIds } as ModData;
            mainWindow.webContents.send("setModData", modData);
          })
          .catch();
      });
  });

  ipcMain.on("readAppConfig", () => {
    getMods(mainWindow);
  });

  ipcMain.on("saveConfig", (event, data: AppState) => {
    const userData = app.getPath("userData");
    fs.writeFile(`${userData}\\config.json`, JSON.stringify(data));
  });

  ipcMain.removeHandler("getModData");
  ipcMain.handle("getModData", async (event, workshopId) => {
    if (isDev) return;

    // mainWindow.webContents.send("handleLog", "looking for " + workshopId);
    return fetch(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`)
      .then((res) => res.text())
      .then((body) => {
        const regexpSize = /<div class="workshopItemTitle">(.+)<\/div>/;
        const match = body.match(regexpSize);
        // console.log(match[1]);
        // mainWindow.webContents.send("handleLog", match[1]);
        return { id: workshopId, name: match[1] };
      })
      .catch();
  });

  ipcMain.on("sendApiExists", () => {
    mainWindow.webContents.send("handleLog", "API now exists");
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

ipcMain.on("writeUserScript", (event, mods: Mod[]) => {
  const appDataPath = app.getPath("userData");
  const userScriptPath = `${appDataPath}\\my_mods.txt`;

  const enabledMods = mods
    .filter((mod) => mod.isEnabled)
    .sort((modFirst, modSecond) => modFirst.name.localeCompare(modSecond.name));

  const text = enabledMods
    .filter((mod) => !mod.isInData)
    .map((mod) => `add_working_directory "${mod.modDirectory}";`)
    .concat(enabledMods.map((mod) => `mod "${mod.name}";`))
    .join("\n");

  fs.writeFile(userScriptPath, text).then(() => {
    const batPath = `${appDataPath}\\game.bat`;
    const batData = `start /d "${appData.gamePath.replace(
      "\\\\",
      "\\"
    )}" Warhammer3.exe ${appDataPath}\\my_mods.txt;`;
    fs.writeFile(batPath, batData).then(() => {
      execFile(batPath);
    });
  });
});

// execFile("K:\\SteamLibrary\\steamapps\\common\\Total War WARHAMMER III\\game.bat");
// execFile("C:\\Windows\\System32\\notepad.exe", []);
