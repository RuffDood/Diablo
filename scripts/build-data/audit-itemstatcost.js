'use strict';

// Audit et migration selective des limites de sauvegarde ItemStatCost BK -> TCP.
// Seules les colonnes actuelles "Save Bits" et "Save Add" sont migrees.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseTable, serializeTable, writeTable } = require('./tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const BK_PATH = path.join(ROOT, 'data-BK', 'global', 'excel', 'itemstatcost.txt');
const TCP_PATH = path.join(ROOT, 'data-TCP', 'global', 'excel', 'itemstatcost.txt');
const TCP_EXCEL = path.join(ROOT, 'data-TCP', 'global', 'excel');

const EXPECTED_IDENTITY_HASH = 'dcb5407e7fe443419ed759b4402133b0737f97dc5d7ebbb65e3d780741d49882';
const SAVE_FIELDS = ['Save Bits', 'Save Add'];
const ITEM_TABLES = [
  'automagic.txt',
  'magicprefix.txt',
  'magicsuffix.txt',
  'uniqueitems.txt',
  'setitems.txt',
  'runes.txt',
  'gems.txt',
  'cubemain.txt',
];

// Valeurs TCP avant migration. Elles permettent de rejouer l'audit des cas
// hors plage meme apres que la table cible a ete corrigee.
const LEGACY_ENCODING = Object.freeze({
  item_maxdamage_percent: { bits: '9', add: '0' },
  item_mindamage_percent: { bits: '9', add: '0' },
  mindamage: { bits: '6', add: '0' },
  maxdamage: { bits: '7', add: '0' },
  secondary_mindamage: { bits: '6', add: '0' },
  secondary_maxdamage: { bits: '7', add: '0' },
  damagepercent: { bits: '8', add: '0' },
  armorclass_vs_hth: { bits: '8', add: '0' },
  firemindam: { bits: '8', add: '0' },
  lightmindam: { bits: '6', add: '0' },
  magicmindam: { bits: '8', add: '0' },
  coldmindam: { bits: '8', add: '0' },
  velocitypercent: { bits: '7', add: '30' },
  attackrate: { bits: '7', add: '30' },
  hpregen: { bits: '6', add: '30' },
  item_attackertakesdamage: { bits: '7', add: '0' },
  item_goldbonus: { bits: '9', add: '100' },
  item_magicbonus: { bits: '8', add: '100' },
  item_healafterkill: { bits: '7', add: '0' },
  item_lightradius: { bits: '4', add: '4' },
  item_fasterattackrate: { bits: '7', add: '20' },
  item_levelreqpct: { bits: '7', add: '64' },
  item_fastermovevelocity: { bits: '7', add: '20' },
  item_nonclassskill: { bits: '6', add: '0' },
  item_fastergethitrate: { bits: '7', add: '20' },
  item_fastercastrate: { bits: '7', add: '20' },
  item_singleskill: { bits: '3', add: '0' },
  item_allskills: { bits: '3', add: '0' },
  item_kickdamage: { bits: '7', add: '0' },
  item_manaafterkill: { bits: '7', add: '0' },
  item_throw_mindamage: { bits: '6', add: '0' },
  item_throw_maxdamage: { bits: '7', add: '0' },
  item_hp_perlevel: { bits: '6', add: '0' },
  item_mana_perlevel: { bits: '6', add: '0' },
  item_maxdamage_perlevel: { bits: '6', add: '0' },
  item_maxdamage_percent_perlevel: { bits: '6', add: '0' },
  item_tohit_perlevel: { bits: '6', add: '0' },
  item_tohitpercent_perlevel: { bits: '6', add: '0' },
});

