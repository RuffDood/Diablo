'use strict';

// Reconstruit itemtypes.txt pour BKVince 3.2 sans l'ancienne grille
// synthetique skill-id x level heritee de BK. La table finale conserve les
// valeurs et l'ordre semantique BK/ROTW, mais utilise le schema vanilla 3.2.
// Le controle couvre aussi les colonnes connues qui referencent ItemTypes.

const fs = require('fs');
const path = require('path');
const { parseTable, serializeTable, writeTable } = require('../build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_EXCEL = path.join(
  ROOT,
  'data-BKVince',
  'BKVince.mpq',
  'data',
  'global',
  'excel',
);
const BK_EXCEL = path.join(ROOT, 'data-BK', 'global', 'excel');
const VANILLA_EXCEL = path.join(
  ROOT,
  'data-vanilla3.2',
  'data',
  'data',
  'global',
  'excel',
);

const FILES = {
  targetItemTypes: path.join(TARGET_EXCEL, 'itemtypes.txt'),
  sourceItemTypes: path.join(BK_EXCEL, 'itemtypes.txt'),
  vanillaItemTypes: path.join(VANILLA_EXCEL, 'itemtypes.txt'),
  skills: path.join(TARGET_EXCEL, 'skills.txt'),
  magicSuffix: path.join(TARGET_EXCEL, 'magicsuffix.txt'),
};

const EXPECTED_EXTRA_CODES = [
  '2han',
  'ac5',
  'chms',
  'gem5',
  'jwly',
  'merc',
  'orgn',
  'ukey',
];

