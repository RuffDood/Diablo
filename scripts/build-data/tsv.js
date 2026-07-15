'use strict';
// Parseur / ecrivain TSV pour les tables .txt D2R.
//
// Integrite : l'encodage de transport 'latin1' mappe chaque octet 0-255 a un
// caractere de facon reversible. Lire puis reecrire sans modification donne un
// resultat byte-exact, quel que soit l'encodage reel du fichier. Les fins de
// ligne (CRLF/LF) et la presence d'un saut de ligne final sont preservees.

const fs = require('fs');

const ENCODING = 'latin1';

function parseTable(filePath) {
  const raw = fs.readFileSync(filePath, ENCODING);
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const hasFinalEol = raw.endsWith(eol);
  const body = hasFinalEol ? raw.slice(0, -eol.length) : raw;
  const lines = body.length === 0 ? [] : body.split(eol);
  const headers = lines.length ? lines[0].split('\t') : [];
  const rows = lines.slice(1).map((line) => line.split('\t'));
  return { headers, rows, eol, hasFinalEol };
}

function serializeTable(table) {
  const { headers, rows, eol, hasFinalEol } = table;
  const lines = [headers.join('\t'), ...rows.map((r) => r.join('\t'))];
  let out = lines.join(eol);
  if (hasFinalEol) out += eol;
  return out;
}

function writeTable(filePath, table) {
  const out = serializeTable(table);
  // ecriture atomique : fichier temporaire puis rename
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, out, ENCODING);
  fs.renameSync(tmp, filePath);
}

module.exports = { parseTable, serializeTable, writeTable, ENCODING };
