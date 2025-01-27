export function sortByNameAndLoadOrder(mods: Mod[]) {
  const newMods = getModsSortedByName(mods);
  [...newMods]
    .filter((mod) => mod.loadOrder != null)
    .sort((modF, modS) => (modF.loadOrder as number) - (modS.loadOrder as number))
    .map((mod) => {
      // console.log(`mod ${mod.name} has order ${mod.loadOrder}`);
      newMods.splice(newMods.indexOf(mod), 1);
      // newMods.splice(mod.loadOrder, 0, mod);
      return mod;
    })
    .forEach((mod) => {
      newMods.splice(mod.loadOrder as number, 0, mod);
    });
  return newMods;
}

export function getModsSortedByOrder(mods: Mod[], orderedMods: Mod[]) {
  return [...mods].sort(
    (firstMod, secondMod) => orderedMods.indexOf(firstMod) - orderedMods.indexOf(secondMod)
  );
}

export function compareModNames(firstName: string, secondName: string): number {
  firstName = firstName.toLowerCase();
  secondName = secondName.toLowerCase();
  const len = Math.max(firstName.length, secondName.length);
  for (let i = 0; i < len; i++) {
    if (i === firstName.length) return 1;
    if (i === secondName.length) return -1;

    const diff = firstName.charCodeAt(i) - secondName.charCodeAt(i);
    if (diff === 0) continue;
    return diff < 0 ? -1 : 1;
  }

  return 0;
}

export function getModsSortedByName(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    return compareModNames(firstMod.name, secondMod.name);
  });
}

export function getModsSortedBySize(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    return firstMod.size - secondMod.size;
  });
}

export function getModsSortedByHumanName(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => firstMod.humanName.localeCompare(secondMod.humanName));
}

export function getModsSortedByEnabled(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.isEnabled == secondMod.isEnabled) {
      return compareModNames(firstMod.name, secondMod.name);
    }
    return firstMod.isEnabled ? -1 : 1;
  });
}

export function getModsSortedByAuthor(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    if (firstMod.author == secondMod.author) {
      return compareModNames(firstMod.name, secondMod.name);
    }
    return firstMod.author.localeCompare(secondMod.author);
  });
}

export function getModsSortedByLastUpdated(mods: Mod[]) {
  return [...mods].sort((firstMod, secondMod) => {
    const firstModLastChanged = firstMod.lastChanged || firstMod.lastChangedLocal;
    const secondModLastChanged = secondMod.lastChanged || secondMod.lastChangedLocal;
    if (firstModLastChanged === undefined && secondModLastChanged === undefined) return 0;
    if (firstModLastChanged === undefined) return 1;
    if (secondModLastChanged === undefined) return -1;
    return secondModLastChanged - firstModLastChanged;
  });
}

export function getFilteredMods(mods: Mod[], filter: string, doAuthorFiltering: boolean) {
  return mods.filter(
    (mod) =>
      mod.name.toLowerCase().includes(filter) ||
      (mod.humanName && mod.humanName.toLowerCase().includes(filter)) ||
      (doAuthorFiltering && mod.author.toLowerCase().includes(filter))
  );
}
