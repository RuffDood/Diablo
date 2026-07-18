'use strict';

// Rejoue uniquement les changements de cellules BK -> TCP sur BKVince.
//
// Garde-fous : aucune ligne ni colonne ne peut avoir ete ajoutee/supprimee
// entre BK et TCP, toutes les lignes doivent exister dans BKVince et toute
// valeur BKVince concurrente bloque l'ecriture. Sans --apply, lecture seule.

const fs = require('fs');
const path = require('path');
const {
  parseTable,
  serializeTable,
  writeTable,
} = require('../build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCES = Object.freeze({
  bk: path.join(ROOT, 'data-BK', 'global', 'excel'),
  tcp: path.join(ROOT, 'data-TCP', 'global', 'excel'),
  target: path.join(ROOT, 'data-BKVince', 'bkdiablo.mpq', 'data', 'global', 'excel'),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function load(source, name) {
  const filePath = path.join(SOURCES[source], name);
  assert(fs.existsSync(filePath), `Table absente: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'latin1');
  const table = parseTable(filePath);
  assert(raw === serializeTable(table), `Round-trip non byte-exact: ${filePath}`);
  return { filePath, table };
}

function indexedRows(table) {
  const occurrences = new Map();
  const rows = new Map();
  for (const row of table.rows) {
    const value = row[0] ?? '';
    const occurrence = occurrences.get(value) || 0;
    occurrences.set(value, occurrence + 1);
    rows.set(`${value}\u0000${occurrence}`, row);
  }
  return rows;
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function prepare(name) {
  assert(path.basename(name) === name, `Nom de table invalide: ${name}`);
  const bk = load('bk', name);
  const tcp = load('tcp', name);
  const target = load('target', name);

  assert(
    sameValues(bk.table.headers, tcp.table.headers),
    `${name}: structure de colonnes BK/TCP differente`,
  );

  const bkRows = indexedRows(bk.table);
  const tcpRows = indexedRows(tcp.table);
  const targetRows = indexedRows(target.table);
  assert(
    sameValues([...bkRows.keys()], [...tcpRows.keys()]),
    `${name}: structure de lignes BK/TCP differente`,
  );

  const targetHeaders = new Map(target.table.headers.map((header, index) => [header, index]));
  for (const header of bk.table.headers) {
    assert(targetHeaders.has(header), `${name}: colonne BKVince absente: ${header}`);
  }

  const changes = [];
  for (const [key, tcpRow] of tcpRows) {
    const bkRow = bkRows.get(key);
    const targetRow = targetRows.get(key);
    assert(targetRow, `${name}: ligne BKVince absente: ${key.replace('\u0000', ' #')}`);

    for (let sourceIndex = 0; sourceIndex < bk.table.headers.length; sourceIndex += 1) {
      const bkValue = bkRow[sourceIndex] ?? '';
      const tcpValue = tcpRow[sourceIndex] ?? '';
      if (bkValue === tcpValue) continue;

      const header = bk.table.headers[sourceIndex];
      const targetIndex = targetHeaders.get(header);
      const targetValue = targetRow[targetIndex] ?? '';
      let disposition;
      if (targetValue === bkValue) disposition = 'applicable';
      else if (targetValue === tcpValue) disposition = 'already-applied';
      else disposition = 'conflict';

      changes.push({
        row: key.replace('\u0000', ' #'),
        column: header,
        bk: bkValue,
        tcp: tcpValue,
        bkvince: targetValue,
        disposition,
        targetRow,
        targetIndex,
      });
    }
  }

  const conflicts = changes.filter((change) => change.disposition === 'conflict');
  assert(conflicts.length === 0, `${name}: ${conflicts.length} conflit(s) BKVince`);
  return { name, target, changes };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const names = args.filter((arg) => arg !== '--apply').map((name) => (
    name.toLowerCase().endsWith('.txt') ? name.toLowerCase() : `${name.toLowerCase()}.txt`
  ));
  assert(names.length > 0, 'Usage: node apply-cell-deltas.js [--apply] <table...>');

  const prepared = names.map(prepare);
  for (const result of prepared) {
    const report = result.changes.map(({ targetRow, targetIndex, ...change }) => change);
    console.log(`\n${result.name}`);
    console.table(report);
  }

  if (!apply) {
    console.log('\nCHECK seulement; relancer avec --apply pour ecrire la cible BKVince.');
    return;
  }

  for (const result of prepared) {
    for (const change of result.changes) {
      if (change.disposition === 'applicable') {
        change.targetRow[change.targetIndex] = change.tcp;
      }
    }
    writeTable(result.target.filePath, result.target.table);
    const written = fs.readFileSync(result.target.filePath, 'latin1');
    assert(
      written === serializeTable(parseTable(result.target.filePath)),
      `${result.name}: validation byte-exact apres ecriture echouee`,
    );
  }

  const applied = prepared.reduce((count, result) => (
    count + result.changes.filter((change) => change.disposition === 'applicable').length
  ), 0);
  console.log(`\nAPPLIED ${applied} cellule(s) dans ${prepared.length} table(s) BKVince.`);
}

try {
  main();
} catch (error) {
  console.error(`INVALID merge BKVince: ${error.message}`);
  process.exitCode = 1;
}
