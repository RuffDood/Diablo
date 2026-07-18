'use strict';

// Audit en lecture seule des tables BK -> TCP -> BKVince.
//
// BK est l'ancêtre conceptuel. Les changements propres à TCP sont calculés
// cellule par cellule, puis comparés à la cible BKVince convertie pour D2R 3.2.
// Aucune table n'est écrite par ce script.

const fs = require('fs');
const path = require('path');
const { parseTable, serializeTable } = require('../build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCES = Object.freeze({
  bk: path.join(ROOT, 'data-BK', 'global', 'excel'),
  tcp: path.join(ROOT, 'data-TCP', 'global', 'excel'),
  target: path.join(ROOT, 'data-BKVince', 'bkdiablo.mpq', 'data', 'global', 'excel'),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tableNames(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map((entry) => entry.name.toLowerCase());
}

function load(source, name) {
  const filePath = path.join(SOURCES[source], name);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'latin1');
  const table = parseTable(filePath);
  assert(raw === serializeTable(table), `Round-trip non byte-exact: ${filePath}`);
  return table;
}

// La première colonne est la clé métier habituelle des tables D2R. Un numéro
// d'occurrence rend l'alignement déterministe lorsque la clé est vide ou dupliquée.
function indexedRows(table) {
  const occurrences = new Map();
  const rows = new Map();
  for (const row of table.rows) {
    const value = row[0] ?? '';
    const occurrence = occurrences.get(value) || 0;
    occurrences.set(value, occurrence + 1);
    rows.set(`${value}\u0000${occurrence}`, row);
  }
  return { rows, duplicateKeys: [...occurrences.values()].filter((count) => count > 1).length };
}

function headerIndexes(table) {
  return new Map(table.headers.map((header, index) => [header, index]));
}

function audit(name, includeDetails = false) {
  const bk = load('bk', name);
  const tcp = load('tcp', name);
  const target = load('target', name);
  if (!tcp) return { table: name, state: 'tcp-absent' };
  if (!bk) return { table: name, state: 'tcp-only-table' };
  if (!target) return { table: name, state: 'target-absent' };

  const bkRows = indexedRows(bk);
  const tcpRows = indexedRows(tcp);
  const targetRows = indexedRows(target);
  const bkHeaders = headerIndexes(bk);
  const tcpHeaders = headerIndexes(tcp);
  const targetHeaders = headerIndexes(target);
  const commonHeaders = bk.headers.filter((header) => (
    tcpHeaders.has(header) && targetHeaders.has(header)
  ));

  let changedCells = 0;
  let applicableCells = 0;
  let alreadyAppliedCells = 0;
  let conflictingCells = 0;
  let changedRowsMissingFromTarget = 0;
  const details = [];

  for (const [key, tcpRow] of tcpRows.rows) {
    const bkRow = bkRows.rows.get(key);
    if (!bkRow) continue;
    const targetRow = targetRows.rows.get(key);
    let rowChanged = false;

    for (const header of commonHeaders) {
      const sourceValue = bkRow[bkHeaders.get(header)] ?? '';
      const tcpValue = tcpRow[tcpHeaders.get(header)] ?? '';
      if (tcpValue === sourceValue) continue;
      rowChanged = true;
      changedCells += 1;
      if (!targetRow) continue;

      const targetValue = targetRow[targetHeaders.get(header)] ?? '';
      let disposition;
      if (targetValue === sourceValue) {
        applicableCells += 1;
        disposition = 'applicable';
      } else if (targetValue === tcpValue) {
        alreadyAppliedCells += 1;
        disposition = 'already-applied';
      } else {
        conflictingCells += 1;
        disposition = 'conflict';
      }

      if (includeDetails) {
        details.push({
          row: key.replace('\u0000', ' #'),
          column: header,
          bk: sourceValue,
          tcp: tcpValue,
          bkvince: targetValue,
          disposition,
        });
      }
    }

    if (rowChanged && !targetRow) changedRowsMissingFromTarget += 1;
  }

  const addedRows = [...tcpRows.rows.keys()].filter((key) => !bkRows.rows.has(key)).length;
  const removedRows = [...bkRows.rows.keys()].filter((key) => !tcpRows.rows.has(key)).length;
  const tcpOnlyHeaders = tcp.headers.filter((header) => !bkHeaders.has(header));
  const targetOnlyHeaders = target.headers.filter((header) => !bkHeaders.has(header));

  let state = 'automatic-candidate';
  if (conflictingCells || changedRowsMissingFromTarget) state = 'conflict';
  else if (addedRows || removedRows || tcpOnlyHeaders.length) state = 'review-structure';
  else if (changedCells === 0) state = 'no-tcp-delta';
  else if (applicableCells === 0 && alreadyAppliedCells === changedCells) state = 'already-applied';

  return {
    table: name,
    state,
    changedCells,
    applicableCells,
    alreadyAppliedCells,
    conflictingCells,
    addedRows,
    removedRows,
    changedRowsMissingFromTarget,
    tcpOnlyHeaders: tcpOnlyHeaders.length,
    targetOnlyHeaders: targetOnlyHeaders.length,
    duplicateKeys: Math.max(
      bkRows.duplicateKeys,
      tcpRows.duplicateKeys,
      targetRows.duplicateKeys,
    ),
    details,
  };
}

function main() {
  const args = process.argv.slice(2);
  const includeDetails = args.includes('--details');
  const requested = args.filter((arg) => arg !== '--details').map((name) => (
    name.toLowerCase().endsWith('.txt') ? name.toLowerCase() : `${name.toLowerCase()}.txt`
  ));
  const names = requested.length > 0 ? requested : [...new Set([
    ...tableNames(SOURCES.bk),
    ...tableNames(SOURCES.tcp),
    ...tableNames(SOURCES.target),
  ])].sort();

  const results = names.map((name) => audit(name, includeDetails));
  console.table(results.map(({ details, ...summary }) => summary));
  if (includeDetails) {
    for (const result of results) {
      if (!result.details?.length) continue;
      console.log(`\n${result.table}`);
      console.table(result.details);
    }
  }
  const counts = Object.fromEntries(
    [...new Set(results.map((result) => result.state))]
      .sort()
      .map((state) => [state, results.filter((result) => result.state === state).length]),
  );
  console.log(JSON.stringify({ tables: results.length, states: counts }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`INVALID audit BKVince: ${error.message}`);
  process.exitCode = 1;
}
