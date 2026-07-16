'use strict';

// Génère et valide le système de stockage des gems du Storage Bag.
//
// Barème : Chipped=1, Flawed=3, Standard=9, Flawless=27, Perfect=81.
// Navigation :
//   - remover seul                  -> couleur suivante
//   - remover + Scroll of Identify -> qualité suivante (scroll restitué)

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

const FILES = {
  cube: path.join(ROOT, 'data-TCP', 'global', 'excel', 'cubemain.txt'),
  itemStatCost: path.join(ROOT, 'data-TCP', 'global', 'excel', 'itemstatcost.txt'),
  itemTypes: path.join(ROOT, 'data-TCP', 'global', 'excel', 'itemtypes.txt'),
  misc: path.join(ROOT, 'data-TCP', 'global', 'excel', 'misc.txt'),
  transmog: path.join(ROOT, 'data-TCP', 'global', 'excel', 'transmog_table.txt'),
  itemNames: path.join(ROOT, 'data-TCP', 'local', 'lng', 'strings', 'item-names.json'),
  items: path.join(ROOT, 'data-TCP', 'hd', 'items', 'items.json'),
};

const COLORS = [
  { name: 'Amethyst', colorCode: 'ÿc;', gems: ['gcv', 'gfv', 'gsv', 'gzv', 'gpv'] },
  { name: 'Topaz', colorCode: 'ÿc9', gems: ['gcy', 'gfy', 'gsy', 'gly', 'gpy'] },
  { name: 'Sapphire', colorCode: 'ÿc3', gems: ['gcb', 'gfb', 'gsb', 'glb', 'gpb'] },
  { name: 'Emerald', colorCode: 'ÿc2', gems: ['gcg', 'gfg', 'gsg', 'glg', 'gpg'] },
  { name: 'Ruby', colorCode: 'ÿc1', gems: ['gcr', 'gfr', 'gsr', 'glr', 'gpr'] },
  { name: 'Diamond', colorCode: 'ÿc0', gems: ['gcw', 'gfw', 'gsw', 'glw', 'gpw'] },
  { name: 'Skull', colorCode: 'ÿc5', gems: ['skc', 'skf', 'sku', 'skl', 'skz'] },
];

const QUALITIES = [
  { name: 'Chipped', type: 'gem0', points: 1 },
  { name: 'Flawed', type: 'gem1', points: 3 },
  { name: 'Standard', type: 'gem2', points: 9 },
  { name: 'Flawless', type: 'gem3', points: 27 },
  { name: 'Perfect', type: 'gem4', points: 81 },
];

const NEW_STRING_ID_BASE = 73000;
const REMOVER_ASSET = '..//custom//removergb';
const BATCH_MAX = 50;

function fail(message) {
  throw new Error(message);
}

function removerCode(qualityIndex, colorIndex) {
  if (qualityIndex === 4) return `y${String(2 + colorIndex).padStart(2, '0')}`;
  return `y${String(63 + qualityIndex * COLORS.length + colorIndex).padStart(2, '0')}`;
}

function buildStates() {
  const states = [];
  for (let qualityIndex = 0; qualityIndex < QUALITIES.length; qualityIndex += 1) {
    for (let colorIndex = 0; colorIndex < COLORS.length; colorIndex += 1) {
      const quality = QUALITIES[qualityIndex];
      const color = COLORS[colorIndex];
      states.push({
        qualityIndex,
        colorIndex,
        quality,
        color,
        code: removerCode(qualityIndex, colorIndex),
        label: `${quality.name} ${color.name} Remover`,
        gemCode: color.gems[qualityIndex],
      });
    }
  }
  return states;
}

const STATES = buildStates();
const STATE_BY_CODE = new Map(STATES.map((state) => [state.code, state]));

function stateFor(qualityIndex, colorIndex) {
  const state = STATE_BY_CODE.get(removerCode(qualityIndex, colorIndex));
  if (!state) fail(`État remover introuvable : qualité=${qualityIndex}, couleur=${colorIndex}`);
  return state;
}

