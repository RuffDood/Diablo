'use strict';
// Genere schemas/<table>.json pour chaque table .txt du mod actif, en croisant :
//   - les colonnes REELLES de BKVince 3.2 (TCP 2.4 en repli)
//   - les types + descriptions du guide eezstreet/d2rdoc (source TXT primaire)
//   - l'ancien guide HTML uniquement en repli legacy
// Preserve les champs manuels existants (ref, key, keyColumn, descriptionOverride).
//
// Usage : node scripts/build-data/gen-schemas.js

const fs = require('fs');
const path = require('path');
const { parseTable } = require('./tsv');

const ROOT = path.join(__dirname, '..', '..');
const BKVINCE_EXCEL_DIR = path.join(ROOT, 'data-BKVince', 'BKVince.mpq', 'data', 'global', 'excel');
const TCP_EXCEL_DIR = path.join(ROOT, 'data-TCP', 'global', 'excel');
const D2RDOC_DIR = path.join(ROOT, 'guide', 'd2rdoc');
const D2RDOC_FILES_DIR = path.join(D2RDOC_DIR, 'data', 'files');
const D2RDOC_NOTES = path.join(D2RDOC_DIR, 'contrib', 'community-notes.json');
const LEGACY_GUIDES = [
  path.join(ROOT, 'guide', 'legacy', 'index.html'),
  path.join(ROOT, 'guide', 'index.html'),
];
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

const TYPE_MAP = { N: 'number', B: 'boolean', O: 'text', C: 'text' };
const D2RDOC_TYPE_MAP = {
  int: 'number',
  boolean: 'boolean',
  'inverse boolean': 'boolean',
};
const D2RDOC_SITE = 'https://eezstreet.github.io/d2rdoc';

// Categorisation par domaine de jeu (nav : fil d'Ariane / regroupement des tables).
// 'other' sert de filet pour toute table future non listee ici.
const CATEGORIES = {
  // items
  armor: 'items', automagic: 'items', gamble: 'items', gems: 'items', itemratio: 'items',
  itemstatcost: 'items', itemtypes: 'items', magicprefix: 'items', magicsuffix: 'items',
  misc: 'items', properties: 'items', qualityitems: 'items', runes: 'items', setitems: 'items',
  sets: 'items', transmog_table: 'items', uniqueitems: 'items', uniqueprefix: 'items', weapons: 'items',
  // characters
  charstats: 'characters', hireling: 'characters', monai: 'characters', monlvl: 'characters',
  monpreset: 'characters', monprop: 'characters', monseq: 'characters', monstats: 'characters',
  monstats2: 'characters', monumod: 'characters', npc: 'characters', superuniques: 'characters',
  // skills
  missiles: 'skills', overlay: 'skills', skilldesc: 'skills', skills: 'skills', states: 'skills',
  // system
  actinfo: 'system', cubemain: 'system', difficultylevels: 'system', experience: 'system',
  inventory: 'system', levels: 'system', lvlmaze: 'system', lvlprest: 'system', lvlwarp: 'system',
  objects: 'system', shrines: 'system', sounds: 'system', treasureclassex: 'system',
};

function resolveExcelDir() {
  if (process.env.DIABLO_SCHEMA_EXCEL_DIR) {
    return path.resolve(ROOT, process.env.DIABLO_SCHEMA_EXCEL_DIR);
  }
  return fs.existsSync(BKVINCE_EXCEL_DIR) ? BKVINCE_EXCEL_DIR : TCP_EXCEL_DIR;
}

function decodeHtml(text) {
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
  };
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => entities[entity] || entity);
}

