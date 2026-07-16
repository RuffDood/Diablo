'use strict';

// Consolide le stockage des cles et organes du Pandemonium :
//   - pk1 (Pandemonium Key) = 1 point de cle
//   - dhn (Demon's Ear) = 1 point d'organe
//   - y42/y45 sont les deux seuls removers actifs, vendus par Akara

const fs = require('fs');
const path = require('path');
const {
  parseTable,
  serializeTable,
  writeTable,
  ENCODING,
} = require('./tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK_ONLY = process.argv.includes('--check');
const BATCH_MAX = 10;

const FILES = {
  cube: path.join(ROOT, 'data-TCP', 'global', 'excel', 'cubemain.txt'),
  misc: path.join(ROOT, 'data-TCP', 'global', 'excel', 'misc.txt'),
  treasure: path.join(ROOT, 'data-TCP', 'global', 'excel', 'treasureclassex.txt'),
  itemNames: path.join(ROOT, 'data-TCP', 'local', 'lng', 'strings', 'item-names.json'),
};

const KEY = {
  itemCode: 'pk1',
  itemName: 'Pandemonium Key',
  removerCode: 'y42',
  removerName: 'Pandemonium Key Remover',
  property: 'KB-Terror',
  statId: 365,
  statStringKey: 'KBTerror',
  statStringId: 50050,
  statDisplay: 'ÿc;Keys\nÿc4Pandemonium Keys:ÿc3',
  removerDisplay: 'ÿc7(withdraws 1 stored key)\nÿc7Pandemonium Key ÿc4Removerÿc3',
  legacyRemovers: ['y43', 'y44'],
};

const ORGAN = {
  itemCode: 'dhn',
  itemName: "Demon's Ear",
  removerCode: 'y45',
  removerName: "Demon's Ear Remover",
  property: 'OB-Diablo',
  statId: 368,
  statStringKey: 'OBDiablo',
  statStringId: 50053,
  statDisplay: "ÿc;Organs\nÿc4Demon's Ears:ÿc3",
  removerDisplay: "ÿc7(withdraws 1 stored organ)\nÿc7Demon's Ear ÿc4Removerÿc3",
  legacyRemovers: ['y46', 'y47'],
};

const LEGACY_KEY_DISPLAY = 'ÿc7(cube alone to convert)\nÿc7Legacy Key ÿc4Removerÿc3';
const LEGACY_ORGAN_DISPLAY = 'ÿc7(cube alone to convert)\nÿc7Legacy Organ ÿc4Removerÿc3';

function fail(message) {
  throw new Error(message);
}

function indexHeaders(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function tableObject(table, row) {
  return Object.fromEntries(table.headers.map((header, index) => [header, row[index] ?? '']));
}

function createRow(table, values) {
  const indexes = indexHeaders(table.headers);
  const row = Array(table.headers.length).fill('');
  for (const [header, value] of Object.entries(values)) {
    if (!(header in indexes)) fail(`Colonne absente de ${values.description || 'la recette'} : ${header}`);
    row[indexes[header]] = String(value);
  }
  if ('*eol' in indexes) row[indexes['*eol']] = '0';
  return row;
}

function replaceMatchingRows(table, predicate, replacement, label) {
  const indexes = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    if (predicate(table.rows[index])) indexes.push(index);
  }
  if (!indexes.length) fail(`Bloc ${label} introuvable`);
  const first = indexes[0];
  table.rows = table.rows.filter((row) => !predicate(row));
  table.rows.splice(first, 0, ...replacement);
}

function quantityInput(code, quantity) {
  return quantity === 1 ? code : `"${code},qty=${quantity}"`;
}

function buildDepositRecipes(cube, resource, singularDescription) {
  const rows = [];
  for (let quantity = 1; quantity <= BATCH_MAX; quantity += 1) {
    rows.push(createRow(cube, {
      description: `Add ${singularDescription}${quantity === 1 ? '' : ` x${quantity}`}`,
      enabled: 1,
      version: 100,
      numinputs: quantity + 1,
      'input 1': 'y01',
      'input 2': quantityInput(resource.itemCode, quantity),
      output: 'useitem',
      'mod 1': resource.property,
      'mod 1 min': quantity,
      'mod 1 max': quantity,
    }));
  }
  return rows;
}

function buildWithdrawalRecipe(cube, resource, description) {
  return createRow(cube, {
    description,
    enabled: 1,
    version: 100,
    op: 15,
    param: resource.statId,
    value: 1,
    numinputs: 2,
    'input 1': 'y01',
    'input 2': resource.removerCode,
    output: 'useitem',
    'mod 1': resource.property,
    'mod 1 min': -1,
    'mod 1 max': -1,
    'output b': resource.removerCode,
    'output c': resource.itemCode,
  });
}

function buildLegacyRemoverConversions(cube, resource, kind) {
  return resource.legacyRemovers.map((legacyCode) => createRow(cube, {
    description: `Convert Legacy ${kind} Remover ${legacyCode}`,
    enabled: 1,
    version: 100,
    numinputs: 1,
    'input 1': legacyCode,
    output: resource.removerCode,
  }));
}

function generateCube(cube) {
  const indexes = indexHeaders(cube.headers);
  const description = (row) => row[indexes.description] || '';

  const isKeyStorage = (row) => {
    const value = description(row);
    return /^Add Key - /.test(value)
      || /^Add Pandemonium Key(?: x\d+)?$/.test(value)
      || /^Remove Key - /.test(value)
      || value === 'Withdraw Pandemonium Key'
      || /^Key Cycle - /.test(value)
      || /^Convert Legacy Key Remover /.test(value);
  };
  const isOrganStorage = (row) => {
    const value = description(row);
    return /^Add Organ - /.test(value)
      || /^Add Demon's Ear(?: x\d+)?$/.test(value)
      || /^Remove Organ - /.test(value)
      || value === "Withdraw Demon's Ear"
      || /^Organ Cycle - /.test(value)
      || /^Convert Legacy Organ Remover /.test(value);
  };

  replaceMatchingRows(cube, isKeyStorage, [
    ...buildDepositRecipes(cube, KEY, 'Pandemonium Key'),
    buildWithdrawalRecipe(cube, KEY, 'Withdraw Pandemonium Key'),
    ...buildLegacyRemoverConversions(cube, KEY, 'Key'),
  ], 'stockage des Pandemonium Keys');

  replaceMatchingRows(cube, isOrganStorage, [
    ...buildDepositRecipes(cube, ORGAN, "Demon's Ear"),
    buildWithdrawalRecipe(cube, ORGAN, "Withdraw Demon's Ear"),
    ...buildLegacyRemoverConversions(cube, ORGAN, 'Organ'),
  ], "stockage des Demon's Ears");
}

function vendorHeaders(headers) {
  const pattern = /^(?:Charsi|Gheed|Akara|Fara|Lysander|Drognan|Hratli|Alkor|Ormus|Elzix|Asheara|Cain|Halbu|Malah|Larzuk|Anya|Jamella)(?:Magic)?(?:Min|Max)$/;
  return headers.filter((header) => pattern.test(header));
}

function generateMisc(misc) {
  const indexes = indexHeaders(misc.headers);
  const rowsByCode = new Map(misc.rows.map((row) => [row[indexes.code], row]));
  const vendors = vendorHeaders(misc.headers);

  for (const resource of [KEY, ORGAN]) {
    const item = rowsByCode.get(resource.itemCode);
    if (!item) fail(`Objet canonique ${resource.itemCode} absent de misc.txt`);
    item[indexes.name] = resource.itemName;

    const remover = rowsByCode.get(resource.removerCode);
    if (!remover) fail(`Remover canonique ${resource.removerCode} absent de misc.txt`);
    remover[indexes.name] = resource.removerName;
    remover[indexes.spawnable] = '1';
    for (const header of vendors) remover[indexes[header]] = '';
    remover[indexes.AkaraMin] = '1';
    remover[indexes.AkaraMax] = '1';

    for (const legacyCode of resource.legacyRemovers) {
      const legacy = rowsByCode.get(legacyCode);
      if (!legacy) fail(`Remover legacy ${legacyCode} absent de misc.txt`);
      legacy[indexes.name] = `Legacy ${resource === KEY ? 'Key' : 'Organ'} Remover`;
      legacy[indexes.spawnable] = '0';
      for (const header of vendors) legacy[indexes[header]] = '';
    }
  }
}

function readJsonDocument(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return {
    raw,
    data: JSON.parse(raw),
    eol,
    hasFinalEol: raw.endsWith(eol),
  };
}

function serializeJsonDocument(document) {
  let output = JSON.stringify(document.data, null, 2).replace(/\n/g, document.eol);
  if (document.hasFinalEol) output += document.eol;
  return output;
}

function writeJsonDocument(filePath, document) {
  const output = serializeJsonDocument(document);
  if (output === document.raw) return false;
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, output, 'utf8');
  fs.renameSync(temporary, filePath);
  return true;
}

