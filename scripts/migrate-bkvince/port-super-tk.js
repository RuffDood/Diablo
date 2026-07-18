'use strict';

// Porte SuperTK depuis TCP vers BKVince 3.2. La ligne est reconstruite depuis
// Telekinesis 3.2 afin de conserver les 45 colonnes ajoutees au format moderne.
// Les lignes Command existantes ne sont jamais deplacees dans skills.txt : leur
// ID positionnel reste donc stable pour les sauvegardes deja utilisees.

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
const TARGET_EXCEL = path.join(ROOT, 'data-BKVince', 'BKVince.mpq', 'data', 'global', 'excel');

const FILES = Object.freeze({
  charStats: path.join(TARGET_EXCEL, 'charstats.txt'),
  skills: path.join(TARGET_EXCEL, 'skills.txt'),
});

const CLASS_COMMANDS = Object.freeze([
  ['Amazon', 'CommandAma'],
  ['Sorceress', 'CommandSor'],
  ['Necromancer', 'CommandNec'],
  ['Paladin', 'CommandPal'],
  ['Barbarian', 'CommandBar'],
  ['Druid', 'CommandDru'],
  ['Assassin', 'CommandAss'],
  ['Warlock', 'CommandWar'],
]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function indexes(headers) {
  return Object.fromEntries(headers.map((header, index) => [header, index]));
}

function sameRow(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function writeTableIfChanged(document) {
  const output = serializeTable(document.table);
  if (output === document.raw) return false;
  writeTable(document.filePath, document.table);
  return true;
}

function buildSuperTkRow(table) {
  const headerIndexes = indexes(table.headers);
  const telekinesis = table.rows.find((row) => row[headerIndexes.skill] === 'Telekinesis');
  assert(telekinesis, 'skills: ligne Telekinesis 3.2 absente');
  const row = telekinesis.slice();

  const overrides = {
    skill: 'SuperTK',
    '*Id': '9999', // Colonne commentaire; le vrai ID vient de la position de la ligne.
    charclass: '',
    leftskill: '0',
    EMaxLev2: '',
    EMaxLev3: '',
    EMaxLev4: '',
    EMaxLev5: '',
    'cost mult': '',
  };
  for (const [header, value] of Object.entries(overrides)) {
    assert(headerIndexes[header] !== undefined, `skills: colonne ${header} absente`);
    row[headerIndexes[header]] = value;
  }

  // Deux nombres de l'ancienne ligne TCP etaient places dans des colonnes de
  // commentaires, et MinLevDam5=13 ne participe pas aux degats elementaires de
  // srvdofunc 21. Ils ne sont volontairement pas recopies en 3.2.
  return row;
}

function prepareSkills(document, changed) {
  const headerIndexes = indexes(document.table.headers);
  assert(headerIndexes.skill !== undefined, 'skills: colonne skill absente');
  const rows = document.table.rows;
  const commandIndexes = CLASS_COMMANDS.map(([, command]) => {
    const index = rows.findIndex((row) => row[headerIndexes.skill] === command);
    assert(index >= 0, `skills: ${command} absent; executer d'abord le port Command`);
    return index;
  });
  const expected = buildSuperTkRow(document.table);
  const matches = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row[headerIndexes.skill] === 'SuperTK');

  assert(matches.length <= 1, `skills: ${matches.length} lignes SuperTK trouvees`);
  if (matches.length === 0) {
    assert(!CHECK_ONLY, 'skills: SuperTK absent');
    if (!CHECK_ONLY) {
      rows.push(expected);
      changed.push('skills.txt');
    }
    return;
  }

  const [{ row, index }] = matches;
  assert(sameRow(row, expected), 'skills: ligne SuperTK differente du port TCP/3.2 attendu');
  assert(index > Math.max(...commandIndexes), 'skills: SuperTK doit rester apres les lignes Command pour ne pas changer leurs IDs');
}

function prepareCharStats(document, changed) {
  const headerIndexes = indexes(document.table.headers);
  for (const header of ['class', 'Skill 9', 'Skill 10']) {
    assert(headerIndexes[header] !== undefined, `charstats: colonne ${header} absente`);
  }
  const byClass = new Map(document.table.rows.map((row) => [row[headerIndexes.class], row]));

  for (const [className, command] of CLASS_COMMANDS) {
    const row = byClass.get(className);
    assert(row, `charstats: classe ${className} absente`);
    const skill9 = row[headerIndexes['Skill 9']] ?? '';
    const skill10 = row[headerIndexes['Skill 10']] ?? '';

    if (skill9 === command && skill10 === 'SuperTK') continue;

    assert(!CHECK_ONLY, `charstats: SuperTK/Command absent pour ${className}`);
    assert(skill10 === command, `charstats: Skill 10 de ${className} devrait contenir ${command}, recu ${skill10}`);
    const expectedSkill9 = className === 'Barbarian' ? 'Unsummon' : '';
    assert(skill9 === expectedSkill9, `charstats: Skill 9 de ${className} occupe par ${skill9}`);

    if (!CHECK_ONLY) {
      row[headerIndexes['Skill 9']] = command;
      row[headerIndexes['Skill 10']] = 'SuperTK';
      if (!changed.includes('charstats.txt')) changed.push('charstats.txt');
    }
  }
}

function validateFinal(documents) {
  const skillIndexes = indexes(documents.skills.table.headers);
  const superTkRows = documents.skills.table.rows.filter((row) => row[skillIndexes.skill] === 'SuperTK');
  assert(superTkRows.length === 1, `skills final: une ligne SuperTK attendue, recu ${superTkRows.length}`);
  assert(sameRow(superTkRows[0], buildSuperTkRow(documents.skills.table)), 'skills final: SuperTK different');

  const charIndexes = indexes(documents.charStats.table.headers);
  const byClass = new Map(documents.charStats.table.rows.map((row) => [row[charIndexes.class], row]));
  for (const [className, command] of CLASS_COMMANDS) {
    const row = byClass.get(className);
    assert(row[charIndexes['Skill 9']] === command, `charstats final: Skill 9 ${className} != ${command}`);
    assert(row[charIndexes['Skill 10']] === 'SuperTK', `charstats final: Skill 10 ${className} != SuperTK`);
  }
}

function main() {
  const documents = {
    charStats: loadTable(FILES.charStats, 'charstats BKVince'),
    skills: loadTable(FILES.skills, 'skills BKVince'),
  };
  const changed = [];

  prepareSkills(documents.skills, changed);
  prepareCharStats(documents.charStats, changed);

  if (CHECK_ONLY) {
    assert(changed.length === 0, `portage incomplet: ${changed.join(', ')}`);
  } else {
    writeTableIfChanged(documents.skills);
    writeTableIfChanged(documents.charStats);
  }

  const finalDocuments = {
    charStats: loadTable(FILES.charStats, 'charstats final'),
    skills: loadTable(FILES.skills, 'skills final'),
  };
  validateFinal(finalDocuments);

  const skillIndexes = indexes(finalDocuments.skills.table.headers);
  const superTkIndex = finalDocuments.skills.table.rows.findIndex((row) => row[skillIndexes.skill] === 'SuperTK');
  console.log(JSON.stringify({
    mode: CHECK_ONLY ? 'check' : 'write',
    changed,
    classes: CLASS_COMMANDS.length,
    superTkRowIndex: superTkIndex,
    srvstfunc: finalDocuments.skills.table.rows[superTkIndex][skillIndexes.srvstfunc],
    srvdofunc: finalDocuments.skills.table.rows[superTkIndex][skillIndexes.srvdofunc],
    description: finalDocuments.skills.table.rows[superTkIndex][skillIndexes.skilldesc],
  }, null, 2));
}

main();
