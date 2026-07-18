'use strict';

// Porte atomiquement le Storage Bag TCP (runes + gems seulement) vers BKVince.
// Les lignes BKVince existantes restent dans le meme ordre et byte-identiques :
// le generateur ajoute uniquement un suffixe gouverne dans chaque table.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  parseTable,
  serializeTable,
  writeTable,
  ENCODING,
} = require('../build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK_ONLY = process.argv.includes('--check');
const SOURCE_ROOT = path.join(ROOT, 'data-TCP');
const TARGET_ROOT = path.join(ROOT, 'data-BKVince', 'BKVince.mpq', 'data');
const SOURCE_EXCEL = path.join(SOURCE_ROOT, 'global', 'excel');
const TARGET_EXCEL = path.join(TARGET_ROOT, 'global', 'excel');

const STAT_NAMES = Object.freeze(['GB_Total', 'RB_Low', 'RB_Mid', 'RB_High']);
const PROPERTY_CODES = Object.freeze(['GB-Total', 'RB-Low', 'RB-Mid', 'RB-High']);
const STAT_STRING_KEYS = Object.freeze(['GBTotal', 'RBLow', 'RBMid', 'RBHigh']);
const STRING_ID_BASE = 74000;

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function yCode(number) {
  return `y${String(number).padStart(2, '0')}`;
}

const ITEM_CODES = Object.freeze([
  'y01',
  ...range(2, 41).map(yCode),
  ...range(48, 51).map(yCode),
  ...range(63, 90).map(yCode),
]);
const STRING_KEYS = Object.freeze([...ITEM_CODES, ...STAT_STRING_KEYS]);
const FORBIDDEN_CODES = Object.freeze(range(42, 47).map(yCode));
const FORBIDDEN_STATS = Object.freeze(['KB_Terror', 'OB_Diablo']);
const FORBIDDEN_PROPERTIES = Object.freeze(['KB-Terror', 'OB-Diablo']);

const ASSET_NAMES = Object.freeze([
  'StorageBag.sprite',
  'StorageBag.lowend.sprite',
  'RemoverGB.sprite',
  'RemoverGB.lowend.sprite',
  'RemoverRB.sprite',
  'RemoverRB.lowend.sprite',
  'RuneConverter.sprite',
  'RuneConverter.lowend.sprite',
]);

const FILES = Object.freeze({
  source: {
    itemStatCost: path.join(SOURCE_EXCEL, 'itemstatcost.txt'),
    properties: path.join(SOURCE_EXCEL, 'properties.txt'),
    itemTypes: path.join(SOURCE_EXCEL, 'itemtypes.txt'),
    misc: path.join(SOURCE_EXCEL, 'misc.txt'),
    cube: path.join(SOURCE_EXCEL, 'cubemain.txt'),
    strings: path.join(SOURCE_ROOT, 'local', 'lng', 'strings', 'item-names.json'),
    items: path.join(SOURCE_ROOT, 'hd', 'items', 'items.json'),
    assets: path.join(SOURCE_ROOT, 'hd', 'global', 'ui', 'items', 'custom'),
  },
  target: {
    itemStatCost: path.join(TARGET_EXCEL, 'itemstatcost.txt'),
    properties: path.join(TARGET_EXCEL, 'properties.txt'),
    itemTypes: path.join(TARGET_EXCEL, 'itemtypes.txt'),
    misc: path.join(TARGET_EXCEL, 'misc.txt'),
    cube: path.join(TARGET_EXCEL, 'cubemain.txt'),
    strings: path.join(TARGET_ROOT, 'local', 'lng', 'strings', 'item-names.json'),
    items: path.join(TARGET_ROOT, 'hd', 'items', 'items.json'),
    assets: path.join(TARGET_ROOT, 'hd', 'global', 'ui', 'items', 'custom'),
    transmog: path.join(TARGET_EXCEL, 'transmog_table.txt'),
  },
});

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function indexHeaders(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRow(left, right) {
  return sameArray(left, right);
}

function cloneRow(row) {
  return row.slice();
}

function loadTable(filePath, label) {
  assert(fs.existsSync(filePath), `${label} absent: ${filePath}`);
  const raw = fs.readFileSync(filePath, ENCODING);
  const table = parseTable(filePath);
  assert(raw === serializeTable(table), `${label}: round-trip non byte-exact`);
  assert(table.eol === '\r\n', `${label}: CRLF requis`);
  for (const row of table.rows) {
    assert(row.length === table.headers.length, `${label}: largeur de ligne invalide`);
  }
  return { filePath, raw, table };
}

function sourceRowsByKey(source, header, keys, label) {
  const indexes = indexHeaders(source.table.headers);
  assert(header in indexes, `${label}: colonne ${header} absente`);
  const rows = new Map(source.table.rows.map((row) => [row[indexes[header]], row]));
  return keys.map((key) => {
    const row = rows.get(key);
    assert(row, `${label}: ligne source ${key} absente`);
    return cloneRow(row);
  });
}

function assertHeadersCompatible(source, target, label) {
  const targetHeaders = new Set(target.table.headers);
  const missing = source.table.headers.filter((header) => !targetHeaders.has(header));
  assert(missing.length === 0, `${label}: colonnes BKVince absentes: ${missing.join(', ')}`);
}

function mapRowToTarget(sourceTable, targetTable, sourceRow) {
  const sourceIndexes = indexHeaders(sourceTable.headers);
  return targetTable.headers.map((header) => (
    header in sourceIndexes ? sourceRow[sourceIndexes[header]] ?? '' : ''
  ));
}

function suffixEquals(rows, expected) {
  if (rows.length < expected.length) return false;
  const offset = rows.length - expected.length;
  return expected.every((row, index) => sameRow(rows[offset + index], row));
}

function ensureSuffix(table, expected, isGovernedRow, label, changed) {
  const governed = table.rows.filter(isGovernedRow);
  if (governed.length === 0) {
    if (!CHECK_ONLY) {
      table.rows.push(...expected.map(cloneRow));
      changed.push(label);
    }
    return;
  }
  assert(governed.length === expected.length, `${label}: portage partiel (${governed.length}/${expected.length})`);
  assert(suffixEquals(table.rows, expected), `${label}: les lignes gouvernees ne forment pas le suffixe attendu`);
}

function prepareStatRows(source, target, changed) {
  const sourceIndexes = indexHeaders(source.table.headers);
  const targetIndexes = indexHeaders(target.table.headers);
  const existing = STAT_NAMES.map((name) => target.table.rows.findIndex(
    (row) => row[targetIndexes.Stat] === name,
  ));
  const present = existing.filter((index) => index >= 0).length;
  assert(present === 0 || present === STAT_NAMES.length, `itemstatcost: portage partiel (${present}/${STAT_NAMES.length})`);

  const ids = new Map();
  const expected = sourceRowsByKey(source, 'Stat', STAT_NAMES, 'itemstatcost source');
  if (present === 0) {
    const base = target.table.rows.length;
    expected.forEach((row, index) => {
      const id = base + index;
      row[sourceIndexes['*ID']] = String(id);
      ids.set(STAT_NAMES[index], id);
    });
  } else {
    expected.forEach((row, index) => {
      const id = existing[index];
      row[sourceIndexes['*ID']] = String(id);
      ids.set(STAT_NAMES[index], id);
    });
  }

  ensureSuffix(
    target.table,
    expected,
    (row) => STAT_NAMES.includes(row[targetIndexes.Stat]),
    'itemstatcost.txt',
    changed,
  );
  return ids;
}

function isStorageRecipeObject(row) {
  const description = row.description || '';
  return /^Add Rune - /.test(description)
    || /^Remove Rune - /.test(description)
    || /^Rune Cycle - /.test(description)
    || /^Rune Convert(?: - | Cycle$)/.test(description)
    || /^Add (?:Chipped|Flawed|Standard|Flawless|Perfect) Gem x\d+$/.test(description)
    || /^Remove Gem - /.test(description)
    || /^Cycle Gem Remover (?:Color|Quality) - /.test(description);
}

function tableObject(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
}

function prepareCubeRows(source, target, statIds, changed) {
  const sourceIndexes = indexHeaders(source.table.headers);
  const targetIndexes = indexHeaders(target.table.headers);
  const sourceStatRows = sourceRowsByKey(
    loadTable(FILES.source.itemStatCost, 'itemstatcost TCP pour IDs'),
    'Stat',
    STAT_NAMES,
    'itemstatcost TCP pour IDs',
  );
  const statHeaders = indexHeaders(parseTable(FILES.source.itemStatCost).headers);
  const oldIdToName = new Map(sourceStatRows.map((row, index) => [
    row[statHeaders['*ID']],
    STAT_NAMES[index],
  ]));

  const expected = source.table.rows
    .filter((row) => isStorageRecipeObject(tableObject(source.table.headers, row)))
    .map((row) => {
      const clone = cloneRow(row);
      if (clone[sourceIndexes.op] === '15' && oldIdToName.has(clone[sourceIndexes.param])) {
        clone[sourceIndexes.param] = String(statIds.get(oldIdToName.get(clone[sourceIndexes.param])));
      }
      return clone;
    });
  assert(expected.length === 759, `cubemain source: ${expected.length} recettes Storage Bag, attendu 759`);

  const expectedObjects = expected.map((row) => tableObject(source.table.headers, row));
  const counts = {
    rune: expectedObjects.filter((row) => /Rune/.test(row.description)).length,
    gem: expectedObjects.filter((row) => /Gem/.test(row.description)).length,
  };
  assert(counts.rune === 404 && counts.gem === 355, `cubemain source: repartition invalide ${JSON.stringify(counts)}`);

  ensureSuffix(
    target.table,
    expected,
    (row) => isStorageRecipeObject(tableObject(target.table.headers, row)),
    'cubemain.txt',
    changed,
  );

  const targetObjects = target.table.rows.map((row) => tableObject(target.table.headers, row));
  const allowedStatIds = new Set([...statIds.values()].map(String));
  for (const row of targetObjects.filter(isStorageRecipeObject)) {
    if (row.op !== '15') continue;
    assert(allowedStatIds.has(row.param), `${row.description}: param stat invalide`);
  }

  assert(!target.table.rows.some((row) => FORBIDDEN_CODES.includes(row[targetIndexes['input 1']])), 'cubemain: remover key/organ interdit');
  return counts;
}

function stripBom(raw) {
  return raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
}

function readJsonArray(filePath, label) {
  assert(fs.existsSync(filePath), `${label} absent: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = stripBom(raw);
  const data = JSON.parse(body);
  assert(Array.isArray(data), `${label}: tableau JSON attendu`);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  return { filePath, raw, bom, body, data, eol };
}

function appendJsonEntries(document, entries, formatter, label, changed) {
  if (!entries.length) return;
  const closing = document.body.lastIndexOf(']');
  assert(closing >= 0, `${label}: fermeture JSON absente`);
  const before = document.body.slice(0, closing).replace(/\s*$/, '');
  const after = document.body.slice(closing + 1);
  const separator = before.endsWith('[') ? '' : ',';
  const rendered = entries.map(formatter).join(`,${document.eol}`);
  document.body = `${before}${separator}${document.eol}${rendered}${document.eol}]${after}`;
  document.raw = `${document.bom}${document.body}`;
  document.data = JSON.parse(document.body);
  changed.push(label);
}

function writeJsonDocument(document) {
  const temporary = `${document.filePath}.tmp`;
  fs.writeFileSync(temporary, document.raw, 'utf8');
  fs.renameSync(temporary, document.filePath);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function prepareStrings(source, target, changed) {
  const sourceByKey = new Map(source.data.map((entry) => [entry.Key, entry]));
  const targetByKey = new Map(target.data.map((entry) => [entry.Key, entry]));
  const existing = STRING_KEYS.filter((key) => targetByKey.has(key));
  assert(existing.length === 0 || existing.length === STRING_KEYS.length, `item-names: portage partiel (${existing.length}/${STRING_KEYS.length})`);

  const expected = STRING_KEYS.map((key, index) => {
    const sourceEntry = sourceByKey.get(key);
    assert(sourceEntry, `item-names TCP: string ${key} absente`);
    const entry = cloneJson(sourceEntry);
    entry.id = STRING_ID_BASE + index;
    return entry;
  });

  if (existing.length === 0) {
    const usedIds = new Map(target.data.map((entry) => [Number(entry.id), entry.Key]));
    for (const entry of expected) {
      assert(!usedIds.has(Number(entry.id)), `item-names: collision ID ${entry.id} avec ${usedIds.get(Number(entry.id))}`);
    }
    if (!CHECK_ONLY) {
      appendJsonEntries(
        target,
        expected,
        (entry) => JSON.stringify(entry, null, 2).split('\n').map((line) => `  ${line}`).join(target.eol),
        'item-names.json',
        changed,
      );
    }
  } else {
    for (const expectedEntry of expected) {
      assert(
        JSON.stringify(targetByKey.get(expectedEntry.Key)) === JSON.stringify(expectedEntry),
        `item-names: string ${expectedEntry.Key} differente`,
      );
    }
  }
}

function itemMappings(document) {
  const map = new Map();
  for (const entry of document.data) {
    for (const [code, value] of Object.entries(entry)) {
      assert(!map.has(code), `items.json: mapping duplique ${code}`);
      map.set(code, value);
    }
  }
  return map;
}

function prepareItems(source, target, changed) {
  const sourceMap = itemMappings(source);
  const targetMap = itemMappings(target);
  const existing = ITEM_CODES.filter((code) => targetMap.has(code));
  assert(existing.length === 0 || existing.length === ITEM_CODES.length, `items.json: portage partiel (${existing.length}/${ITEM_CODES.length})`);

  const expected = ITEM_CODES.map((code) => {
    const value = sourceMap.get(code);
    assert(value, `items.json TCP: mapping ${code} absent`);
    return { [code]: cloneJson(value) };
  });

  if (existing.length === 0) {
    if (!CHECK_ONLY) {
      appendJsonEntries(
        target,
        expected,
        (entry) => {
          const [[code, value]] = Object.entries(entry);
          return `  { ${JSON.stringify(code)}: { "asset": ${JSON.stringify(value.asset)} } }`;
        },
        'items.json',
        changed,
      );
    }
  } else {
    for (const entry of expected) {
      const [[code, value]] = Object.entries(entry);
      assert(JSON.stringify(targetMap.get(code)) === JSON.stringify(value), `items.json: mapping ${code} different`);
    }
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function prepareAssets(changed) {
  if (!CHECK_ONLY) fs.mkdirSync(FILES.target.assets, { recursive: true });
  for (const name of ASSET_NAMES) {
    const source = path.join(FILES.source.assets, name);
    const target = path.join(FILES.target.assets, name);
    assert(fs.existsSync(source), `asset TCP absent: ${name}`);
    if (!fs.existsSync(target)) {
      if (!CHECK_ONLY) {
        fs.copyFileSync(source, target);
        changed.push(path.relative(ROOT, target));
      }
      continue;
    }
    assert(sha256(source) === sha256(target), `asset BKVince different: ${name}`);
  }
}

function validateJsonUniqueness(document, label, options = {}) {
  const keys = [];
  const ids = [];
  for (const entry of document.data) {
    if ('Key' in entry) keys.push(entry.Key);
    if ('id' in entry) ids.push(Number(entry.id));
  }
  if (keys.length && !options.allowPreexistingDuplicateKeys) {
    assert(new Set(keys).size === keys.length, `${label}: keys dupliquees`);
  }
  if (ids.length) assert(new Set(ids).size === ids.length, `${label}: IDs dupliques`);
}

function writeTableIfChanged(document) {
  const output = serializeTable(document.table);
  if (output === document.raw) return false;
  writeTable(document.filePath, document.table);
  return true;
}

function loadAll() {
  const source = {
    itemStatCost: loadTable(FILES.source.itemStatCost, 'itemstatcost TCP'),
    properties: loadTable(FILES.source.properties, 'properties TCP'),
    itemTypes: loadTable(FILES.source.itemTypes, 'itemtypes TCP'),
    misc: loadTable(FILES.source.misc, 'misc TCP'),
    cube: loadTable(FILES.source.cube, 'cubemain TCP'),
    strings: readJsonArray(FILES.source.strings, 'item-names TCP'),
    items: readJsonArray(FILES.source.items, 'items TCP'),
  };
  const target = {
    itemStatCost: loadTable(FILES.target.itemStatCost, 'itemstatcost BKVince'),
    properties: loadTable(FILES.target.properties, 'properties BKVince'),
    itemTypes: loadTable(FILES.target.itemTypes, 'itemtypes BKVince'),
    misc: loadTable(FILES.target.misc, 'misc BKVince'),
    cube: loadTable(FILES.target.cube, 'cubemain BKVince'),
    strings: readJsonArray(FILES.target.strings, 'item-names BKVince'),
    items: readJsonArray(FILES.target.items, 'items BKVince'),
  };
  for (const key of ['itemStatCost', 'properties', 'misc', 'cube']) {
    assertHeadersCompatible(source[key], target[key], key);
  }
  assert(indexHeaders(source.itemTypes.table.headers).Code !== undefined, 'itemTypes TCP: colonne Code absente');
  assert(indexHeaders(target.itemTypes.table.headers).Code !== undefined, 'itemTypes BKVince: colonne Code absente');
  return { source, target };
}

function prepare() {
  const { source, target } = loadAll();
  const changed = [];
  const statIds = prepareStatRows(source.itemStatCost, target.itemStatCost, changed);

  const propertyRows = sourceRowsByKey(source.properties, 'code', PROPERTY_CODES, 'properties source');
  const propertyIndex = indexHeaders(target.properties.table.headers).code;
  const propertyIdIndex = indexHeaders(target.properties.table.headers)['*Id'];
  const mappedPropertyRows = propertyRows.map((row) => mapRowToTarget(
    source.properties.table,
    target.properties.table,
    row,
  ));
  const existingPropertyIndexes = PROPERTY_CODES.map((code) => target.properties.table.rows.findIndex(
    (row) => row[propertyIndex] === code,
  ));
  const existingPropertyCount = existingPropertyIndexes.filter((index) => index >= 0).length;
  assert(
    existingPropertyCount === 0 || existingPropertyCount === PROPERTY_CODES.length,
    `properties: portage partiel (${existingPropertyCount}/${PROPERTY_CODES.length})`,
  );
  mappedPropertyRows.forEach((row, index) => {
    if (propertyIdIndex !== undefined) {
      row[propertyIdIndex] = String(existingPropertyCount === 0
        ? target.properties.table.rows.length + index
        : existingPropertyIndexes[index]);
    }
  });
  ensureSuffix(
    target.properties.table,
    mappedPropertyRows,
    (row) => PROPERTY_CODES.includes(row[propertyIndex]),
    'properties.txt',
    changed,
  );

  const typeIndex = indexHeaders(target.itemTypes.table.headers).Code;
  assert(target.itemTypes.table.rows.some((row) => row[typeIndex] === 'misc'), 'itemtypes: type misc absent');

  const miscRows = sourceRowsByKey(source.misc, 'code', ITEM_CODES, 'misc source');
  const miscHeaders = indexHeaders(target.misc.table.headers);
  const miscIndex = miscHeaders.code;
  const mappedMiscRows = miscRows.map((row) => mapRowToTarget(
    source.misc.table,
    target.misc.table,
    row,
  ));
  mappedMiscRows.forEach((row) => {
    row[miscHeaders.type] = 'misc';
  });
  ensureSuffix(
    target.misc.table,
    mappedMiscRows,
    (row) => ITEM_CODES.includes(row[miscIndex]),
    'misc.txt',
    changed,
  );
  assert(!target.misc.table.rows.some((row) => FORBIDDEN_CODES.includes(row[miscIndex])), 'misc: removers key/organ interdits');

  const recipeCounts = prepareCubeRows(source.cube, target.cube, statIds, changed);
  prepareStrings(source.strings, target.strings, changed);
  prepareItems(source.items, target.items, changed);
  prepareAssets(changed);

  const forbiddenStatIndex = indexHeaders(target.itemStatCost.table.headers).Stat;
  assert(!target.itemStatCost.table.rows.some((row) => FORBIDDEN_STATS.includes(row[forbiddenStatIndex])), 'itemstatcost: stats key/organ interdites');
  const forbiddenPropertyIndex = indexHeaders(target.properties.table.headers).code;
  assert(!target.properties.table.rows.some((row) => FORBIDDEN_PROPERTIES.includes(row[forbiddenPropertyIndex])), 'properties: properties key/organ interdites');
  assert(!fs.existsSync(FILES.target.transmog), 'transmog_table.txt ne doit pas etre ajoute');

  if (!CHECK_ONLY) {
    for (const document of [
      target.itemStatCost,
      target.properties,
      target.itemTypes,
      target.misc,
      target.cube,
    ]) writeTableIfChanged(document);
    if (changed.includes('item-names.json')) writeJsonDocument(target.strings);
    if (changed.includes('items.json')) writeJsonDocument(target.items);
  }

  return { changed, statIds: Object.fromEntries(statIds), recipeCounts };
}

function validateFinal() {
  const { target } = loadAll();
  const statIndex = indexHeaders(target.itemStatCost.table.headers);
  const statIds = new Map();
  for (const name of STAT_NAMES) {
    const rowIndex = target.itemStatCost.table.rows.findIndex((row) => row[statIndex.Stat] === name);
    assert(rowIndex >= 0, `itemstatcost final: ${name} absent`);
    assert(target.itemStatCost.table.rows[rowIndex][statIndex['*ID']] === String(rowIndex), `itemstatcost final: ID ${name} invalide`);
    statIds.set(name, rowIndex);
  }
  const cubeObjects = target.cube.table.rows.map((row) => tableObject(target.cube.table.headers, row));
  const recipes = cubeObjects.filter(isStorageRecipeObject);
  assert(recipes.length === 759, `cubemain final: ${recipes.length} recettes, attendu 759`);
  assert(recipes.filter((row) => /Rune/.test(row.description)).length === 404, 'cubemain final: recettes runes invalides');
  assert(recipes.filter((row) => /Gem/.test(row.description)).length === 355, 'cubemain final: recettes gems invalides');

  const propertyIndex = indexHeaders(target.properties.table.headers).code;
  for (const code of PROPERTY_CODES) assert(target.properties.table.rows.some((row) => row[propertyIndex] === code), `properties final: ${code} absent`);
  const typeIndex = indexHeaders(target.itemTypes.table.headers).Code;
  assert(target.itemTypes.table.rows.some((row) => row[typeIndex] === 'misc'), 'itemtypes final: misc absent');
  const miscIndex = indexHeaders(target.misc.table.headers).code;
  for (const code of ITEM_CODES) assert(target.misc.table.rows.some((row) => row[miscIndex] === code), `misc final: ${code} absent`);

  validateJsonUniqueness(target.strings, 'item-names final', { allowPreexistingDuplicateKeys: true });
  const strings = new Map(target.strings.data.map((entry) => [entry.Key, entry]));
  STRING_KEYS.forEach((key, index) => {
    assert(
      target.strings.data.filter((entry) => entry.Key === key).length === 1,
      `item-names final: ${key} doit etre unique`,
    );
    const entry = strings.get(key);
    assert(entry, `item-names final: ${key} absent`);
    assert(Number(entry.id) === STRING_ID_BASE + index, `item-names final: ID ${key} invalide`);
  });
  const mappings = itemMappings(target.items);
  for (const code of ITEM_CODES) assert(mappings.has(code), `items final: ${code} absent`);
  prepareAssets([]);
  assert(!fs.existsSync(FILES.target.transmog), 'transmog_table final: table inattendue');

  return {
    stats: Object.fromEntries(statIds),
    properties: PROPERTY_CODES.length,
    itemType: 'misc (existing)',
    items: ITEM_CODES.length,
    strings: STRING_KEYS.length,
    recipes: recipes.length,
    runeRecipes: 404,
    gemRecipes: 355,
    assets: ASSET_NAMES.length,
    transmogTable: false,
    keyOrganStorage: false,
  };
}

try {
  const prepared = prepare();
  const final = CHECK_ONLY ? validateFinal() : (() => {
    const previous = process.argv;
    return validateFinal(previous);
  })();
  console.log(JSON.stringify({
    mode: CHECK_ONLY ? 'check' : 'generate',
    changed: prepared.changed,
    ...final,
  }, null, 2));
} catch (error) {
  console.error(`INVALID BKVince Storage Bag: ${error.message}`);
  process.exitCode = 1;
}