function normalizeDescription(value) {
  return decodeHtml(String(value || '')
    .replace(/\$!([^!]+)!\$/g, (_, ref) => ref.replace('#', '.'))
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function readGuideJs(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error(`Guide TXT invalide: ${filePath}`);
  return JSON.parse(source.slice(start, end + 1));
}

function loadCommunityNotes() {
  if (!fs.existsSync(D2RDOC_NOTES)) return {};
  const notes = {};
  for (const entry of JSON.parse(fs.readFileSync(D2RDOC_NOTES, 'utf8'))) {
    const file = String(entry.file || '').toLowerCase();
    notes[file] ||= {};
    for (const field of entry.fields || []) {
      if (!field.note) continue;
      notes[file][String(field.name || '').toLowerCase()] = normalizeDescription(field.note);
    }
  }
  return notes;
}

// Parse la source structuree eezstreet/d2rdoc. Les appendFiles (notamment shareditems)
// sont fusionnes avant les champs propres de la table, et les altNames deviennent des
// alias de headers afin de documenter les variantes numerotees ou historiques.
function parseD2rDocGuide() {
  if (!fs.existsSync(D2RDOC_FILES_DIR)) return null;
  const raw = {};
  for (const file of fs.readdirSync(D2RDOC_FILES_DIR).filter((name) => name.endsWith('.js'))) {
    raw[path.basename(file, '.js').toLowerCase()] = readGuideJs(path.join(D2RDOC_FILES_DIR, file));
  }

  const notes = loadCommunityNotes();
  const resolved = {};
  const resolving = new Set();

  function resolveTable(name) {
    name = name.toLowerCase();
    if (resolved[name]) return resolved[name];
    if (!raw[name]) return { overview: '', columns: {} };
    if (resolving.has(name)) throw new Error(`Cycle appendFiles dans le guide TXT: ${name}`);
    resolving.add(name);

    const columns = {};
    for (const appendName of raw[name].appendFiles || []) {
      Object.assign(columns, resolveTable(String(appendName)).columns);
    }
    for (const field of raw[name].fields || []) {
      const fieldName = String(field.name || '').trim();
      if (!fieldName) continue;
      const guideType = String(field.type?.type || 'text').toLowerCase();
      const parts = [field.description, field.type?.description].map(normalizeDescription).filter(Boolean);
      const note = notes[name]?.[fieldName.toLowerCase()];
      if (note) parts.push(`Community note: ${note}`);
      const column = {
        type: D2RDOC_TYPE_MAP[guideType] || 'text',
        guideType: `[${guideType}]`,
        description: parts.join(' '),
        guideField: String(field.id || fieldName),
      };
      columns[fieldName.toLowerCase()] = column;
      for (const alias of field.altNames || []) columns[String(alias).toLowerCase()] = column;
    }

    resolving.delete(name);
    resolved[name] = { overview: normalizeDescription(raw[name].overview), columns };
    return resolved[name];
  }

  for (const name of Object.keys(raw)) resolveTable(name);
  return resolved;
}

// Parse l'ancien guide HTML -> { tableName: { overview, columns } }.
// Un h2 peut nommer plusieurs tables partageant les memes colonnes
// (ex. "Armor.txt, Misc.txt, Weapons.txt", "MagicPrefix.txt, MagicSuffix.txt") : chaque nom
// produit une entree au MEME point de depart, et les tables qui recoivent plusieurs sections
// (colonnes communes + section "X.txt only" dediee) doivent les FUSIONNER, pas se les faire ecraser.
function parseLegacyGuide(guidePath) {
  const html = fs.readFileSync(guidePath, 'utf8');
  const secRe = /<h2\s+id="[^"]+"[^>]*>([\s\S]*?)<\/h2>/g;
  const nameRe = /([A-Za-z0-9_]+)\.txt/g;
  const marks = [];
  let m;
  while ((m = secRe.exec(html))) {
    nameRe.lastIndex = 0;
    let n;
    while ((n = nameRe.exec(m[1]))) marks.push({ name: n[1].toLowerCase(), start: m.index });
  }
  // Positions distinctes triees : delimitent le contenu reel. Plusieurs marks peuvent partager
  // le meme start (h2 multi-noms) -- elles lisent toutes jusqu'a la PROCHAINE position distincte.
  const positions = [...new Set(marks.map((mk) => mk.start))].sort((a, b) => a - b);
  // La description va jusqu'a la vraie fin de l'entree (prochain champ, </p>, tableau ou titre) --
  // pas jusqu'au premier tag rencontre, sinon un lien ou un span colore en plein texte la tronque.
  // Un badge [X] (« ne fonctionne pas ») peut precede le badge de type reel -- optionnel.
  const DEPR = '(?:<span[^>]*>\\s*<b>\\[X\\]\\s*<\\/b>\\s*<\\/span>\\s*)?';
  const colRe = new RegExp(
    '<b>([^<]+)<\\/b>\\s*-\\s*' + DEPR + '<span[^>]*>\\s*<b>\\[([NBOC])\\]<\\/b>\\s*<\\/span>\\s*-\\s*' +
    '([\\s\\S]*?)(?=<b>[^<]+<\\/b>\\s*-\\s*' + DEPR + '<span[^>]*>\\s*<b>\\[[NBOC]\\]<\\/b>|<\\/p>|<table|<h[1-6]|$)', 'g'
  );
  const tables = {};
  for (const mark of marks) {
    const posIdx = positions.indexOf(mark.start);
    const end = posIdx + 1 < positions.length ? positions[posIdx + 1] : undefined;
    const body = html.slice(mark.start, end);
    const table = tables[mark.name] || (tables[mark.name] = { overview: '', columns: {} });
    const cols = table.columns;
    colRe.lastIndex = 0;
    let c;
    while ((c = colRe.exec(body))) {
      cols[c[1].trim().toLowerCase()] = {
        type: TYPE_MAP[c[2]] || 'text',
        guideType: '[' + c[2] + ']',
        description: c[3].replace(/<[^>]+>/g, ' ').trim().replace(/\s+/g, ' '),
      };
    }
  }
  return tables;
}

function loadGuide() {
  const current = parseD2rDocGuide();
  if (current) return { kind: 'eezstreet-d2rdoc', tables: current };
  const legacyPath = LEGACY_GUIDES.find((candidate) => fs.existsSync(candidate));
  if (legacyPath) {
    console.warn(`AVERTISSEMENT: guide TXT actuel absent; repli legacy sur ${path.relative(ROOT, legacyPath)}`);
    return { kind: 'legacy-d2r-data-guide', tables: parseLegacyGuide(legacyPath) };
  }
  console.warn('AVERTISSEMENT: aucun guide local; les schemas ne recevront que les types inferes.');
  return { kind: 'none', tables: {} };
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

function writeIfChanged(filePath, contents) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) return false;
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.writeFileSync(filePath, contents);
      return true;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  throw lastError;
}