const EXPECTED_REFERENCE_COUNTS = Object.freeze({
  armorclass_vs_hth: 2,
  coldmindam: 4,
  firemindam: 6,
  hpregen: 3,
  item_attackertakesdamage: 2,
  item_fastercastrate: 2,
  item_magicbonus: 2,
  item_nonclassskill: 1,
  item_singleskill: 2,
  lightmindam: 3,
  magicmindam: 1,
  maxdamage: 3,
  mindamage: 5,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function records(table) {
  return table.rows.map((row) => Object.fromEntries(
    table.headers.map((header, index) => [header, row[index] ?? '']),
  ));
}

function indexByStat(table) {
  const result = new Map();
  for (const row of records(table)) {
    assert(!result.has(row.Stat), `Stat dupliquee dans itemstatcost.txt: ${row.Stat}`);
    result.set(row.Stat, row);
  }
  return result;
}

function integer(value) {
  if (value === '' || value === undefined || value === null) return 0;
  const parsed = Number(value);
  assert(Number.isInteger(parsed), `Valeur d'encodage non entiere: ${value}`);
  return parsed;
}

function encodingRange(bitsValue, addValue) {
  const bits = integer(bitsValue);
  const add = integer(addValue);
  return { min: -add, max: (2 ** bits) - 1 - add };
}

function identityHash(table) {
  const statIndex = table.headers.indexOf('Stat');
  const idIndex = table.headers.indexOf('*ID');
  assert(statIndex >= 0 && idIndex >= 0, 'Colonnes Stat/*ID absentes');
  const identities = table.rows.map((row) => `${row[statIndex]}\t${row[idIndex]}`).join('\n');
  return crypto.createHash('sha256')
    .update(identities, 'utf8')
    .digest('hex');
}

function assertByteExactRoundTrip(filePath, table) {
  const raw = fs.readFileSync(filePath);
  const serialized = Buffer.from(serializeTable(table), 'latin1');
  assert(raw.equals(serialized), `Round-trip non byte-exact: ${filePath}`);
}

function siblingNames(header) {
  if (/code$/i.test(header)) {
    return [
      header.replace(/code$/i, 'param'),
      header.replace(/code$/i, 'min'),
      header.replace(/code$/i, 'max'),
    ];
  }

  const property = header.match(/^(a?)prop(.+)$/i);
  if (property) {
    const prefix = property[1].toLowerCase();
    const suffix = property[2];
    return [`${prefix}par${suffix}`, `${prefix}min${suffix}`, `${prefix}max${suffix}`];
  }

  if (/^([abc] )?mod \d+$/i.test(header)) {
    return [`${header} param`, `${header} min`, `${header} max`];
  }

  return null;
}

function numericValue(value) {
  const text = String(value ?? '').trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

function valuesForFunction(func, param, min, max) {
  if (func === '12' || func === '17') return [param];
  if (func === '5' || func === '15') return [min];
  if (func === '6' || func === '16') return [max];
  return [min, max];
}

function buildPropertyMap() {
  const propertyRows = records(parseTable(path.join(TCP_EXCEL, 'properties.txt')));
  const result = new Map();

  for (const property of propertyRows) {
    for (let index = 1; index <= 7; index += 1) {
      const stat = property[`stat${index}`];
      if (!Object.hasOwn(LEGACY_ENCODING, stat)) continue;
      if (!result.has(property.code)) result.set(property.code, []);
      result.get(property.code).push({ stat, func: property[`func${index}`] });
    }
  }

  return result;
}

function scanLegacyOutOfRange() {
  const propertyMap = buildPropertyMap();
  const hits = [];

  for (const file of ITEM_TABLES) {
    const table = parseTable(path.join(TCP_EXCEL, file));
    const tableRecords = records(table);
    const canonicalHeader = new Map(table.headers.map((header) => [header.toLowerCase(), header]));

    for (const row of tableRecords) {
      for (const header of table.headers) {
        const code = row[header];
        const mappings = propertyMap.get(code);
        if (!mappings) continue;

        const siblings = siblingNames(header);
        if (!siblings) continue;
        const [paramName, minName, maxName] = siblings.map((name) => canonicalHeader.get(name.toLowerCase()));
        if (!paramName || !minName || !maxName) continue;

        for (const mapping of mappings) {
          const legacy = LEGACY_ENCODING[mapping.stat];
          const range = encodingRange(legacy.bits, legacy.add);
          const values = valuesForFunction(
            mapping.func,
            row[paramName],
            row[minName],
            row[maxName],
          );

          for (const rawValue of values) {
            const value = numericValue(rawValue);
            if (value === null || (value >= range.min && value <= range.max)) continue;
            hits.push({
              file,
              entry: row.index || row.Name || row.name || row.description || '<sans nom>',
              property: code,
              stat: mapping.stat,
              value,
              legacyRange: range,
            });
          }
        }
      }
    }
  }

  return hits;
}

function verify() {
  const bk = parseTable(BK_PATH);
  const tcp = parseTable(TCP_PATH);
  assertByteExactRoundTrip(BK_PATH, bk);
  assertByteExactRoundTrip(TCP_PATH, tcp);

  assert(bk.rows.length === 385, `BK: 385 lignes attendues, ${bk.rows.length} trouvees`);
  assert(tcp.rows.length === 416, `TCP: 416 lignes attendues, ${tcp.rows.length} trouvees`);
  assert(tcp.eol === '\r\n', 'TCP itemstatcost.txt doit rester en CRLF');
  assert(identityHash(tcp) === EXPECTED_IDENTITY_HASH,
    'Un Stat, un ID ou l ordre des lignes ItemStatCost a change');

  const bkByStat = indexByStat(bk);
  const tcpByStat = indexByStat(tcp);
  const commonStats = [...bkByStat.keys()].filter((stat) => tcpByStat.has(stat));
  assert(commonStats.length === 372, `${commonStats.length} statistiques communes au lieu de 372`);
  assert([...bkByStat.keys()].filter((stat) => !tcpByStat.has(stat)).length === 13,
    'Le nombre de statistiques exclusives a BK a change');
  assert([...tcpByStat.keys()].filter((stat) => !bkByStat.has(stat)).length === 44,
    'Le nombre de statistiques exclusives a TCP a change');

  const migratedStats = Object.keys(LEGACY_ENCODING);
  assert(migratedStats.length === 38, `${migratedStats.length} statistiques migrees au lieu de 38`);

  let legacyBitsDifferences = 0;
  let legacyAddDifferences = 0;
  for (const stat of migratedStats) {
    const source = bkByStat.get(stat);
    const target = tcpByStat.get(stat);
    assert(source && target, `Statistique de migration absente: ${stat}`);
    const legacy = LEGACY_ENCODING[stat];
    if (legacy.bits !== source['Save Bits']) legacyBitsDifferences += 1;
    if (legacy.add !== source['Save Add']) legacyAddDifferences += 1;

    const oldRange = encodingRange(legacy.bits, legacy.add);
    const newRange = encodingRange(source['Save Bits'], source['Save Add']);
    assert(newRange.min <= oldRange.min && newRange.max >= oldRange.max,
      `La plage BK retrecit la plage TCP historique pour ${stat}`);
    assert(target['Save Bits'] === source['Save Bits'], `Save Bits non migre pour ${stat}`);
    assert(target['Save Add'] === source['Save Add'], `Save Add non migre pour ${stat}`);
  }
  assert(legacyBitsDifferences === 38,
    `${legacyBitsDifferences} ecarts Save Bits historiques au lieu de 38`);
  assert(legacyAddDifferences === 28,
    `${legacyAddDifferences} ecarts Save Add historiques au lieu de 28`);

  const remainingCurrentDifferences = commonStats.filter((stat) => (
    SAVE_FIELDS.some((field) => bkByStat.get(stat)[field] !== tcpByStat.get(stat)[field])
  ));
  assert(remainingCurrentDifferences.length === 0,
    `Ecarts Save Bits/Save Add restants: ${remainingCurrentDifferences.join(', ')}`);

  const hits = scanLegacyOutOfRange();
  const caseKeys = new Set(hits.map((hit) => (
    `${hit.file}|${hit.entry}|${hit.property}|${hit.stat}`
  )));
  const counts = new Map();
  for (const hit of hits) counts.set(hit.stat, (counts.get(hit.stat) || 0) + 1);

  assert(hits.length === 36, `${hits.length} references hors plage historique au lieu de 36`);
  assert(caseKeys.size === 30, `${caseKeys.size} cas uniques au lieu de 30`);
  assert(counts.size === 13, `${counts.size} statistiques a risque au lieu de 13`);
  for (const [stat, expected] of Object.entries(EXPECTED_REFERENCE_COUNTS)) {
    assert(counts.get(stat) === expected,
      `${stat}: ${counts.get(stat) || 0} references au lieu de ${expected}`);
  }

  for (const hit of hits) {
    const current = tcpByStat.get(hit.stat);
    const range = encodingRange(current['Save Bits'], current['Save Add']);
    assert(hit.value >= range.min && hit.value <= range.max,
      `${hit.file} / ${hit.entry}: ${hit.stat}=${hit.value} reste hors plage ${range.min}..${range.max}`);
  }

  console.log('VALID ItemStatCost BK -> TCP');
  console.log('372 stats communes; 38 Save Bits et 28 Save Add migres sur 38 stats actuelles.');
  console.log('Matrice: 36 references, 30 cas uniques, 13 statistiques; 0 cas hors plage apres migration.');
}

function migrate() {
  const bk = parseTable(BK_PATH);
  const tcp = parseTable(TCP_PATH);
  assert(identityHash(tcp) === EXPECTED_IDENTITY_HASH,
    'Migration refusee: un Stat, un ID ou l ordre des lignes ItemStatCost a change');

  const bkStatIndex = bk.headers.indexOf('Stat');
  const tcpStatIndex = tcp.headers.indexOf('Stat');
  const bkFieldIndexes = new Map(SAVE_FIELDS.map((field) => [field, bk.headers.indexOf(field)]));
  const tcpFieldIndexes = new Map(SAVE_FIELDS.map((field) => [field, tcp.headers.indexOf(field)]));
  const bkRows = new Map(bk.rows.map((row) => [row[bkStatIndex], row]));
  let changedCells = 0;

  for (const row of tcp.rows) {
    const stat = row[tcpStatIndex];
    const legacy = LEGACY_ENCODING[stat];
    if (!legacy) continue;
    const source = bkRows.get(stat);
    assert(source, `Statistique absente de BK: ${stat}`);

    for (const field of SAVE_FIELDS) {
      const targetIndex = tcpFieldIndexes.get(field);
      const sourceValue = source[bkFieldIndexes.get(field)];
      const legacyValue = field === 'Save Bits' ? legacy.bits : legacy.add;
      const currentValue = row[targetIndex];
      assert(currentValue === legacyValue || currentValue === sourceValue,
        `${stat}/${field}: valeur inattendue ${currentValue}`);
      if (currentValue !== sourceValue) {
        row[targetIndex] = sourceValue;
        changedCells += 1;
      }
    }
  }

  if (changedCells > 0) writeTable(TCP_PATH, tcp);
  console.log(`Migration ItemStatCost: ${changedCells} cellule(s) modifiee(s).`);
  verify();
}

try {
  if (process.argv.includes('--migrate')) migrate();
  else verify();
} catch (error) {
  console.error(`INVALID ItemStatCost: ${error.message}`);
  process.exitCode = 1;
}
