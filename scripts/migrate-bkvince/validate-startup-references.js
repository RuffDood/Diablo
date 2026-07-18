'use strict';

// Controle cible des references qui faisaient echouer les assertions de
// chargement de BKVince sous D2RLoader 3.2. Ce script est strictement en
// lecture seule et verifie aussi le round-trip byte-exact des tables.

const fs = require('fs');
const path = require('path');
const { parseTable, serializeTable } = require('../build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const EXCEL = path.join(
  ROOT,
  'data-BKVince',
  'bkdiablo.mpq',
  'data',
  'global',
  'excel',
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function load(name) {
  const filePath = path.join(EXCEL, name);
  const raw = fs.readFileSync(filePath, 'latin1');
  const table = parseTable(filePath);
  assert(raw === serializeTable(table), `Round-trip non byte-exact: ${filePath}`);
  return table;
}

function headerIndexes(table) {
  return new Map(table.headers.map((header, index) => [header, index]));
}

function uniqueRow(table, key, tableName) {
  const rows = table.rows.filter((row) => row[0] === key);
  assert(rows.length === 1, `${tableName}: ${key} attendu une fois, trouve ${rows.length}`);
  return rows[0];
}

function value(row, indexes, header, tableName) {
  const index = indexes.get(header);
  assert(index !== undefined, `${tableName}: colonne ${header} absente`);
  return row[index] ?? '';
}

function main() {
  const skilldesc = load('skilldesc.txt');
  const missiles = load('missiles.txt');
  const treasureClasses = load('treasureclassex.txt');
  const skilldescIndexes = headerIndexes(skilldesc);
  const treasureIndexes = headerIndexes(treasureClasses);

  const eruption = uniqueRow(skilldesc, 'eruption', 'skilldesc.txt');
  const eruptionFormula = value(
    eruption,
    skilldescIndexes,
    'dsc2calca3',
    'skilldesc.txt',
  );
  const missileMatch = /^miss\('([^']+)'\.rang\)$/.exec(eruptionFormula);
  assert(missileMatch, `skilldesc.txt: formule Eruption invalide: ${eruptionFormula}`);
  uniqueRow(missiles, missileMatch[1], 'missiles.txt');

  const essence = uniqueRow(
    treasureClasses,
    'Andariel Essence (H)',
    'treasureclassex.txt',
  );
  assert(value(essence, treasureIndexes, 'Picks', 'treasureclassex.txt') === '1',
    'treasureclassex.txt: Picks invalide pour Andariel Essence (H)');
  assert(value(essence, treasureIndexes, 'Item1', 'treasureclassex.txt') === 'tes',
    'treasureclassex.txt: Item1 invalide pour Andariel Essence (H)');
  assert(value(essence, treasureIndexes, 'Prob1', 'treasureclassex.txt') === '1',
    'treasureclassex.txt: Prob1 invalide pour Andariel Essence (H)');

  const andarielHell = uniqueRow(treasureClasses, 'Andariel (H)', 'treasureclassex.txt');
  assert(value(andarielHell, treasureIndexes, 'Item1', 'treasureclassex.txt')
    === 'Andariel Essence (H)',
  'treasureclassex.txt: Andariel (H) ne reference pas Andariel Essence (H)');
  assert(value(andarielHell, treasureIndexes, 'Prob1', 'treasureclassex.txt') === '1',
    'treasureclassex.txt: probabilite de la classe essence invalide pour Andariel (H)');

  const riftNightmare = uniqueRow(
    treasureClasses,
    'Rift Crafts (N) Premium',
    'treasureclassex.txt',
  );
  const riftBase = uniqueRow(
    treasureClasses,
    'Rift Crafts Premium',
    'treasureclassex.txt',
  );
  assert(treasureClasses.rows.indexOf(riftNightmare) < treasureClasses.rows.indexOf(riftBase),
    'treasureclassex.txt: Rift Crafts (N) Premium doit preceder son appelant');
  assert(value(riftBase, treasureIndexes, 'Item1', 'treasureclassex.txt')
    === 'Rift Crafts (N) Premium',
  'treasureclassex.txt: la progression Normal -> Nightmare des crafts Rift est invalide');

  console.log('VALID : references BKVince de demarrage resolues');
  console.log(`  Eruption -> ${missileMatch[1]}`);
  console.log('  Andariel (H) -> Andariel Essence (H) -> tes');
  console.log('  Rift Crafts (N) Premium precede Rift Crafts Premium');
}

main();
