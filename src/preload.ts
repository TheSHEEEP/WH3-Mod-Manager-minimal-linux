import { contextBridge, ipcRenderer } from "electron";
import electronLog from "electron-log";

const api: api = {
  startGame: (mods: Mod[], startGameOptions: StartGameOptions, name?: string) =>
    ipcRenderer.send("startGame", mods, startGameOptions, name),
  exportModsToClipboard: (mods: Mod[]) => ipcRenderer.send("exportModsToClipboard", mods),
  subscribeToMods: (ids: string[]) => ipcRenderer.send("subscribeToMods", ids),
  openFolderInExplorer: (path: string) => ipcRenderer.send("openFolderInExplorer", path),
  openInSteam: (url: string) => ipcRenderer.send("openInSteam", url),
  openPack: (path: string) => ipcRenderer.send("openPack", path),
  getPacksInSave: (saveName: string) => ipcRenderer.send("getPacksInSave", saveName),
  putPathInClipboard: (path: string) => ipcRenderer.send("putPathInClipboard", path),
  updateMod: (mod: Mod, contentMod: Mod) => ipcRenderer.send("updateMod", mod, contentMod),
  fakeUpdatePack: (mod: Mod) => ipcRenderer.send("fakeUpdatePack", mod),
  makePackBackup: (mod: Mod) => ipcRenderer.send("makePackBackup", mod),
  forceModDownload: (mod: Mod) => ipcRenderer.send("forceModDownload", mod),
  reMerge: (mod: Mod, modsToMerge: Mod[]) => ipcRenderer.send("reMerge", mod, modsToMerge),
  deletePack: (mod: Mod) => ipcRenderer.send("deletePack", mod),
  forceDownloadMods: (modIds: string[]) => ipcRenderer.send("forceDownloadMods", modIds),
  mergeMods: (mods: Mod[]) => ipcRenderer.send("mergeMods", mods),
  handleLog: (callback) => ipcRenderer.on("handleLog", callback),
  subscribedToMods: (callback) => ipcRenderer.on("subscribedToMods", callback),
  createdMergedPack: (callback) => ipcRenderer.on("createdMergedPack", callback),
  setIsDev: (callback) => ipcRenderer.on("setIsDev", callback),
  packsInSave: (callback) => ipcRenderer.on("packsInSave", callback),
  sendApiExists: () => ipcRenderer.send("sendApiExists"),
  readAppConfig: () => ipcRenderer.send("readAppConfig"),
  copyToData: () => ipcRenderer.send("copyToData"),
  cleanData: () => ipcRenderer.send("cleanData"),
  saveConfig: (appState: AppState) => ipcRenderer.send("saveConfig", appState),
  getUpdateData: () => ipcRenderer.invoke("getUpdateData"),
  fromAppConfig: (callback) => ipcRenderer.on("fromAppConfig", callback),
  failedReadingConfig: (callback) => ipcRenderer.on("failedReadingConfig", callback),
  modsPopulated: (callback) => ipcRenderer.on("modsPopulated", callback),
  addMod: (callback) => ipcRenderer.on("addMod", callback),
  removeMod: (callback) => ipcRenderer.on("removeMod", callback),
  setModData: (callback) => ipcRenderer.on("setModData", callback),
  setPackHeaderData: (callback) => ipcRenderer.on("setPackHeaderData", callback),
  setPacksData: (callback) => ipcRenderer.on("setPacksData", callback),
  setPackCollisions: (callback) => ipcRenderer.on("setPackCollisions", callback),
  getAllModData: (ids) => ipcRenderer.send("getAllModData", ids),
  savesPopulated: (callback) => ipcRenderer.on("savesPopulated", callback),
  electronLog,
};
contextBridge.exposeInMainWorld("api", api);
