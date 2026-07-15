'use strict';
// Genere schemas/<table>.json pour chaque table .txt du mod TCP, en croisant :
//   - les colonnes REELLES du .txt (verite du mod)
//   - les types + descriptions du D2R Data Guide (guide/index.html), par nom de colonne
// Preserve les champs manuels existants (ref, key, keyColumn, description) des schemas deja presents.
//
// Usage : node scripts/build-data/gen-schemas.js

const fs = require('fs');
const path = require('path');
const { parseTable } = require('./tsv');

const ROOT = path.join(__dirname, '..', '..');
const EXCEL_DIR = path.join(ROOT, 'data-TCP', 'global', 'excel');
const GUIDE = path.join(ROOT, 'guide', 'index.html');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

const TYPE_MAP = { N: 'number', B: 'boolean', O: 'text', C: 'text' };

// Parse le guide -> { tableName(lowercase): { colName(lowercase): {type, guideType, description} } }
function parseGuide() {
  if (!fs.existsSync(GUIDE)) return {};
  const html = fs.readFileSync(GUIDE, 'utf8');
  const tables = {};
  const secRe = /<h2\s+id="[^"]+"[^>]*>\s*([A-Za-z0-9_]+)\.txt/g;
  const marks = [];
  let m;
  while ((m = secRe.exec(html))) marks.push({ name: m[1].toLowerCase(), start: m.index });
  const colRe = /<b>([^<]+)<\/b>\s*-\s*<span[^>]*>\s*<b>\[([NBOC])\]<\/b>\s*<\/span>\s*-\s*([^<]*)/g;
  for (let i = 0; i < marks.length; i++) {
    const body = html.slice(marks[i].start, i + 1 < marks.length ? marks[i + 1].start : undefined);
    const cols = {};
    let c;
    while ((c = colRe.exec(body))) {
      cols[c[1].trim().toLowerCase()] = {
        type: TYPE_MAP[c[2]] || 'text',
        guideType: '[' + c[2] + ']',
        description: c[3].trim().replace(/\s+/g, ' '),
      };
    }
    tables[marks[i].name] = cols;
  }
  return tables;
}

// Infere le type d'une colonne depuis les donnees : number si toutes les valeurs non-vides sont entieres.
function inferType(rows, colIdx) {
  let seen = false;
  for (const r of rows) {
    const v = r[colIdx];
    if (v === undefined || v === '') continue;
    seen = true;
    if (!/^-?\d+$/.test(v)) return 'text';
  }
  return seen ? 'number' : 'text';
}

function main() {
  const guide = parseGuide();
  if (!fs.existsSync(SCHEMAS_DIR)) fs.mkdirSync(SCHEMAS_DIR);
  const files = fs.readdirSync(EXCEL_DIR).filter((f) => f.endsWith('.txt')).sort();
  let generated = 0, enriched = 0;

  for (const file of files) {
    const name = file.slice(0, -4);
    const t = parseTable(path.join(EXCEL_DIR, file));
    const gcols = guide[name] || {};

    const existingPath = path.join(SCHEMAS_DIR, name + '.json');
    const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, 'utf8')) : null;
    const existingCols = {};
    (existing?.columns || []).forEach((c) => { existingCols[c.name] = c; });

    let docCount = 0;
    const columns = t.headers.map((h, idx) => {
      const ex = existingCols[h] || {};
      const g = gcols[h.toLowerCase().replace(/^\*/, '')] || null;
      const col = { name: h };
      col.type = ex.type || g?.type || inferType(t.rows, idx);
      if (h.startsWith('*')) col.comment = true;
      const desc = ex.description || g?.description;
      if (desc) { col.description = desc; docCount++; }
      if (g?.guideType) col.guideType = g.guideType;
      if (ex.ref) col.ref = ex.ref;
      if (ex.key) col.key = ex.key;
      return col;
    });

    if (guide[name]) enriched++;

    const schema = {
      table: name,
      file: 'global/excel/' + file,
      description: existing?.description
        || (guide[name] ? `Table ${name} du mod TCP (colonnes documentees via le D2R Data Guide).` : `Table ${name} du mod TCP.`),
      source: guide[name]
        ? 'Colonnes du .txt (mod TCP) ; types/descriptions du D2R Data Guide (guide/).'
        : 'Colonnes et types inferes du .txt (table non couverte par le guide).',
      columnsDocumented: docCount,
      columns,
    };
    if (existing?.keyColumn) schema.keyColumn = existing.keyColumn;

    fs.writeFileSync(existingPath, JSON.stringify(schema, null, 2) + '\n');
    generated++;
  }

  console.log(`schemas generes: ${generated} (${enriched} enrichis par le guide)`);
}

main();