function nextColor(state) {
  return stateFor(state.qualityIndex, (state.colorIndex + 1) % COLORS.length);
}

function nextQuality(state) {
  return stateFor((state.qualityIndex + 1) % QUALITIES.length, state.colorIndex);
}

function removerDisplayString(state) {
  return [
    'ÿc7(cube alone: next color)',
    'ÿc7(+ Scroll of Identify: next quality)',
    `${state.color.colorCode}${state.quality.name} ${state.color.name} ÿc4Removerÿc3`,
  ].join('\n');
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

function replaceContiguousRows(table, predicate, replacement, label) {
  const indexes = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    if (predicate(table.rows[index])) indexes.push(index);
  }
  if (!indexes.length) fail(`Bloc ${label} introuvable`);
  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  if (last - first + 1 !== indexes.length) fail(`Bloc ${label} non contigu`);
  table.rows.splice(first, indexes.length, ...replacement);
}

function buildAddRecipes(cube) {
  const rows = [];
  for (const quality of QUALITIES) {
    for (let quantity = 1; quantity <= BATCH_MAX; quantity += 1) {
      const points = quality.points * quantity;
      rows.push(createRow(cube, {
        description: `Add ${quality.name} Gem x${quantity}`,
        enabled: 1,
        version: 100,
        numinputs: quantity + 1,
        'input 1': 'y01',
        'input 2': quantity === 1 ? quality.type : `"${quality.type},qty=${quantity}"`,
        output: 'useitem',
        'mod 1': 'GB-Total',
        'mod 1 min': points,
        'mod 1 max': points,
      }));
    }
  }
  return rows;
}

function buildRemoveRecipes(cube) {
  return STATES.map((state) => createRow(cube, {
    description: `Remove Gem - ${state.quality.name} ${state.color.name}`,
    enabled: 1,
    version: 100,
    op: 15,
    param: 361,
    value: state.quality.points,
    numinputs: 2,
    'input 1': 'y01',
    'input 2': state.code,
    output: 'useitem',
    'mod 1': 'GB-Total',
    'mod 1 min': -state.quality.points,
    'mod 1 max': -state.quality.points,
    'output b': state.code,
    'output c': state.gemCode,
  }));
}

function buildColorCycles(cube) {
  return STATES.map((state) => createRow(cube, {
    description: `Cycle Gem Remover Color - ${state.quality.name} ${state.color.name}`,
    enabled: 1,
    version: 100,
    numinputs: 1,
    'input 1': state.code,
    output: nextColor(state).code,
  }));
}

function buildQualityCycles(cube) {
  return STATES.map((state) => createRow(cube, {
    description: `Cycle Gem Remover Quality - ${state.quality.name} ${state.color.name}`,
    enabled: 1,
    version: 100,
    numinputs: 2,
    'input 1': state.code,
    'input 2': 'isc',
    output: nextQuality(state).code,
    'output b': 'isc',
  }));
}

function generateCube(cube) {
  const indexes = indexHeaders(cube.headers);
  const description = (row) => row[indexes.description] || '';
  const object = (row) => tableObject(cube, row);

  const isGemAdd = (row) => {
    const value = description(row);
    return /^Add (?:Gem|Chipped Gem|Flawed Gem|Standard Gem|Flawless Gem|Perfect Gem) x\d+$/.test(value)
      && object(row)['input 1'] === 'y01';
  };
  const isGemRemove = (row) => description(row).startsWith('Remove Gem - ')
    && object(row)['input 1'] === 'y01'
    && object(row)['mod 1'] === 'GB-Total';
  const isGemCycle = (row) => description(row).startsWith('Cycle Gem Remover');

  replaceContiguousRows(
    cube,
    (row) => isGemAdd(row) || isGemRemove(row),
    [...buildAddRecipes(cube), ...buildRemoveRecipes(cube)],
    'ajout/retrait des gems',
  );
  replaceContiguousRows(
    cube,
    isGemCycle,
    [...buildColorCycles(cube), ...buildQualityCycles(cube)],
    'rotation des Gem Removers',
  );
}