function setAllLocales(entry, value) {
  for (const field of Object.keys(entry)) {
    if (field !== 'id' && field !== 'Key') entry[field] = value;
  }
}

function ensureStringEntry(document, key, id, templateKey) {
  const entries = document.data;
  let entry = entries.find((candidate) => candidate.Key === key);
  if (entry) return entry;

  const collision = entries.find((candidate) => Number(candidate.id) === Number(id));
  if (collision) fail(`Collision d'ID string ${id} avec ${collision.Key}`);
  const template = entries.find((candidate) => candidate.Key === templateKey);
  if (!template) fail(`Template string ${templateKey} absent`);
  entry = { ...template, id, Key: key };
  entries.push(entry);
  return entry;
}

function generateItemNames(document) {
  if (!Array.isArray(document.data)) fail('item-names.json doit etre un tableau');
  const byKey = new Map(document.data.map((entry) => [entry.Key, entry]));

  for (const resource of [KEY, ORGAN]) {
    const item = byKey.get(resource.itemCode);
    if (!item) fail(`String objet ${resource.itemCode} absente`);
    setAllLocales(item, resource.itemName);

    const remover = byKey.get(resource.removerCode);
    if (!remover) fail(`String remover ${resource.removerCode} absente`);
    setAllLocales(remover, resource.removerDisplay);

    const legacyDisplay = resource === KEY ? LEGACY_KEY_DISPLAY : LEGACY_ORGAN_DISPLAY;
    for (const legacyCode of resource.legacyRemovers) {
      const legacy = byKey.get(legacyCode);
      if (!legacy) fail(`String remover legacy ${legacyCode} absente`);
      setAllLocales(legacy, legacyDisplay);
    }

    const stat = ensureStringEntry(
      document,
      resource.statStringKey,
      resource.statStringId,
      resource.removerCode,
    );
    setAllLocales(stat, resource.statDisplay);
  }
}