function main() {
  const excelDir = resolveExcelDir();
  if (!fs.existsSync(excelDir)) throw new Error(`Dossier Excel introuvable: ${excelDir}`);
  const targetName = path.resolve(excelDir) === path.resolve(BKVINCE_EXCEL_DIR) ? 'BKVince 3.2' : 'TCP 2.4';
  const guide = loadGuide();
  if (!fs.existsSync(SCHEMAS_DIR)) fs.mkdirSync(SCHEMAS_DIR);
  const files = fs.readdirSync(excelDir).filter((f) => f.endsWith('.txt')).sort();
  let generated = 0, enriched = 0, changed = 0;
  const categoryIndex = {};

  for (const file of files) {
    const name = file.slice(0, -4);
    const t = parseTable(path.join(excelDir, file));
    const guideTable = guide.tables[name] || null;
    const gcols = guideTable?.columns || {};

    const existingPath = path.join(SCHEMAS_DIR, name + '.json');
    const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, 'utf8')) : null;
    const existingCols = {};
    (existing?.columns || []).forEach((c) => { existingCols[c.name] = c; });

    let docCount = 0;
    const columns = t.headers.map((h, idx) => {
      const ex = existingCols[h] || {};
      const g = gcols[h.toLowerCase().replace(/^\*/, '')] || null;
      const col = { name: h };
      col.type = g?.type || ex.type || inferType(t.rows, idx);
      if (h.startsWith('*')) col.comment = true;
      const desc = ex.descriptionOverride || g?.description || ex.description;
      if (desc) { col.description = desc; docCount++; }
      if (g?.guideType) col.guideType = g.guideType;
      if (g && guide.kind === 'eezstreet-d2rdoc') {
        col.documentationSource = guide.kind;
        col.guideUrl = `${D2RDOC_SITE}/files/${name}.html#${encodeURIComponent(g.guideField)}`;
      }
      if (ex.descriptionOverride) col.descriptionOverride = ex.descriptionOverride;
      if (ex.ref) col.ref = ex.ref;
      if (ex.key) col.key = ex.key;
      return col;
    });

    if (guideTable) enriched++;

    const category = CATEGORIES[name] || existing?.category || 'other';
    categoryIndex[name] = category;

    const schema = {
      table: name,
      category,
      file: 'global/excel/' + file,
      description: existing?.descriptionOverride || guideTable?.overview || existing?.description
        || `Table ${name} du mod ${targetName}.`,
      source: guideTable
        ? `Colonnes du .txt (${targetName}) ; types/descriptions du guide TXT ${guide.kind}.`
        : `Colonnes du .txt (${targetName}) ; types inferes (table absente du guide TXT).`,
      documentation: {
        primary: guide.kind,
        url: guide.kind === 'eezstreet-d2rdoc' ? D2RDOC_SITE : null,
        target: targetName,
      },
      columnsDocumented: docCount,
      columns,
    };
    if (existing?.descriptionOverride) schema.descriptionOverride = existing.descriptionOverride;
    if (existing?.keyColumn) schema.keyColumn = existing.keyColumn;

    if (writeIfChanged(existingPath, JSON.stringify(schema, null, 2) + '\n')) changed++;
    generated++;
  }

  // Manifest agrege table -> categorie, pour lister /api/tables sans lire les 40 schemas
  // un a un (couteux via l'API GitHub en production).
  const categoriesPath = path.join(SCHEMAS_DIR, '_categories.json');
  if (writeIfChanged(categoriesPath, JSON.stringify(categoryIndex, null, 2) + '\n')) changed++;

  console.log(`schemas generes: ${generated} (${enriched} enrichis par ${guide.kind}) depuis ${targetName}; ${changed} fichier(s) modifies`);
}

main();
