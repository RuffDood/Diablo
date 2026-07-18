'use strict';

// Importe la sortie generee par D2RMM pour Enhanced Effects and Sounds dans
// BKVince sans remplacer les tables gameplay par leurs equivalents vanilla.
// Les deltas Vanilla 3.2 -> Enhanced sont rejoues cellule par cellule sur les
// lignes BKVince; les assets HD sont ensuite superposes aux memes chemins.

const fs = require('fs');
const path = require('path');
const { parseTable, serializeTable, writeTable, ENCODING } = require('../build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK_ONLY = process.argv.includes('--check');
const ENHANCED_ROOT = 'C:\\Games\\Diablo II Resurrected\\mods\\D2RMM\\D2RMM.mpq\\data';
const VANILLA_ROOT = path.join(ROOT, 'data-vanilla3.2', 'data', 'data');
const TARGET_ROOT = path.join(ROOT, 'data-BKVince', 'BKVince.mpq', 'data');

const TABLES = Object.freeze({
  'weapons.txt': 'name',
  'missiles.txt': 'Missile',
  'skills.txt': 'skill',
  'states.txt': 'state',
  'monstats2.txt': 'Id',
  'overlay.txt': 'overlay',
  'sounds.txt': 'Sound',
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTable(filePath, label, normalizeMixedEol = false) {
  assert(fs.existsSync(filePath), `${label} absent: ${filePath}`);
  const raw = fs.readFileSync(filePath, ENCODING);
  let table;
  if (normalizeMixedEol) {
    const normalized = raw.replace(/(?<!\r)\n/g, '\r\n');
    const lines = normalized.endsWith('\r\n')
      ? normalized.slice(0, -2).split('\r\n')
      : normalized.split('\r\n');
    table = {
      headers: lines[0].split('\t'),
      rows: lines.slice(1).map((line) => line.split('\t')),
      eol: '\r\n',
      hasFinalEol: normalized.endsWith('\r\n'),
    };
  } else {
    table = parseTable(filePath);
    assert(raw === serializeTable(table), `${label}: round-trip non byte-exact`);
  }
  assert(table.eol === '\r\n', `${label}: CRLF requis`);
  assert(table.rows.every((row) => row.length === table.headers.length), `${label}: largeur de ligne invalide`);
  return { raw, table };
}

function headerIndexes(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function rowsByKey(table, keyHeader, label) {
  const indexes = headerIndexes(table.headers);
  assert(keyHeader in indexes, `${label}: colonne cle ${keyHeader} absente`);
  const result = new Map();
  for (const row of table.rows) {
    const key = row[indexes[keyHeader]];
    assert(!result.has(key), `${label}: cle dupliquee ${key}`);
    result.set(key, row);
  }
  return result;
}

function mapRow(source, target, row) {
  const sourceIndexes = headerIndexes(source.headers);
  return target.headers.map((header) => (
    header in sourceIndexes ? row[sourceIndexes[header]] ?? '' : ''
  ));
}

function mergeTable(filename, keyHeader) {
  const vanillaPath = path.join(VANILLA_ROOT, 'global', 'excel', filename);
  const enhancedPath = path.join(ENHANCED_ROOT, 'global', 'excel', filename);
  const targetPath = path.join(TARGET_ROOT, 'global', 'excel', filename);
  const vanilla = loadTable(vanillaPath, `vanilla ${filename}`).table;
  const enhanced = loadTable(enhancedPath, `enhanced ${filename}`, true).table;
  const targetLoaded = fs.existsSync(targetPath)
    ? loadTable(targetPath, `BKVince ${filename}`)
    : {
      raw: null,
      table: {
        headers: vanilla.headers.slice(),
        rows: vanilla.rows.map((row) => row.slice()),
        eol: '\r\n',
        hasFinalEol: vanilla.hasFinalEol,
      },
    };
  const target = targetLoaded.table;
  const vanillaRows = rowsByKey(vanilla, keyHeader, `vanilla ${filename}`);
  const enhancedRows = rowsByKey(enhanced, keyHeader, `enhanced ${filename}`);
  const targetRows = rowsByKey(target, keyHeader, `BKVince ${filename}`);
  const vi = headerIndexes(vanilla.headers);
  const ei = headerIndexes(enhanced.headers);
  const ti = headerIndexes(target.headers);
  assert(keyHeader in ti, `${filename}: cle BKVince absente`);

  let cellChanges = 0;
  let conflicts = 0;
  let additions = 0;
  for (const [key, enhancedRow] of enhancedRows) {
    const vanillaRow = vanillaRows.get(key);
    if (!vanillaRow) {
      if (!targetRows.has(key)) {
        target.rows.push(mapRow(enhanced, target, enhancedRow));
        additions += 1;
      }
      continue;
    }
    const changedHeaders = enhanced.headers.filter((header) => (
      header in vi && header in ti && header !== keyHeader
      && (enhancedRow[ei[header]] ?? '') !== (vanillaRow[vi[header]] ?? '')
    ));
    if (changedHeaders.length === 0) continue;
    const targetRow = targetRows.get(key);
    assert(targetRow, `${filename}: ligne BKVince requise absente: ${key}`);
    for (const header of changedHeaders) {
      if (!(header in vi) || !(header in ti) || header === keyHeader) continue;
      const vanillaValue = vanillaRow[vi[header]] ?? '';
      const enhancedValue = enhancedRow[ei[header]] ?? '';
      // Politique BKVince: Enhanced ne doit rendre aucun son vanilla muet.
      if ((header === 'Volume Min' || header === 'Volume Max')
        && enhancedValue === '0' && vanillaValue !== '0') continue;
      const targetValue = targetRow[ti[header]] ?? '';
      if (targetValue !== vanillaValue && targetValue !== enhancedValue) conflicts += 1;
      if (targetValue !== enhancedValue) {
        targetRow[ti[header]] = enhancedValue;
        cellChanges += 1;
      }
    }
  }

  const serialized = serializeTable(target);
  const changed = serialized !== targetLoaded.raw;
  if (changed && !CHECK_ONLY) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    writeTable(targetPath, target);
  }
  return { filename, changed, cellChanges, additions, conflicts };
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function importAssets() {
  const governedSeparately = new Set([
    path.join('hd', 'global', 'excel', 'soundsettings.json').toLowerCase(),
    path.join('hd', 'missiles', 'missiles.json').toLowerCase(),
  ]);
  const files = walkFiles(ENHANCED_ROOT).filter((filePath) => {
    const relative = path.relative(ENHANCED_ROOT, filePath).toLowerCase();
    return path.extname(filePath).toLowerCase() !== '.txt' && !governedSeparately.has(relative);
  });
  let changed = 0;
  for (const sourcePath of files) {
    const relative = path.relative(ENHANCED_ROOT, sourcePath);
    const targetPath = path.join(TARGET_ROOT, relative);
    const identical = fs.existsSync(targetPath) && fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath));
    if (identical) continue;
    changed += 1;
    if (!CHECK_ONLY) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
  return { total: files.length, changed };
}

function mergeMissileMappings() {
  const relative = path.join('hd', 'missiles', 'missiles.json');
  const sourcePath = path.join(ENHANCED_ROOT, relative);
  const targetPath = path.join(TARGET_ROOT, relative);
  const parseJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  const source = parseJson(sourcePath);
  const target = parseJson(targetPath);
  const keys = ['warstomp', 'warcryextra', 'necrocorpsex', 'necrocorpsexfrag', 'meteorstomp'];
  let changed = false;
  for (const key of keys) {
    assert(key in source, `missiles.json Enhanced: mapping ${key} absent`);
    if (target[key] !== source[key]) {
      target[key] = source[key];
      changed = true;
    }
  }
  if (changed && !CHECK_ONLY) fs.writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`, 'utf8');
  return { changed, keys };
}

function raiseVoiceLimits() {
  const settingsPath = path.join(TARGET_ROOT, 'hd', 'global', 'excel', 'soundsettings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert(settings.system, 'soundsettings.json: section system absente');
  settings.system['2d-voice-count'] = 8;
  settings.system['3d-voice-count'] = 80;
  const output = `${JSON.stringify(settings, null, 4)}\n`;
  const changed = fs.readFileSync(settingsPath, 'utf8') !== output;
  if (changed && !CHECK_ONLY) fs.writeFileSync(settingsPath, output, 'utf8');
  return { changed, twoDimensional: 8, threeDimensional: 80 };
}

const tableResults = Object.entries(TABLES).map(([filename, key]) => mergeTable(filename, key));
const assetResult = importAssets();
const missileMappings = mergeMissileMappings();
const voiceLimits = raiseVoiceLimits();
for (const result of tableResults) console.log(JSON.stringify(result));
console.log(JSON.stringify({ assets: assetResult, mode: CHECK_ONLY ? 'check' : 'write' }));
console.log(JSON.stringify({ missileMappings }));
console.log(JSON.stringify({ voiceLimits }));