function writeTableIfChanged(filePath, table) {
  const before = fs.readFileSync(filePath, ENCODING);
  const after = serializeTable(table);
  if (before === after) return false;
  writeTable(filePath, table);
  return true;
}

function expectSingle(rows, predicate, label) {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) fail(`${label} : ${matches.length} occurrence(s), attendu 1`);
  return matches[0];
}

function assertFields(row, expected, label) {
  for (const [field, value] of Object.entries(expected)) {
    if (String(row[field]) !== String(value)) {
      fail(`${label} : ${field}=${JSON.stringify(row[field])}, attendu ${JSON.stringify(String(value))}`);
    }
  }
}

function validateResourceRecipes(cubeRows, resource, singularDescription, withdrawalDescription) {
  const deposits = cubeRows.filter((row) => row.description === `Add ${singularDescription}`
    || row.description.startsWith(`Add ${singularDescription} x`));
  if (deposits.length !== BATCH_MAX) {
    fail(`${singularDescription} : ${deposits.length} recettes de depot, attendu ${BATCH_MAX}`);
  }

  for (let quantity = 1; quantity <= BATCH_MAX; quantity += 1) {
    const label = `Add ${singularDescription}${quantity === 1 ? '' : ` x${quantity}`}`;
    const deposit = expectSingle(deposits, (row) => row.description === label, label);
    assertFields(deposit, {
      enabled: 1,
      version: 100,
      numinputs: quantity + 1,
      'input 1': 'y01',
      'input 2': quantityInput(resource.itemCode, quantity),
      output: 'useitem',
      'mod 1': resource.property,
      'mod 1 min': quantity,
      'mod 1 max': quantity,
    }, label);
  }

  const withdrawal = expectSingle(
    cubeRows,
    (row) => row.description === withdrawalDescription,
    withdrawalDescription,
  );
  assertFields(withdrawal, {
    enabled: 1,
    version: 100,
    op: 15,
    param: resource.statId,
    value: 1,
    numinputs: 2,
    'input 1': 'y01',
    'input 2': resource.removerCode,
    output: 'useitem',
    'mod 1': resource.property,
    'mod 1 min': -1,
    'mod 1 max': -1,
    'output b': resource.removerCode,
    'output c': resource.itemCode,
  }, withdrawalDescription);

  for (const legacyCode of resource.legacyRemovers) {
    const kind = resource === KEY ? 'Key' : 'Organ';
    const label = `Convert Legacy ${kind} Remover ${legacyCode}`;
    const conversion = expectSingle(cubeRows, (row) => row.description === label, label);
    assertFields(conversion, {
      enabled: 1,
      version: 100,
      numinputs: 1,
      'input 1': legacyCode,
      output: resource.removerCode,
    }, label);
  }
}