function generateMisc(misc) {
  const indexes = indexHeaders(misc.headers);
  const rowsByCode = new Map(misc.rows.map((row) => [row[indexes.code], row]));
  const template = misc.rows.find((row) => row[indexes.code] === 'y02');
  if (!template) fail('Template misc.txt y02 introuvable');
  const vendorPattern = /^(?:Charsi|Gheed|Akara|Fara|Lysander|Drognan|Hratli|Alkor|Ormus|Elzix|Asheara|Cain|Halbu|Malah|Larzuk|Anya|Jamella)(?:Magic)?(?:Min|Max)$/;
  const vendorHeaders = misc.headers.filter((header) => vendorPattern.test(header));
  const seedVendorValues = Object.fromEntries(vendorHeaders.map((header) => [header, '']));
  seedVendorValues.AkaraMin = '1';
  seedVendorValues.AkaraMax = '1';

  for (const state of STATES) {
    let row = rowsByCode.get(state.code);
    if (!row) {
      row = template.slice();
      misc.rows.push(row);
      rowsByCode.set(state.code, row);
    }
    row[indexes.code] = state.code;
    row[indexes.alternategfx] = state.code;
    row[indexes.namestr] = state.code;
    row[indexes.type] = 'RMVR';
    for (const header of vendorHeaders) {
      row[indexes[header]] = state.code === 'y63' ? seedVendorValues[header] : '';
    }
  }
}

