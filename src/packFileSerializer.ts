import BinaryFile from "binary-file";
import {
  Field,
  FIELD_TYPE,
  FIELD_VALUE,
  Pack,
  PackedFile,
  SchemaField,
  SCHEMA_FIELD_TYPE,
} from "./packFileTypes";
import clone from "just-clone";
import { emptyMovie, introMoviePaths } from "./emptyMovie";
import { app } from "electron";
import * as path from "path";
import { Worker } from "worker_threads";
import { DBNameToDBVersions, schema } from "./schema";

// console.log(DBNameToDBVersions.land_units_officers_tables);

const string_schema = `{
    "units_custom_battle_permissions_tables": {
      "10": [
        ["faction", "StringU8", "1"],
        ["general_unit", "Boolean", "2"],
        ["unit", "StringU8", "0"],
        ["siege_unit_attacker", "Boolean", "3"],
        ["siege_unit_defender", "Boolean", "4"],
        ["general_portrait", "OptionalStringU8", "5"],
        ["general_uniform", "OptionalStringU8", "6"],
        ["set_piece_character", "OptionalStringU8", "7"],
        ["campaign_exclusive", "Boolean", "8"],
        ["armory_item_set", "OptionalStringU8", "9"]
      ]
    }}`;

const object_schema = JSON.parse(string_schema);
const latest_version = Object.keys(object_schema.units_custom_battle_permissions_tables).sort()[0];
const ver_schema = object_schema.units_custom_battle_permissions_tables[latest_version];

function getTypeSize(type: FIELD_TYPE, val: FIELD_VALUE = null): number {
  switch (type) {
    case "Int8":
    case "UInt8":
      {
        return 1;
      }
      break;
    case "Int16":
      {
        return 2;
      }
      break;
    case "String":
      {
        return (val as string).length;
      }
      break;
    case "F32":
      {
        return 4;
      }
      break;
    case "I32":
      {
        return 4;
      }
      break;
    case "I64":
      {
        return 8;
      }
      break;
    case "F64":
      {
        return 8;
      }
      break;
  }
}

function getDataSize(data: SchemaField[]): number {
  let size = 0;
  for (const field of data) {
    for (const value of field.fields) {
      size += getTypeSize(value.type, value.val);
    }
  }
  return size;
}

async function parseType(
  file: BinaryFile,
  type: SCHEMA_FIELD_TYPE,
  existingFields?: Field[]
): Promise<Field[]> {
  const fields: Field[] = existingFields || [];
  switch (type) {
    case "Boolean":
      {
        // console.log('boolean');
        const val = await file.readUInt8();
        fields.push({ type: "UInt8", val });
        return fields;
        // await outFile.writeInt8(newVal !== undefined ? newVal : val);
      }
      break;
    case "ColourRGB":
      {
        const val = await file.readInt32();
        fields.push({ type: "I32", val });
        return fields;
      }
      break;
    case "StringU16":
      {
        try {
          const length = await file.readInt16();
          const val = (await file.read(length * 2)).toString("utf8");
          fields.push({ type: "String", val });
          return fields;
        } catch (e) {
          console.log(e);
        }
      }
      break;
    case "StringU8":
      {
        const length = await file.readUInt16();
        const val = await file.readString(length);

        // console.log('string');
        // console.log('position is ' + file.tell());
        // const val = await read_string(file);

        // console.log(length);
        // console.log(val);
        fields.push({ type: "Int16", val: length });
        fields.push({ type: "String", val });
        return fields;
        // await outFile.writeString(val + '\0');
        // await outFile.writeInt16(length);
        // await outFile.writeString(val);
      }
      break;
    case "OptionalStringU8":
      {
        const doesExist = await file.readUInt8();
        fields.push({ type: "Int8", val: doesExist });
        if (doesExist === 1) return await parseType(file, "StringU8", fields);

        return fields;
      }
      break;
    case "F32":
      {
        const doesExist = await file.readFloat();
        fields.push({ type: "F32", val: doesExist });
        return fields;
      }
      break;
    case "I32":
      {
        const doesExist = await file.readInt32();
        fields.push({ type: "I32", val: doesExist });
        return fields;
      }
      break;
    case "F64":
      {
        const doesExist = await file.readDouble();
        fields.push({ type: "F64", val: doesExist });
        return fields;
      }
      break;
    case "I64":
      {
        const doesExist = await file.readInt64();
        fields.push({ type: "I64", val: doesExist });
        return fields;
      }
      break;
    default:
      console.log("NO WAY TO RESOLVE " + type);
      break;
  }
}