function validate() {
  const cube = parseTable(FILES.cube);
  const misc = parseTable(FILES.misc);
  const treasure = parseTable(FILES.treasure);
  const itemNames = readJsonDocument(FILES.itemNames);

  for (const [label, table] of Object.entries({ cube, misc, treasure })) {
    const invalid = table.rows.filter((row) => row.length !== table.headers.length);
    if (invalid.length) fail(`${label} : ${invalid.length} ligne(s) de largeur invalide`);
  }
  if (cube.eol !== '\r\n' || misc.eol !== '\r\n' || treasure.eol !== '\r\n') {
    fail('Les tables TCP cubemain/misc/treasureclassex doivent rester en CRLF');
  }
  if (itemNames.eol !== '\n') fail('item-names.json doit respecter le LF defini par .gitattributes');
  if (fs.readFileSync(FILES.cube, ENCODING) !== serializeTable(cube)) fail('cubemain.txt echoue le round-trip byte-exact');
  if (fs.readFileSync(FILES.misc, ENCODING) !== serializeTable(misc)) fail('misc.txt echoue le round-trip byte-exact');
  if (fs.readFileSync(FILES.treasure, ENCODING) !== serializeTable(treasure)) fail('treasureclassex.txt echoue le round-trip byte-exact');
  if (itemNames.raw !== serializeJsonDocument(itemNames)) fail('item-names.json echoue le round-trip JSON exact');

  const cubeRows = cube.rows.map((row) => tableObject(cube, row));
  validateResourceRecipes(cubeRows, KEY, 'Pandemonium Key', 'Withdraw Pandemonium Key');
  validateResourceRecipes(cubeRows, ORGAN, "Demon's Ear", "Withdraw Demon's Ear");

  const obsoleteDescriptions = cubeRows.filter((row) => /^(?:Add|Remove) (?:Key|Organ) - |^(?:Key|Organ) Cycle - /.test(row.description));
  if (obsoleteDescriptions.length) {
    fail(`Recettes legacy actives encore presentes : ${obsoleteDescriptions.map((row) => row.description).join(', ')}`);
  }
  const obsoleteProperties = new Set(['KB-Hate', 'KB-Dest', 'OB-Baal', 'OB-Meph']);
  const obsoletePropertyRows = cubeRows.filter((row) => obsoleteProperties.has(row['mod 1']));
  if (obsoletePropertyRows.length) {
    fail(`Anciens compteurs encore modifies : ${obsoletePropertyRows.map((row) => row.description).join(', ')}`);
  }

  const miscIndexes = indexHeaders(misc.headers);
  const rowsByCode = new Map(misc.rows.map((row) => [row[miscIndexes.code], row]));
  const vendors = vendorHeaders(misc.headers);
  for (const resource of [KEY, ORGAN]) {
    const item = rowsByCode.get(resource.itemCode);
    if (!item || item[miscIndexes.name] !== resource.itemName) {
      fail(`Nom misc invalide pour ${resource.itemCode}`);
    }
    const remover = rowsByCode.get(resource.removerCode);
    if (!remover) fail(`Remover ${resource.removerCode} absent`);
    if (remover[miscIndexes.name] !== resource.removerName || remover[miscIndexes.spawnable] !== '1') {
      fail(`Definition misc invalide pour ${resource.removerCode}`);
    }
    for (const header of vendors) {
      const expected = header === 'AkaraMin' || header === 'AkaraMax' ? '1' : '';
      if (remover[miscIndexes[header]] !== expected) {
        fail(`${resource.removerCode} : ${header}=${JSON.stringify(remover[miscIndexes[header]])}, attendu ${JSON.stringify(expected)}`);
      }
    }
    for (const legacyCode of resource.legacyRemovers) {
      const legacy = rowsByCode.get(legacyCode);
      if (!legacy || legacy[miscIndexes.spawnable] !== '0') fail(`Remover legacy ${legacyCode} encore actif`);
      for (const header of vendors) {
        if (legacy[miscIndexes[header]] !== '') fail(`Remover legacy ${legacyCode} encore vendu via ${header}`);
      }
    }
  }

  const entries = itemNames.data;
  const ids = entries.map((entry) => Number(entry.id));
  const keys = entries.map((entry) => entry.Key);
  if (new Set(ids).size !== ids.length) fail('IDs dupliques dans item-names.json');
  if (new Set(keys).size !== keys.length) fail('Keys dupliquees dans item-names.json');
  for (const resource of [KEY, ORGAN]) {
    const expectedStrings = new Map([
      [resource.itemCode, resource.itemName],
      [resource.removerCode, resource.removerDisplay],
      [resource.statStringKey, resource.statDisplay],
    ]);
    for (const legacyCode of resource.legacyRemovers) {
      expectedStrings.set(legacyCode, resource === KEY ? LEGACY_KEY_DISPLAY : LEGACY_ORGAN_DISPLAY);
    }
    for (const [key, display] of expectedStrings) {
      const entry = expectSingle(entries, (candidate) => candidate.Key === key, `String ${key}`);
      for (const [field, value] of Object.entries(entry)) {
        if (field !== 'id' && field !== 'Key' && value !== display) {
          fail(`String ${key}/${field} invalide`);
        }
      }
    }
  }

  const treasureRows = treasure.rows.map((row) => tableObject(treasure, row));
  const expectedDrops = new Map([
    ['Pandemonium Key A', 'pk1'],
    ['Pandemonium Key B', 'pk1'],
    ['Pandemonium Key C', 'pk1'],
    ['Uber Andariel', 'dhn'],
    ['Uber Duriel', 'dhn'],
    ['Uber Izual', 'dhn'],
  ]);
  for (const [treasureClass, itemCode] of expectedDrops) {
    const row = expectSingle(treasureRows, (candidate) => candidate['Treasure Class'] === treasureClass, treasureClass);
    if (!Object.values(row).includes(itemCode)) fail(`${treasureClass} ne donne pas ${itemCode}`);
  }

  return {
    keyDeposits: BATCH_MAX,
    organDeposits: BATCH_MAX,
    activeRemovers: [KEY.removerCode, ORGAN.removerCode],
    legacyConversions: KEY.legacyRemovers.length + ORGAN.legacyRemovers.length,
  };
}

function main() {
  if (!CHECK_ONLY) {
    const cube = parseTable(FILES.cube);
    const misc = parseTable(FILES.misc);
    const itemNames = readJsonDocument(FILES.itemNames);
    generateCube(cube);
    generateMisc(misc);
    generateItemNames(itemNames);
    writeTableIfChanged(FILES.cube, cube);
    writeTableIfChanged(FILES.misc, misc);
    writeJsonDocument(FILES.itemNames, itemNames);
  }

  const report = validate();
  console.log(`${CHECK_ONLY ? 'VALID' : 'UPDATED'} pandemonium-storage ${JSON.stringify(report)}`);
}

main();
