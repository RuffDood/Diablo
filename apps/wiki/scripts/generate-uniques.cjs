'use strict';
// Genere apps/wiki/src/data/uniques.json depuis uniqueitems.txt (TCP) croise avec
// excel-vanilla/uniqueitems.txt. Appariement par la colonne "index" (le nom interne
// de l'objet unique, stable — pas par position de ligne, TCP ajoute ses uniques a la
// suite des uniques vanilla sans les reordonner).
//
// Usage : node apps/wiki/scripts/generate-uniques.js

const fs = require('fs');
const path = require('path');
const { parseTable } = require('../../../scripts/build-data/tsv');

const ROOT = path.join(__dirname, '..', '..', '..');
const TCP_FILE = path.join(ROOT, 'data-TCP', 'global', 'excel', 'uniqueitems.txt');
const VANILLA_FILE = path.join(ROOT, 'excel-vanilla', 'uniqueitems.txt');
const OUT_FILE = path.join(__dirname, '..', 'src', 'data', 'uniques.json');

const CORE_FIELDS = [
  { key: 'itemName', col: '*ItemName', label: 'Objet de base' },
  { key: 'code', col: 'code', label: 'Code' },
  { key: 'lvl', col: 'lvl', label: 'Niveau objet' },
  { key: 'lvlReq', col: 'lvl req', label: 'Niveau requis' },
];
const PROP_SLOTS = 12;

function slugify(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function indexColumns(headers) {
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  return idx;
}

function propSlots(row, idx) {
  const slots = [];
  for (let n = 1; n <= PROP_SLOTS; n++) {
    const prop = row[idx[`prop${n}`]] ?? '';
    if (prop === '') continue;
    slots.push({
      slot: n,
      prop,
      par: row[idx[`par${n}`]] ?? '',
      min: row[idx[`min${n}`]] ?? '',
      max: row[idx[`max${n}`]] ?? '',
    });
  }
  return slots;
}

function propSlotsDiffer(a, b) {
  if (!a || !b) return true;
  return a.prop !== b.prop || a.par !== b.par || a.min !== b.min || a.max !== b.max;
}

function main() {
  const tcp = parseTable(TCP_FILE);
  const vanilla = parseTable(VANILLA_FILE);
  const tIdx = indexColumns(tcp.headers);
  const vIdx = indexColumns(vanilla.headers);

  const vanillaByName = new Map();
  vanilla.rows.forEach((row) => {
    const name = row[vIdx.index];
    if (name) vanillaByName.set(name, row);
  });

  const usedSlugs = new Set();
  const items = tcp.rows
    .filter((row) => row[tIdx.index] && row[tIdx.index] !== 'Expansion') // ligne(s) vide(s)/separateur eventuelles
    .map((row, rowPos) => {
      const name = row[tIdx.index];
      const vRow = vanillaByName.get(name);
      const isNew = !vRow;

      let slug = slugify(name);
      if (usedSlugs.has(slug)) slug = `${slug}-${rowPos}`;
      usedSlugs.add(slug);

      const fields = {};
      const diffFields = [];
      for (const f of CORE_FIELDS) {
        const tVal = row[tIdx[f.col]] ?? '';
        const vVal = vRow ? (vRow[vIdx[f.col]] ?? '') : null;
        fields[f.key] = { label: f.label, value: tVal, vanilla: vVal };
        if (!isNew && vVal !== tVal) diffFields.push(f.key);
      }

      const tProps = propSlots(row, tIdx);
      const vProps = vRow ? propSlots(vRow, vIdx) : [];
      const properties = tProps.map((p) => ({
        ...p,
        diff: isNew || propSlotsDiffer(p, vProps.find((v) => v.slot === p.slot)),
      }));

      return {
        name,
        slug,
        isNew,
        diffFields,
        fields,
        properties,
        propertiesRemovedFromVanilla: isNew ? [] : vProps.filter((v) => !tProps.some((p) => p.slot === v.slot)).map((v) => v.slot),
      };
    });

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: items.length,
    newCount: items.filter((i) => i.isNew).length,
    changedCount: items.filter((i) => !i.isNew && (i.diffFields.length > 0 || i.properties.some((p) => p.diff) || i.propertiesRemovedFromVanilla.length > 0)).length,
    items,
  }, null, 1) + '\n');

  console.log(`uniques.json genere : ${items.length} objets (${items.filter((i) => i.isNew).length} nouveaux)`);
}

main();
