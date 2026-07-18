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

function lastHeaderIndexes(headers) {
  return new Map(headers.map((header, index) => [header, index]));
}

function prepare(name, selectedColumns = null) {
  assert(path.basename(name) === name, `Nom de table invalide: ${name}`);
  const bk = load('bk', name);
  const tcp = load('tcp', name);
  const target = load('target', name);

  if (!selectedColumns) {
    assert(
      sameValues(bk.table.headers, tcp.table.headers),
      `${name}: structure de colonnes BK/TCP differente`,
    );
  }

  const bkRows = indexedRows(bk.table);
  const tcpRows = indexedRows(tcp.table);
  const targetRows = indexedRows(target.table);
  if (!selectedColumns) {
    assert(
      sameValues([...bkRows.keys()], [...tcpRows.keys()]),
      `${name}: structure de lignes BK/TCP differente`,
    );
  }

  const bkHeaders = lastHeaderIndexes(bk.table.headers);
  const tcpHeaders = lastHeaderIndexes(tcp.table.headers);
  const targetHeaders = lastHeaderIndexes(target.table.headers);
  if (selectedColumns) {
    for (const header of selectedColumns) {
      assert(bk.table.headers.includes(header), `${name}: colonne filtree absente: ${header}`);
      assert(tcp.table.headers.includes(header), `${name}: colonne TCP absente: ${header}`);
      assert(targetHeaders.has(header), `${name}: colonne BKVince absente: ${header}`);
    }
  } else {
    for (const header of bk.table.headers) {
      assert(targetHeaders.has(header), `${name}: colonne BKVince absente: ${header}`);
    }
  }

  const changes = [];
  const comparisonColumns = selectedColumns
    ? [...selectedColumns].map((header) => ({
      header,
      bkIndex: bkHeaders.get(header),
      tcpIndex: tcpHeaders.get(header),
      targetIndex: targetHeaders.get(header),
    }))
    : bk.table.headers.map((header, index) => ({
      header,
      bkIndex: index,
      tcpIndex: index,
      targetIndex: targetHeaders.get(header),
    }));

  for (const [key, tcpRow] of tcpRows) {
    const bkRow = bkRows.get(key);
    if (selectedColumns && !bkRow) continue;
    const targetRow = targetRows.get(key);
    assert(targetRow, `${name}: ligne BKVince absente: ${key.replace('\u0000', ' #')}`);

    for (const {
      header, bkIndex, tcpIndex, targetIndex,
    } of comparisonColumns) {
      const bkValue = bkRow[bkIndex] ?? '';
      const tcpValue = tcpRow[tcpIndex] ?? '';
      if (bkValue === tcpValue) continue;

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
  const columnsOption = args.find((arg) => arg.startsWith('--columns='));
  const expectOption = args.find((arg) => arg.startsWith('--expect-applicable='));
  const selectedColumns = columnsOption
    ? new Set(columnsOption.slice('--columns='.length).split(',').filter(Boolean))
    : null;
  assert(!columnsOption || selectedColumns.size > 0, 'Le filtre --columns est vide');
  const names = args.filter((arg) => (
    arg !== '--apply' && arg !== columnsOption && arg !== expectOption
  )).map((name) => (
    name.toLowerCase().endsWith('.txt') ? name.toLowerCase() : `${name.toLowerCase()}.txt`
  ));
  assert(
    names.length > 0,
    'Usage: node apply-cell-deltas.js [--apply] [--columns=a,b] [--expect-applicable=n] <table...>',
  );

  const prepared = names.map((name) => prepare(name, selectedColumns));
  const applicable = prepared.reduce((count, result) => (
    count + result.changes.filter((change) => change.disposition === 'applicable').length
  ), 0);
  if (expectOption) {
    const expected = Number(expectOption.slice('--expect-applicable='.length));
    assert(Number.isSafeInteger(expected) && expected >= 0, 'Valeur --expect-applicable invalide');
    assert(applicable === expected, `attendu ${expected} cellule(s) applicable(s), obtenu ${applicable}`);
  }
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