function parseTypeBuffer(
  buffer: Buffer,
  pos: number,
  type: SCHEMA_FIELD_TYPE,
  existingFields?: Field[]
): [Field[], number] {
  const fields: Field[] = existingFields || [];
  switch (type) {
    case "Boolean":
      {
        // console.log('boolean');
        const val = buffer.readUInt8(pos); //await file.readUInt8();
        pos += 1;
        fields.push({ type: "UInt8", val });
        return [fields, pos];
        // await outFile.writeInt8(newVal !== undefined ? newVal : val);
      }
      break;
    case "ColourRGB":
      {
        const val = buffer.readInt32LE(pos); // await file.readInt32();
        pos += 4;
        fields.push({ type: "I32", val });
        return [fields, pos];
      }
      break;
    case "StringU16":
      {
        try {
          const length = buffer.readInt16LE(pos); //await file.readInt16();
          pos += 2;
          const val = buffer.subarray(pos, pos + length * 2).toString("utf8"); //(await file.read(length * 2)).toString("utf8");
          pos += length * 2;
          fields.push({ type: "String", val });
          return [fields, pos];
        } catch (e) {
          console.log(e);
        }
      }
      break;
    case "StringU8":
      {
        const length = buffer.readUint16LE(pos); //await file.readUInt16();
        pos += 2;
        const val = buffer.subarray(pos, pos + length).toString("ascii"); //await file.readString(length);
        pos += length;

        // console.log('string');
        // console.log('position is ' + file.tell());
        // const val = await read_string(file);

        // console.log(length);
        // console.log(val);
        fields.push({ type: "Int16", val: length });
        fields.push({ type: "String", val });
        return [fields, pos];
        // await outFile.writeString(val + '\0');
        // await outFile.writeInt16(length);
        // await outFile.writeString(val);
      }
      break;
    case "OptionalStringU8":
      {
        const doesExist = buffer.readUint8(pos); // await file.readUInt8();
        pos += 1;
        fields.push({ type: "Int8", val: doesExist });
        if (doesExist === 1) {
          return parseTypeBuffer(buffer, pos, "StringU8", fields);
        }

        return [fields, pos];
      }
      break;
    case "F32":
      {
        const doesExist = buffer.readFloatLE(pos); //await file.readFloat();
        pos += 4;
        fields.push({ type: "F32", val: doesExist });
        return [fields, pos];
      }
      break;
    case "I32":
      {
        const doesExist = buffer.readInt32LE(pos); //await file.readInt32();
        pos += 4;
        fields.push({ type: "I32", val: doesExist });
        return [fields, pos];
      }
      break;
    case "F64":
      {
        const doesExist = buffer.readDoubleLE(pos); //await file.readDouble();
        pos += 8;
        fields.push({ type: "F64", val: doesExist });
        return [fields, pos];
      }
      break;
    case "I64":
      {
        const doesExist = Number(buffer.readBigInt64LE(pos)); //await file.readInt64();
        pos += 8;
        fields.push({ type: "I64", val: doesExist });
        return [fields, pos];
      }
      break;
    default:
      console.log("NO WAY TO RESOLVE " + type);
      break;
  }
}