const REFERENCE_COLUMNS = {
  'armor.txt': ['type', 'type2'],
  'misc.txt': ['type', 'type2'],
  'weapons.txt': ['type', 'type2'],
  'automagic.txt': [
    'itype1', 'itype2', 'itype3', 'itype4', 'itype5', 'itype6', 'itype7',
    'etype1', 'etype2', 'etype3', 'etype4', 'etype5',
  ],
  'magicprefix.txt': [
    'itype1', 'itype2', 'itype3', 'itype4', 'itype5', 'itype6', 'itype7',
    'etype1', 'etype2', 'etype3', 'etype4', 'etype5',
  ],
  'magicsuffix.txt': [
    'itype1', 'itype2', 'itype3', 'itype4', 'itype5', 'itype6', 'itype7',
    'etype1', 'etype2', 'etype3', 'etype4', 'etype5',
  ],
  'runes.txt': [
    'itype1', 'itype2', 'itype3', 'itype4', 'itype5', 'itype6',
    'etype1', 'etype2', 'etype3',
  ],
  'skills.txt': [
    'passiveitype',
    'itypea1', 'itypea2', 'itypea3', 'etypea1', 'etypea2',
    'itypeb1', 'itypeb2', 'itypeb3', 'etypeb1', 'etypeb2',
  ],
  'states.txt': ['itemtype'],
  'charstats.txt': ['TwoHandedOffHandRestrictItemType'],
  'monstats.txt': ['rightArmItemType', 'leftArmItemType'],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTable(filePath, label = path.basename(filePath)) {
  const raw = fs.readFileSync(filePath, 'latin1');
  const table = parseTable(filePath);
  assert(raw === serializeTable(table), `${label}: round-trip non byte-exact`);
  return { raw, table };
}

function indexes(headers) {
  return new Map(headers.map((header, index) => [header, index]));
}

function cell(row, headerIndexes, header) {
  const index = headerIndexes.get(header);
  assert(index !== undefined, `Colonne absente: ${header}`);
  return row[index] ?? '';
}

function cloneTable(table) {
  return {
    headers: [...table.headers],
    rows: table.rows.map((row) => [...row]),
    eol: table.eol,
    hasFinalEol: table.hasFinalEol,
  };
}

function uniqueRow(table, header, value, label) {
  const headerIndexes = indexes(table.headers);
  const index = headerIndexes.get(header);
  assert(index !== undefined, `${label}: colonne ${header} absente`);
  const rows = table.rows.filter((row) => (row[index] ?? '') === value);
  assert(rows.length === 1, `${label}: ${value} attendu une fois, trouve ${rows.length}`);
  return { row: rows[0], index: table.rows.indexOf(rows[0]), headerIndexes };
}

function setCell(table, rowHeader, rowValue, column, expectedBefore, after, label) {
  const match = uniqueRow(table, rowHeader, rowValue, label);
  const columnIndex = match.headerIndexes.get(column);
  assert(columnIndex !== undefined, `${label}: colonne ${column} absente`);
  const before = match.row[columnIndex] ?? '';
  assert(
    expectedBefore.includes(before),
    `${label}: ${rowValue}.${column} vaut ${JSON.stringify(before)}, attendu ${expectedBefore.map(JSON.stringify).join(' ou ')}`,
  );
  match.row[columnIndex] = after;
  return before !== after;
}

function setCellByCriteria(table, criteria, column, expectedBefore, after, label) {
  const headerIndexes = indexes(table.headers);
  const matches = table.rows.filter((row) => Object.entries(criteria).every(([header, value]) => {
    const index = headerIndexes.get(header);
    assert(index !== undefined, `${label}: colonne ${header} absente`);
    return (row[index] ?? '') === value;
  }));
  const description = Object.entries(criteria).map(([key, value]) => `${key}=${value}`).join(', ');
  assert(matches.length === 1, `${label}: ${description} attendu une fois, trouve ${matches.length}`);
  const columnIndex = headerIndexes.get(column);
  assert(columnIndex !== undefined, `${label}: colonne ${column} absente`);
  const before = matches[0][columnIndex] ?? '';
  assert(
    expectedBefore.includes(before),
    `${label}: ${description}.${column} vaut ${JSON.stringify(before)}, attendu ${expectedBefore.map(JSON.stringify).join(' ou ')}`,
  );
  matches[0][columnIndex] = after;
  return before !== after;
}

function nonEmptyCodes(table, label) {
  const headerIndexes = indexes(table.headers);
  const codeIndex = headerIndexes.get('Code');
  assert(codeIndex !== undefined, `${label}: colonne Code absente`);
  const codes = table.rows.map((row) => row[codeIndex] ?? '').filter(Boolean);
  const unique = new Set(codes);
  assert(unique.size === codes.length, `${label}: codes non uniques`);
  return unique;
}

function projectRows(source, headers, rows) {
  const sourceIndexes = indexes(source.headers);
  for (const header of headers) {
    assert(sourceIndexes.has(header), `itemtypes BK: colonne vanilla absente: ${header}`);
  }
  return rows.map((row) => headers.map((header) => row[sourceIndexes.get(header)] ?? ''));
}

function buildExpectedItemTypes(target, source, vanilla) {
  const sourceIndexes = indexes(source.headers);
  const codeIndex = sourceIndexes.get('Code');
  assert(codeIndex !== undefined, 'itemtypes BK: colonne Code absente');

  const syntheticStart = source.rows.findIndex((row) => (row[codeIndex] ?? '') === 'a095');
  assert(syntheticStart === 118, `itemtypes BK: debut synthetique ${syntheticStart}, attendu 118`);

  const semanticRows = source.rows.slice(0, syntheticStart);
  const syntheticRows = source.rows.slice(syntheticStart);
  assert(source.rows.length === 25667, `itemtypes BK: ${source.rows.length} lignes, attendu 25667`);
  assert(syntheticRows.length === 25549, `itemtypes BK: ${syntheticRows.length} lignes synthetiques, attendu 25549`);

  const expected = {
    headers: [...vanilla.headers],
    rows: projectRows(source, vanilla.headers, semanticRows),
    eol: target.eol,
    hasFinalEol: target.hasFinalEol,
  };

  assert(expected.rows.length === 118, `itemtypes final: ${expected.rows.length} lignes, attendu 118`);
  assert(!expected.headers.includes('*skillID'), 'itemtypes final: colonne *skillID interdite');
  assert(!expected.headers.includes('*CTC'), 'itemtypes final: colonne *CTC interdite');

  const vanillaCodes = nonEmptyCodes(vanilla, 'itemtypes vanilla 3.2');
  const expectedCodes = nonEmptyCodes(expected, 'itemtypes final');
  const missingVanilla = [...vanillaCodes].filter((code) => !expectedCodes.has(code));
  assert(missingVanilla.length === 0, `itemtypes final: types vanilla absents: ${missingVanilla.join(', ')}`);
  const extraCodes = [...expectedCodes].filter((code) => !vanillaCodes.has(code)).sort();
  assert(
    JSON.stringify(extraCodes) === JSON.stringify(EXPECTED_EXTRA_CODES),
    `itemtypes final: extras inattendus: ${extraCodes.join(', ')}`,
  );

  const syntheticCodes = new Set(
    syntheticRows.map((row) => row[codeIndex] ?? '').filter(Boolean),
  );
  for (const code of expectedCodes) {
    assert(!syntheticCodes.has(code), `itemtypes final: code synthetique conserve: ${code}`);
  }

  return { expected, syntheticCodes, extraCodes };
}

function validateItemTypeHierarchy(table) {
  const headerIndexes = indexes(table.headers);
  const codes = nonEmptyCodes(table, 'itemtypes final');
  for (const row of table.rows) {
    const code = cell(row, headerIndexes, 'Code');
    for (const header of ['Equiv1', 'Equiv2']) {
      const parent = cell(row, headerIndexes, header);
      assert(!parent || codes.has(parent), `itemtypes final: ${code || '<sans code>'}.${header} -> ${parent} introuvable`);
    }
  }
}

function loadProspectiveTable(fileName, overrides) {
  if (overrides.has(fileName)) return overrides.get(fileName);
  return loadTable(path.join(TARGET_EXCEL, fileName), fileName).table;
}

function validateKnownReferences(itemTypes, overrides) {
  const codes = nonEmptyCodes(itemTypes, 'itemtypes final');
  let references = 0;
  for (const [fileName, columns] of Object.entries(REFERENCE_COLUMNS)) {
    const table = loadProspectiveTable(fileName, overrides);
    const headerIndexes = indexes(table.headers);
    for (const column of columns) {
      const columnIndex = headerIndexes.get(column);
      assert(columnIndex !== undefined, `${fileName}: colonne de reference absente: ${column}`);
      for (const row of table.rows) {
        const value = row[columnIndex] ?? '';
        if (!value) continue;
        references += 1;
        assert(codes.has(value), `${fileName}.${column}: type introuvable: ${value}`);
      }
    }
  }
  return references;
}

function validateNoSyntheticReferences(syntheticCodes, overrides) {
  const files = fs.readdirSync(TARGET_EXCEL)
    .filter((name) => name.endsWith('.txt') && name !== 'itemtypes.txt')
    .sort();
  const hits = [];
  for (const fileName of files) {
    const table = loadProspectiveTable(fileName, overrides);
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < table.headers.length; columnIndex += 1) {
        const value = table.rows[rowIndex][columnIndex] ?? '';
        if (syntheticCodes.has(value)) {
          hits.push(`${fileName}:${rowIndex + 2}:${table.headers[columnIndex]}=${value}`);
        }
        for (const match of value.matchAll(/(?:^|,)type=([^,]+)/g)) {
          if (syntheticCodes.has(match[1])) {
            hits.push(`${fileName}:${rowIndex + 2}:${table.headers[columnIndex]}=type=${match[1]}`);
          }
        }
      }
    }
  }
  assert(hits.length === 0, `References synthetiques restantes:\n  ${hits.join('\n  ')}`);
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const targetItemTypes = loadTable(FILES.targetItemTypes, 'itemtypes BKVince');
  const sourceItemTypes = loadTable(FILES.sourceItemTypes, 'itemtypes BK de reference');
  const vanillaItemTypes = loadTable(FILES.vanillaItemTypes, 'itemtypes vanilla 3.2');
  const skillsLoaded = loadTable(FILES.skills, 'skills BKVince');
  const suffixLoaded = loadTable(FILES.magicSuffix, 'magicsuffix BKVince');

  const { expected, syntheticCodes, extraCodes } = buildExpectedItemTypes(
    targetItemTypes.table,
    sourceItemTypes.table,
    vanillaItemTypes.table,
  );

  const expectedSkills = cloneTable(skillsLoaded.table);
  setCell(
    expectedSkills,
    'skill',
    'Summon Splash',
    'passiveitype',
    ['L916', ''],
    '',
    'skills.txt',
  );

  const expectedSuffix = cloneTable(suffixLoaded.table);
  setCellByCriteria(
    expectedSuffix,
    { Name: 'of Lower Resist', level: '70' },
    'itype4',
    ['wa', 'wand'],
    'wand',
    'magicsuffix.txt',
  );

  validateItemTypeHierarchy(expected);
  const overrides = new Map([
    ['skills.txt', expectedSkills],
    ['magicsuffix.txt', expectedSuffix],
  ]);
  const referenceCount = validateKnownReferences(expected, overrides);
  validateNoSyntheticReferences(syntheticCodes, overrides);

  const outputs = [
    { name: 'itemtypes.txt', filePath: FILES.targetItemTypes, before: targetItemTypes.raw, table: expected },
    { name: 'skills.txt', filePath: FILES.skills, before: skillsLoaded.raw, table: expectedSkills },
    { name: 'magicsuffix.txt', filePath: FILES.magicSuffix, before: suffixLoaded.raw, table: expectedSuffix },
  ];
  const changed = outputs
    .filter((output) => output.before !== serializeTable(output.table))
    .map((output) => output.name);

  if (checkOnly) {
    assert(changed.length === 0, `Reconstruction itemtypes perimee: ${changed.join(', ')}`);
  } else {
    for (const output of outputs) {
      if (changed.includes(output.name)) writeTable(output.filePath, output.table);
    }
  }

  console.log(JSON.stringify({
    mode: checkOnly ? 'check' : 'generate',
    changed,
    beforeRows: sourceItemTypes.table.rows.length,
    finalRows: expected.rows.length,
    removedSyntheticRows: sourceItemTypes.table.rows.length - expected.rows.length,
    vanillaRows: vanillaItemTypes.table.rows.length,
    customCodes: extraCodes,
    removedCommentColumns: ['*skillID', '*CTC'],
    resolvedReferences: referenceCount,
    summonSplashGate: 'unconditional (L916 removed)',
    lowerResistType: 'wand',
  }, null, 2));
}

main();