function generateTransmog(transmog) {
  const indexes = indexHeaders(transmog.headers);
  const existingCodes = new Set(transmog.rows.map((row) => row[indexes.code_name]));
  const template = transmog.rows.find((row) => row[indexes.code_name] === 'y02');
  if (!template) fail('Template transmog y02 introuvable');

  for (const state of STATES) {
    if (existingCodes.has(state.code)) continue;
    const row = template.slice();
    row[indexes.index] = String(transmog.rows.length);
    row[indexes.code_name] = state.code;
    row[indexes.code_normal] = REMOVER_ASSET;
    transmog.rows.push(row);
    existingCodes.add(state.code);
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

function generateItemNames(document) {
  const entries = document.data;
  if (!Array.isArray(entries)) fail('item-names.json doit être un tableau');
  const byKey = new Map(entries.map((entry) => [entry.Key, entry]));
  const usedIds = new Map(entries.map((entry) => [Number(entry.id), entry.Key]));

  for (const state of STATES) {
    let entry = byKey.get(state.code);
    if (!entry) {
      const template = byKey.get(removerCode(4, state.colorIndex));
      if (!template) fail(`Template string Perfect absent pour ${state.color.name}`);
      const stateOffset = state.qualityIndex * COLORS.length + state.colorIndex;
      const id = NEW_STRING_ID_BASE + stateOffset;
      if (usedIds.has(id)) fail(`Collision d'ID string ${id} avec ${usedIds.get(id)}`);
      entry = { ...template, id, Key: state.code };
      entries.push(entry);
      byKey.set(state.code, entry);
      usedIds.set(id, state.code);
    }

    const display = removerDisplayString(state);
    for (const locale of Object.keys(entry)) {
      if (locale !== 'id' && locale !== 'Key') entry[locale] = display;
    }
  }
}

function generateItems(document) {
  const entries = document.data;
  if (!Array.isArray(entries)) fail('items.json doit être un tableau');
  const byCode = new Map();
  for (const entry of entries) {
    for (const code of Object.keys(entry)) byCode.set(code, entry);
  }

  for (const state of STATES) {
    const existing = byCode.get(state.code);
    if (existing) {
      existing[state.code] = { asset: REMOVER_ASSET };
      continue;
    }
    const entry = { [state.code]: { asset: REMOVER_ASSET } };
    entries.push(entry);
    byCode.set(state.code, entry);
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

function validate() {
  const cube = parseTable(FILES.cube);
  const itemStatCost = parseTable(FILES.itemStatCost);
  const itemTypes = parseTable(FILES.itemTypes);
  const misc = parseTable(FILES.misc);
  const transmog = parseTable(FILES.transmog);
  const itemNames = readJsonDocument(FILES.itemNames);
  const items = readJsonDocument(FILES.items);

  for (const [label, table] of Object.entries({ cube, itemStatCost, itemTypes, misc, transmog })) {
    const invalid = table.rows.filter((row) => row.length !== table.headers.length);
    if (invalid.length) fail(`${label} : ${invalid.length} ligne(s) de largeur invalide`);
  }

  if (cube.eol !== '\r\n' || misc.eol !== '\r\n' || transmog.eol !== '\r\n') {
    fail('Les tables TCP cubemain/misc/transmog doivent rester en CRLF');
  }
  if (itemNames.eol !== '\n') fail('item-names.json doit respecter le LF défini par .gitattributes');
  if (fs.readFileSync(FILES.cube, ENCODING) !== serializeTable(cube)) fail('cubemain.txt échoue le round-trip byte-exact');
  if (fs.readFileSync(FILES.misc, ENCODING) !== serializeTable(misc)) fail('misc.txt échoue le round-trip byte-exact');
  if (fs.readFileSync(FILES.transmog, ENCODING) !== serializeTable(transmog)) fail('transmog_table.txt échoue le round-trip byte-exact');
  if (itemNames.raw !== serializeJsonDocument(itemNames)) fail('item-names.json échoue le round-trip JSON exact');
  if (items.raw !== serializeJsonDocument(items)) fail('items.json échoue le round-trip JSON exact');

  const cubeRows = cube.rows.map((row) => tableObject(cube, row));
  const addRows = cubeRows.filter((row) => /^Add (?:Chipped|Flawed|Standard|Flawless|Perfect) Gem x\d+$/.test(row.description));
  const removeRows = cubeRows.filter((row) => /^Remove Gem - (?:Chipped|Flawed|Standard|Flawless|Perfect) /.test(row.description));
  const colorRows = cubeRows.filter((row) => row.description.startsWith('Cycle Gem Remover Color - '));
  const qualityRows = cubeRows.filter((row) => row.description.startsWith('Cycle Gem Remover Quality - '));

  if (addRows.length !== QUALITIES.length * BATCH_MAX) fail(`Recettes d'ajout : ${addRows.length}, attendu 250`);
  if (removeRows.length !== STATES.length) fail(`Recettes de retrait : ${removeRows.length}, attendu 35`);
  if (colorRows.length !== STATES.length) fail(`Rotations de couleur : ${colorRows.length}, attendu 35`);
  if (qualityRows.length !== STATES.length) fail(`Rotations de qualité : ${qualityRows.length}, attendu 35`);
  if (cubeRows.some((row) => /^Add Gem x\d+$/.test(row.description))) fail("Anciennes recettes génériques 'Add Gem' encore présentes");
  if (cubeRows.some((row) => /^Cycle Gem Remover - /.test(row.description))) fail('Anciennes rotations de Gem Remover encore présentes');

  for (const quality of QUALITIES) {
    for (let quantity = 1; quantity <= BATCH_MAX; quantity += 1) {
      const label = `Add ${quality.name} Gem x${quantity}`;
      const row = expectSingle(addRows, (candidate) => candidate.description === label, label);
      const points = quality.points * quantity;
      assertFields(row, {
        enabled: 1,
        version: 100,
        numinputs: quantity + 1,
        'input 1': 'y01',
        'input 2': quantity === 1 ? quality.type : `"${quality.type},qty=${quantity}"`,
        output: 'useitem',
        'mod 1': 'GB-Total',
        'mod 1 min': points,
        'mod 1 max': points,
      }, label);
    }
  }

  const miscIndexes = indexHeaders(misc.headers);
  const transmogIndexes = indexHeaders(transmog.headers);
  const itemNameEntries = itemNames.data;
  const itemEntries = items.data;
  const vendorPattern = /^(?:Charsi|Gheed|Akara|Fara|Lysander|Drognan|Hratli|Alkor|Ormus|Elzix|Asheara|Cain|Halbu|Malah|Larzuk|Anya|Jamella)(?:Magic)?(?:Min|Max)$/;
  const vendorHeaders = misc.headers.filter((header) => vendorPattern.test(header));

  const allStringIds = itemNameEntries.map((entry) => Number(entry.id));
  if (new Set(allStringIds).size !== allStringIds.length) fail('IDs dupliqués dans item-names.json');
  const allStringKeys = itemNameEntries.map((entry) => entry.Key);
  if (new Set(allStringKeys).size !== allStringKeys.length) fail('Keys dupliquées dans item-names.json');

  for (const state of STATES) {
    const removeLabel = `Remove Gem - ${state.quality.name} ${state.color.name}`;
    const remove = expectSingle(removeRows, (row) => row.description === removeLabel, removeLabel);
    assertFields(remove, {
      enabled: 1,
      version: 100,
      op: 15,
      param: 361,
      value: state.quality.points,
      numinputs: 2,
      'input 1': 'y01',
      'input 2': state.code,
      output: 'useitem',
      'mod 1': 'GB-Total',
      'mod 1 min': -state.quality.points,
      'mod 1 max': -state.quality.points,
      'output b': state.code,
      'output c': state.gemCode,
    }, removeLabel);

    const colorLabel = `Cycle Gem Remover Color - ${state.quality.name} ${state.color.name}`;
    const color = expectSingle(colorRows, (row) => row.description === colorLabel, colorLabel);
    assertFields(color, {
      enabled: 1,
      version: 100,
      numinputs: 1,
      'input 1': state.code,
      output: nextColor(state).code,
    }, colorLabel);

    const qualityLabel = `Cycle Gem Remover Quality - ${state.quality.name} ${state.color.name}`;
    const quality = expectSingle(qualityRows, (row) => row.description === qualityLabel, qualityLabel);
    assertFields(quality, {
      enabled: 1,
      version: 100,
      numinputs: 2,
      'input 1': state.code,
      'input 2': 'isc',
      output: nextQuality(state).code,
      'output b': 'isc',
    }, qualityLabel);

    const miscRows = misc.rows.filter((row) => row[miscIndexes.code] === state.code);
    if (miscRows.length !== 1) fail(`misc.txt ${state.code} : ${miscRows.length} occurrence(s)`);
    const miscRow = miscRows[0];
    if (miscRow[miscIndexes.type] !== 'RMVR'
      || miscRow[miscIndexes.namestr] !== state.code
      || miscRow[miscIndexes.alternategfx] !== state.code) {
      fail(`Définition misc invalide pour ${state.code}`);
    }

    const transmogRows = transmog.rows.filter((row) => row[transmogIndexes.code_name] === state.code);
    if (transmogRows.length !== 1 || transmogRows[0][transmogIndexes.code_normal] !== REMOVER_ASSET) {
      fail(`Mapping transmog invalide pour ${state.code}`);
    }

    const stringRows = itemNameEntries.filter((entry) => entry.Key === state.code);
    if (stringRows.length !== 1) fail(`String ${state.code} : ${stringRows.length} occurrence(s)`);
    const stringRow = stringRows[0];
    const display = removerDisplayString(state);
    for (const locale of Object.keys(stringRow)) {
      if (locale !== 'id' && locale !== 'Key' && stringRow[locale] !== display) {
        fail(`String ${state.code}/${locale} n'identifie pas qualité + couleur`);
      }
    }

    const assetRows = itemEntries.filter((entry) => Object.prototype.hasOwnProperty.call(entry, state.code));
    if (assetRows.length !== 1 || assetRows[0][state.code].asset !== REMOVER_ASSET) {
      fail(`Mapping items.json invalide pour ${state.code}`);
    }
  }

  const soldRemovers = STATES.filter((state) => {
    const row = misc.rows.find((candidate) => candidate[miscIndexes.code] === state.code);
    return vendorHeaders.some((header) => {
      const value = row[miscIndexes[header]];
      return value !== '' && value !== '0';
    });
  });
  if (soldRemovers.length !== 1 || soldRemovers[0].code !== 'y63') {
    fail(`Gem Removers vendus : ${soldRemovers.map((state) => state.code).join(', ') || 'aucun'}, attendu y63 seulement`);
  }
  const akaraRemovers = STATES.filter((state) => {
    const row = misc.rows.find((candidate) => candidate[miscIndexes.code] === state.code);
    return row[miscIndexes.AkaraMin] !== '' && row[miscIndexes.AkaraMin] !== '0';
  });
  if (akaraRemovers.length !== 1 || akaraRemovers[0].code !== 'y63') {
    fail(`Gem Removers vendus par Akara : ${akaraRemovers.map((state) => state.code).join(', ') || 'aucun'}, attendu y63 seulement`);
  }

  const typeIndexes = indexHeaders(itemTypes.headers);
  for (const quality of QUALITIES) {
    if (!itemTypes.rows.some((row) => row[typeIndexes.Code] === quality.type)) {
      fail(`Item type ${quality.type} absent`);
    }
  }

  const statIndexes = indexHeaders(itemStatCost.headers);
  const gemStat = itemStatCost.rows.find((row) => row[statIndexes.Stat] === 'GB_Total');
  if (!gemStat || gemStat[statIndexes['*ID']] !== '361') fail('Stat GB_Total/*ID 361 absente');
  const miscCodes = new Set(misc.rows.map((row) => row[miscIndexes.code]));
  if (!miscCodes.has('isc')) fail('Scroll of Identify (isc) absent de misc.txt');

  return {
    addRecipes: addRows.length,
    removerStates: STATES.length,
    removeRecipes: removeRows.length,
    colorCycles: colorRows.length,
    qualityCycles: qualityRows.length,
    totalGemRecipes: addRows.length + removeRows.length + colorRows.length + qualityRows.length,
    pointScale: QUALITIES.map((quality) => quality.points).join('/'),
    batchMax: BATCH_MAX,
    reusedAsset: REMOVER_ASSET,
    stringsIdentifyQualityAndColor: true,
    vendorSeed: 'y63 Chipped Amethyst Remover',
  };
}

function generate() {
  const cube = parseTable(FILES.cube);
  const misc = parseTable(FILES.misc);
  const transmog = parseTable(FILES.transmog);
  const itemNames = readJsonDocument(FILES.itemNames);
  const items = readJsonDocument(FILES.items);

  generateCube(cube);
  generateMisc(misc);
  generateTransmog(transmog);
  generateItemNames(itemNames);
  generateItems(items);

  // Applique les conventions gouvernées par .gitattributes aux fichiers touchés.
  transmog.eol = '\r\n';
  itemNames.eol = '\n';

  const changed = [];
  if (writeTableIfChanged(FILES.cube, cube)) changed.push(path.relative(ROOT, FILES.cube));
  if (writeTableIfChanged(FILES.misc, misc)) changed.push(path.relative(ROOT, FILES.misc));
  if (writeTableIfChanged(FILES.transmog, transmog)) changed.push(path.relative(ROOT, FILES.transmog));
  if (writeJsonDocument(FILES.itemNames, itemNames)) changed.push(path.relative(ROOT, FILES.itemNames));
  if (writeJsonDocument(FILES.items, items)) changed.push(path.relative(ROOT, FILES.items));
  return changed;
}

try {
  const changed = CHECK_ONLY ? [] : generate();
  const summary = validate();
  console.log(JSON.stringify({
    mode: CHECK_ONLY ? 'check' : 'generate',
    changed,
    ...summary,
  }, null, 2));
} catch (error) {
  console.error(`INVALID: ${error.message}`);
  process.exitCode = 1;
}