const getGUID = () => {
  const genRanHex = (size: number) =>
    [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return [genRanHex(8), genRanHex(4), genRanHex(4), genRanHex(4), genRanHex(12)].join("-");
};

const createBattlePermissionsData = (packsData: Pack[], pack_files: PackedFile[], enabledMods: Mod[]) => {
  // console.log(packsData);
  // console.log(packsData.filter((packData) => packData == null));
  const battlePermissions = packsData
    .filter((packData) => enabledMods.find((enabledMod) => enabledMod.path === packData.path))
    .map((packData) => packData.packedFiles)
    .map((packedFiles) =>
      packedFiles.filter((packedFile) =>
        packedFile.name.startsWith("db\\units_custom_battle_permissions_tables\\")
      )
    )
    .reduce((previous, packedFile) => previous.concat(packedFile), []);

  const battlePermissionsSchemaFields = battlePermissions.reduce(
    (previous, packedFile) => previous.concat(packedFile.schemaFields),
    [] as SchemaField[]
  );
  pack_files.push({
    name: `db\\units_custom_battle_permissions_tables\\pj_fimir_test`,
    file_size: getDataSize(battlePermissionsSchemaFields) + 91,
    start_pos: 0,
    // is_compressed: 0,
    schemaFields: battlePermissionsSchemaFields,
    version: 10,
    guid: getGUID(),
  });
};

const createIntroMoviesData = (pack_files: PackedFile[]) => {
  for (const moviePath of introMoviePaths) {
    pack_files.push({
      name: moviePath,
      file_size: emptyMovie.length,
      start_pos: 0,
      // is_compressed: 0,
      schemaFields: [{ type: "Buffer", fields: [{ type: "Buffer", val: emptyMovie }] }],
      version: undefined,
      guid: undefined,
    } as PackedFile);
  }
};

const getDBName = (packFile: PackedFile) => {
  const dbNameMatch = packFile.name.match(/db\\(.*?)\\/);
  if (dbNameMatch == null) return;
  const dbName = dbNameMatch[1];
  return dbName;
};

const getDBVersion = (packFile: PackedFile) => {
  const dbName = getDBName(packFile);
  const dbversions = DBNameToDBVersions[dbName];
  if (!dbversions) return;

  const dbversion = dbversions.find((dbversion) => dbversion.version == packFile.version) || dbversions[0];
  if (!dbversion) return;
  if (dbversion.version < packFile.version) return;
  return dbversion;
};

const createScriptLoggingData = (pack_files: PackedFile[]) => {
  pack_files.push({
    name: "script\\enable_console_logging",
    file_size: 1,
    start_pos: 0,
    is_compressed: 0,
    schemaFields: [{ type: "Buffer", fields: [{ type: "Buffer", val: Buffer.from([0x00]) }] }],
    version: undefined,
    guid: undefined,
  } as PackedFile);
};

export const writePack = async (
  packsData: Pack[],
  path: string,
  enabledMods: Mod[],
  startGameOptions: StartGameOptions
) => {
  let outFile: BinaryFile;
  try {
    const header = "PFH5";
    const byteMask = 3;
    const refFileCount = 0;
    const pack_file_index_size = 0;

    const packFiles: PackedFile[] = [];

    if (startGameOptions.isMakeUnitsGeneralsEnabled)
      createBattlePermissionsData(packsData, packFiles, enabledMods);
    if (startGameOptions.isSkipIntroMoviesEnabled) createIntroMoviesData(packFiles);
    if (startGameOptions.isScriptLoggingEnabled) createScriptLoggingData(packFiles);

    if (packFiles.length < 1) return;

    outFile = new BinaryFile(path, "w", true);
    await outFile.open();
    await outFile.writeString(header);
    await outFile.writeInt32(byteMask);
    await outFile.writeInt32(refFileCount);
    await outFile.writeInt32(pack_file_index_size);

    await outFile.writeInt32(packFiles.length);

    const index_size = packFiles.reduce((acc, pack) => acc + pack.name.length + 1 + 5, 0);
    await outFile.writeInt32(index_size);
    await outFile.writeInt32(0x7fffffff); // header_buffer

    for (const packFile of packFiles) {
      // const { name, file_size, start_pos, is_compressed } = packFile;
      const { name, file_size, start_pos } = packFile;
      // console.log("file size is " + file_size);
      await outFile.writeInt32(file_size);
      // await outFile.writeInt8(is_compressed);
      await outFile.writeInt8(0);
      await outFile.writeString(name + "\0");
    }

    for (const packFile of packFiles) {
      if (packFile.guid != null) {
        const guid = packFile.guid;
        // console.log("guid is " + guid);
        await outFile.write(Buffer.from([0xfd, 0xfe, 0xfc, 0xff])); // guid marker
        await outFile.writeInt16(guid.length);
        const twoByteGUID = guid
          .split("")
          .map((str) => str + "\0")
          .join("");
        // console.log(twoByteGUID);
        await outFile.write(Buffer.from(twoByteGUID, "utf-8"));
      }

      if (packFile.version != null) {
        // console.log(packFile.version);
        await outFile.write(Buffer.from([0xfc, 0xfd, 0xfe, 0xff])); // version marker
        await outFile.writeInt32(packFile.version); // db version
        await outFile.writeInt8(1);

        // console.log("NUM OF FIELDS:");
        // console.log(packFile.schemaFields.length / ver_schema.length);
        await outFile.writeInt32(packFile.schemaFields.length / ver_schema.length);
      }

      let general_unit_index = null;
      let dbVersionNumFields = null;
      if (getDBName(packFile) === "units_custom_battle_permissions_tables") {
        const dbVersion = getDBVersion(packFile);
        general_unit_index = dbVersion.fields.findIndex((field) => field.name == "general_unit");
        dbVersionNumFields = dbVersion.fields.length;
      }

      // console.log(general_unit_index);
      // console.log(dbVersionNumFields);

      for (let i = 0; i < packFile.schemaFields.length; i++) {
        const field = packFile.schemaFields[i];
        if (
          general_unit_index != null &&
          dbVersionNumFields != null &&
          i % dbVersionNumFields == general_unit_index
        ) {
          // console.log("FOUND GENERAL UNIT INDEX");
          // console.log(field.name);
          const newField = clone(field);
          newField.fields[0].val = 1;
          await writeField(outFile, newField);
        } else {
          // console.log(field.name);
          await writeField(outFile, field);
        }
      }
    }
  } catch (e) {
    console.log(e);
  } finally {
    await outFile.close();
  }
};

const writeField = async (file: BinaryFile, schemaField: SchemaField) => {
  // console.log(field);
  for (const field of schemaField.fields) {
    switch (field.type) {
      case "Int8":
        {
          await file.writeInt8(field.val as number);
        }
        break;
      case "Int16":
        {
          await file.writeUInt16(field.val as number);
        }
        break;
      case "String":
        {
          await file.writeString(field.val as string);
        }
        break;
      case "UInt8":
        {
          await file.writeUInt8(field.val as number);
        }
        break;
      case "Buffer":
        {
          await file.write(field.val as Buffer);
        }
        break;
    }
  }
};

const readUTFString = async (fileIn: BinaryFile) => {
  const length = await fileIn.readInt16();
  // console.log('length is ' + length);
  // since utf8 is 2 bytes per char
  return (await fileIn.read(length * 2)).toString("utf8");
};

const readUTFStringFromBuffer = (buffer: Buffer, pos: number): [string, number] => {
  const length = buffer.readInt16LE(pos);
  pos += 2;
  // console.log('length is ' + length);
  // since utf8 is 2 bytes per char
  return [buffer.subarray(pos, pos + length * 2).toString("utf8"), pos + length * 2];
};

export const getPacksInSave = async (saveName: string): Promise<string[]> => {
  console.log("Getting packs from save: ", saveName);
  const appDataPath = app.getPath("appData");
  const savePath = path.join(appDataPath, "The Creative Assembly/Warhammer3/save_games/", saveName);

  let file: BinaryFile;
  try {
    file = new BinaryFile(savePath, "r", true);
    await file.open();
    const header = await file.read(await file.size());
    const utf = header.toString("utf8");
    const ascii = header.toString("ascii");

    console.log(utf.match(/\0.*?pack/g).length);
    return ascii.match(/\0[^\0]+?\.pack/g).map((match) => match.replace("\0", ""));
  } catch (err) {
    console.log(err);
  }

  return [];
};

let toRead: Mod[];

export const readPack = async (modName: string, modPath: string): Promise<Pack> => {
  const pack_files: PackedFile[] = [];

  let file: BinaryFile;
  try {
    file = new BinaryFile(modPath, "r", true);
    await file.open();

    // console.log(`${modPath} file opened`);

    const header = await file.read(4);
    if (header === null) throw new Error("header missing");

    const byteMask = await file.readInt32();
    const refFileCount = await file.readInt32();
    const pack_file_index_size = await file.readInt32();
    const pack_file_count = await file.readInt32();
    const packed_file_index_size = await file.readInt32();

    // console.log(`header is ${header}`);
    // console.log(`byteMask is ${byteMask}`);
    // console.log(`refFileCount is ${refFileCount}`);
    // console.log(`pack_file_index_size is ${pack_file_index_size}`);
    // console.log(`pack_file_count is ${pack_file_count}`);
    // console.log(`packed_file_index_size is ${packed_file_index_size}`);

    const header_buffer_len = 4;
    await file.readInt32(); // header_buffer

    const dataStart = 24 + header_buffer_len + pack_file_index_size + packed_file_index_size;
    // console.log("data starts at " + dataStart);

    let chunk;
    let file_pos = dataStart;

    // let terminatorIndex = -1;

    const headerSize = dataStart - file.tell();
    const headerBuffer = await file.read(headerSize);

    // console.log("header size is: " + headerSize);

    // console.time("1000files");
    let bufPos = 0;
    // console.log("pack_file_count is " + pack_file_count);
    for (let i = 0; i < pack_file_count; i++) {
      let name = "";

      const file_size = headerBuffer.readInt32LE(bufPos);
      bufPos += 4;
      const is_compressed = headerBuffer.readInt8(bufPos);
      bufPos += 1;
      // const file_size = (stream.read(4) as Buffer).readInt32LE();
      // const is_compressed = (stream.read(1) as Buffer).readInt8();

      const nameStartPos = bufPos;
      while (null !== (chunk = headerBuffer.readInt8(bufPos))) {
        bufPos += 1;
        // terminatorIndex = chunk.indexOf(stringTerminator);
        if (chunk == 0) {
          // chunks.push(chunk.subarray(0, terminatorIndex + 1));
          // name = Buffer.concat(chunks).toString("ascii");

          // chunks = [];
          // file.seek(file.tell() - (chunk.length - terminatorIndex));
          // chunks.push(chunk.subarray(terminatorIndex, chunk.length + 1));

          // console.log(String.fromCharCode(headerBuffer.readInt16BE(bufPos)));
          // console.log(String.fromCharCode(headerBuffer.readInt16LE(bufPos)));

          // console.log(Buffer.from([0xe9, 0x9c, 0x87]).toString("utf8"));
          // console.log(Buffer.from([0x87, 0x9c, 0xe9]).toString("utf8"));
          // console.log(headerBuffer.toString("utf8", nameStartPos, bufPos - 1));
          // console.log(headerBuffer.subarray(nameStartPos, bufPos-1).length);

          name = headerBuffer.toString("utf8", nameStartPos, bufPos - 1);
          break;
        }
        // chunks.push(chunk);
        // name += chunk;
        // console.log(`Read ${chunk.length} bytes of data...`);
      }

      // if (name.startsWith("db")) {
      //   console.log(name);
      // }

      // if (i === 1000) {
      // console.log(console.timeEnd("1000files"));
      // }
      // console.log("name is " + name);
      //   console.log("file_size is " + file_size);

      pack_files.push({
        name,
        file_size,
        start_pos: file_pos,
        // is_compressed,
        schemaFields: [],
        version: undefined,
        guid: undefined,
      });
      file_pos += file_size;
    }

    // console.log("num pack files: " + pack_files.length);

    // console.log("DONE READING FILE");

    // pack_files.forEach((pack_file) => {
    //   const db_name = pack_file.name.match(/db\\(.*?)\\/);
    //   if (db_name != null) {
    //     console.log(db_name);
    //     // console.log(pack_file.name);
    //   }
    // });

    // const battle_permissions = pack_files.filter((pack) =>
    //   pack.name.startsWith("db\\units_custom_battle_permissions_tables")
    // );

    const dbPackFiles = pack_files.filter((packFile) => {
      const dbNameMatch = packFile.name.match(/db\\(.*?)\\/);
      return dbNameMatch != null && dbNameMatch[1];
    });

    if (dbPackFiles.length < 1) return;

    const startPos = dbPackFiles.reduce(
      (previous, current) => (previous < current.start_pos ? previous : current.start_pos),
      Number.MAX_SAFE_INTEGER
    );

    const startOfLastPack = dbPackFiles.reduce(
      (previous, current) => (previous > current.start_pos ? previous : current.start_pos),
      -1
    );
    const endPos =
      dbPackFiles.find((packFile) => packFile.start_pos === startOfLastPack).file_size + startOfLastPack;
    // console.log("endPos is ", endPos);

    const buffer = await file.read(endPos - startPos, startPos);

    let currentPos = 0;
    for (const pack_file of pack_files) {
      if (modName == "data.pack" && !pack_file.name.includes("\\units_custom_battle_permissions_tables\\"))
        continue;
      if (!dbPackFiles.find((iterPackFile) => iterPackFile === pack_file)) continue;
      currentPos = pack_file.start_pos - startPos;
      // console.log(currentPos);

      const dbNameMatch = pack_file.name.match(/db\\(.*?)\\/);
      if (dbNameMatch == null) continue;
      const dbName = dbNameMatch[1];
      if (dbName == null) continue;

      const dbversions = DBNameToDBVersions[dbName];
      if (!dbversions) continue;

      // console.log(pack_file);

      let version: number = null;
      for (;;) {
        const marker = await buffer.subarray(currentPos, currentPos + 4);
        currentPos += 4;

        if (marker.toString("hex") === "fdfefcff") {
          const readUTF = readUTFStringFromBuffer(buffer, currentPos);
          // console.log("guid is " + readUTF[0]);
          pack_file.guid = readUTF[0];
          currentPos = readUTF[1];
        } else if (marker.toString("hex") === "fcfdfeff") {
          // console.log("found version marker");
          version = buffer.readInt32LE(currentPos); // await file.readInt32();
          currentPos += 4;

          pack_file.version = version;
          // await file.read(1);
          currentPos += 1;
        } else {
          // console.log(marker.toString("hex"));
          currentPos -= 4;
          // file.seek(file.tell() - 4);
          break;
        }
        // if (pack_file.name === "db\\character_skill_nodes_tables\\mixu_ll_empire") {
        // console.log(pack_file.name);
        // console.log(dbName);
        // console.log(file.tell());
        // console.log(dbName);
        // console.log(marker);
        // console.log("-------------------");
        // }
      }

      // if (version == null) {
      //   console.log("version is", version);
      //   console.log(pack_file.guid);
      //   console.log(pack_file.name);
      //   console.log(pack_file.start_pos);
      // }

      if (version == null) continue;
      const dbversion = dbversions.find((dbversion) => dbversion.version == version) || dbversions[0];
      if (!dbversion) continue;
      if (dbversion.version < version) continue;

      const entryCount = buffer.readInt32LE(currentPos); //await file.readInt32();
      currentPos += 4;
      // console.log("entry count is " + entryCount);
      // console.log("pos is " + file.tell());

      // console.log(dbName);
      // outFile.seek(file.tell());
      for (let i = 0; i < entryCount; i++) {
        for (const field of dbversion.fields) {
          const { name, field_type, is_key } = field;
          // console.log(name);
          // console.log(field_type);

          // if (name === 'general_unit') console.log("it's a general");
          // console.log("pos is " + outFile.tell());
          // console.log('i is ' + i);
          // const fields = await parseType(file, field_type);
          const fieldsRet = await parseTypeBuffer(buffer, currentPos, field_type);
          const fields = fieldsRet[0];
          currentPos = fieldsRet[1];

          if (!fields[1] && !fields[0]) {
            console.log(name);
            console.log(field_type);
          }
          if (fields[0].val == undefined) {
            console.log(name);
            console.log(field_type);
          }
          if (fields.length == 0) {
            console.log(name);
            console.log(field_type);
          }

          const schemaField: SchemaField = {
            // name,
            type: field_type,
            fields,
            // isKey: is_key,
            // resolvedKeyValue: (is_key && fields[1] && fields[1].val.toString()) || fields[0].val.toString(),
          };
          if (is_key) schemaField.isKey = true;
          pack_file.schemaFields.push(schemaField);
        }
      }
    }
  } catch (e) {
    console.log(e);
  } finally {
    await file.close();
  }

  // console.log("read " + modName);
  // const mod = toRead.find((iterMod) => modName === iterMod.name);
  // if (mod) {
  //   toRead.splice(toRead.indexOf(mod), 1);
  // }
  // console.log(toRead.map((mod) => mod.name));

  return { name: modName, path: modPath, packedFiles: pack_files } as Pack;
};

export const readPackData = async (mods: Mod[]) => {
  // console.log("READ PACKS STARTED");
  // mods = mods.filter((mod) => mod.name === "!!pj_test1.pack" || mod.name === "!!pj_test1_dupe.pack");
  // mods = mods.filter((mod) => mod.name === "!!pj_test1.pack");
  // mods = mods.filter((mod) => mod.name === "cthdwf.pack");
  // mods = mods.filter((mod) => mod.name != "data.pack");

  toRead = [...mods];

  // return (
  //   await new Promise<{ newPacksData: Pack[] }>((resolve, reject) => {
  //     const worker = new Worker(path.join(__dirname, "readPacksWorker.js"), { workerData: { mods, schema } });
  //     worker.on("message", resolve);
  //     worker.on("error", reject);
  //     worker.on("exit", (code) => {
  //       if (code !== 0) reject(new Error(`Stopped with  ${code} exit code`));
  //     });
  //   })
  // ).newPacksData;

  try {
    const packFieldsPromises = mods.map((mod) => {
      return readPack(mod.name, mod.path);
    });

    console.time("readPacks");
    const packFieldsSettled = await Promise.allSettled(packFieldsPromises);
    const newPacksData = (
      packFieldsSettled.filter((pfs) => pfs.status === "fulfilled") as PromiseFulfilledResult<Pack>[]
    )
      .map((r) => r.value)
      .filter((packData) => packData);
    console.timeEnd("readPacks"); //26.580s

    console.log("READ PACKS DONE");
    return newPacksData;
  } catch (e) {
    console.log(e);
  }

  // console.log("num conflicts: " + num_conf);

  // console.log("num packs: " + packsData.length);
};
