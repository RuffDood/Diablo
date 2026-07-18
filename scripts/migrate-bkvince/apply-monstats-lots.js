'use strict';

// Porte uniquement les lots monstats explicitement approuves vers BKVince.
// Les valeurs viennent de TCP, mais chaque cellule doit encore correspondre
// soit a BK (applicable), soit a TCP (deja appliquee). Toute autre valeur bloque.

const fs = require('fs');
const path = require('path');
const {
  parseTable,
  serializeTable,
  writeTable,
} = require('../build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const FILES = Object.freeze({
  bk: path.join(ROOT, 'data-BK', 'global', 'excel', 'monstats.txt'),
  tcp: path.join(ROOT, 'data-TCP', 'global', 'excel', 'monstats.txt'),
  target: path.join(
    ROOT,
    'data-BKVince',
    'bkdiablo.mpq',
    'data',
    'global',
    'excel',
    'monstats.txt',
  ),
});

const SAFETY_ROWS = Object.freeze([
  'clawviper1', 'clawviper2', 'clawviper3', 'clawviper4', 'clawviper5',
  'clawviper6', 'clawviper7', 'clawviper8', 'clawviper9', 'clawviper10',
  'willowisp1', 'willowisp2', 'willowisp3', 'willowisp4', 'willowisp5',
  'willowisp6', 'willowisp7', 'willowisp8',
  'bonefetish1', 'bonefetish2', 'bonefetish3', 'bonefetish4', 'bonefetish5',
  'bonefetish6', 'bonefetish7',
  'reanimatedhorde1', 'reanimatedhorde2', 'reanimatedhorde3',
  'reanimatedhorde4', 'reanimatedhorde5', 'reanimatedhorde6',
]);

const SAFETY_COLUMNS = Object.freeze([
  'A1MinD(N)', 'A1MaxD(N)', 'A2MinD(N)', 'A2MaxD(N)',
  'A1MinD(H)', 'A1MaxD(H)', 'A2MinD(H)', 'A2MaxD(H)',
  'S1MinD(N)', 'S1MaxD(N)',
  'El1Pct', 'El1MinD', 'El1MaxD',
  'El1Pct(N)', 'El1MinD(N)', 'El1MaxD(N)',
  'El1Pct(H)', 'El1MinD(H)', 'El1MaxD(H)',
  'El2MaxD', 'El2MaxD(N)', 'El2MaxD(H)',
  'deathDmg',
]);

const MERCENARY_CELLS = Object.freeze({
  roguehire: Object.freeze(['aip1', 'aip1(N)', 'aip1(H)', 'Velocity', 'Run']),
  act3hire: Object.freeze(['aip1', 'aip1(N)', 'aip1(H)']),
});

const RESISTANCE_COLUMNS = Object.freeze([
  'ResPo', 'ResPo(N)', 'ResPo(H)',
  'ResFi(H)', 'ResLi(H)', 'ResCo(H)', 'ResMa(H)',
]);

const EXPECTED = Object.freeze({ safety: 221, mercenaries: 8, resistances: 289 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function load(filePath) {
  const raw = fs.readFileSync(filePath, 'latin1');
  const table = parseTable(filePath);
  assert(raw === serializeTable(table), `Round-trip non byte-exact: ${filePath}`);
  return table;
}

function index(table) {
  return {
    headers: new Map(table.headers.map((header, column) => [header, column])),
    rows: new Map(table.rows.map((row) => [row[0], row])),
  };
}

function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const bk = load(FILES.bk);
  const tcp = load(FILES.tcp);
  const target = load(FILES.target);
  const bkIndex = index(bk);
  const tcpIndex = index(tcp);
  const targetIndex = index(target);
  const originalHeaders = [...target.headers];
  const originalRowIds = target.rows.map((row) => row[0]);
  const changes = [];

  function collect(lot, rowId, column) {
    const bkRow = bkIndex.rows.get(rowId);
    const tcpRow = tcpIndex.rows.get(rowId);
    const targetRow = targetIndex.rows.get(rowId);
    assert(bkRow && tcpRow && targetRow, `${lot}: ligne absente: ${rowId}`);
    assert(bkIndex.headers.has(column), `${lot}: colonne BK absente: ${column}`);
    assert(tcpIndex.headers.has(column), `${lot}: colonne TCP absente: ${column}`);
    assert(targetIndex.headers.has(column), `${lot}: colonne BKVince absente: ${column}`);

    const bkValue = bkRow[bkIndex.headers.get(column)] ?? '';
    const tcpValue = tcpRow[tcpIndex.headers.get(column)] ?? '';
    if (bkValue === tcpValue) return;

    const targetColumn = targetIndex.headers.get(column);
    const targetValue = targetRow[targetColumn] ?? '';
    let disposition;
    if (targetValue === bkValue) disposition = 'applicable';
    else if (targetValue === tcpValue) disposition = 'already-applied';
    else disposition = 'conflict';
    changes.push({
      lot,
      row: rowId,
      column,
      bk: bkValue,
      tcp: tcpValue,
      bkvince: targetValue,
      disposition,
      targetRow,
      targetColumn,
    });
  }

  for (const rowId of SAFETY_ROWS) {
    for (const column of SAFETY_COLUMNS) collect('safety', rowId, column);
  }
  for (const [rowId, columns] of Object.entries(MERCENARY_CELLS)) {
    for (const column of columns) collect('mercenaries', rowId, column);
  }
  for (const rowId of tcpIndex.rows.keys()) {
    if (!bkIndex.rows.has(rowId) || !targetIndex.rows.has(rowId)) continue;
    for (const column of RESISTANCE_COLUMNS) collect('resistances', rowId, column);
  }

  for (const [lot, expected] of Object.entries(EXPECTED)) {
    const actual = changes.filter((change) => change.lot === lot).length;
    assert(actual === expected, `${lot}: ${actual} cellules trouvees, ${expected} attendues`);
  }
  const conflicts = changes.filter((change) => change.disposition === 'conflict');
  assert(conflicts.length === 0, `${conflicts.length} conflit(s) BKVince`);

  console.table(Object.entries(EXPECTED).map(([lot, total]) => ({
    lot,
    total,
    applicable: changes.filter((change) => (
      change.lot === lot && change.disposition === 'applicable'
    )).length,
    alreadyApplied: changes.filter((change) => (
      change.lot === lot && change.disposition === 'already-applied'
    )).length,
  })));

  if (!apply) {
    console.log('CHECK seulement; relancer avec --apply pour ecrire monstats.txt.');
    return;
  }

  for (const change of changes) {
    if (change.disposition === 'applicable') {
      change.targetRow[change.targetColumn] = change.tcp;
    }
  }
  assert(
    JSON.stringify(target.headers) === JSON.stringify(originalHeaders),
    'Les colonnes BKVince ont change',
  );
  assert(
    JSON.stringify(target.rows.map((row) => row[0])) === JSON.stringify(originalRowIds),
    'Les lignes BKVince ont change',
  );
  writeTable(FILES.target, target);
  const written = fs.readFileSync(FILES.target, 'latin1');
  assert(
    written === serializeTable(parseTable(FILES.target)),
    'Validation byte-exact apres ecriture echouee',
  );
  console.log(`APPLIED ${changes.filter((change) => change.disposition === 'applicable').length} cellule(s).`);
}

try {
  main();
} catch (error) {
  console.error(`INVALID migration monstats BKVince: ${error.message}`);
  process.exitCode = 1;
}
