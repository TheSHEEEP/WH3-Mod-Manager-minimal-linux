import { Pack, PackCollisions } from "./packFileTypes";

interface AppData {
  presets: Preset[];
  gamePath: string;
  contentFolder: string | undefined;
  dataFolder: string | undefined;
  gameSaves: GameSave[];
  saveSetupDone: boolean;
  isMakeUnitsGeneralsEnabled: boolean;
  hasReadConfig: boolean;
  packsData: Pack[];
  compatData: PackCollisions;
}

export default {
  presets: [],
  gamePath: "",
  contentFolder: undefined,
  dataFolder: undefined,
  gameSaves: [],
  saveSetupDone: false,
  isMakeUnitsGeneralsEnabled: false,
  hasReadConfig: false,
  packsData: [],
  compatData: undefined,
} as AppData;
