import fs from 'node:fs';
import path from 'node:path';
import catalog from '../src/data/bkvince-catalog.json' with { type: 'json' };
import { createUniqueItemRecord } from '../src/lib/item-writer.js';
import { readUniqueMiscItemRecord } from '../src/lib/item-reader.js';
import { insertItemRecord } from '../src/lib/save-editor.js';

function usage() {
  process.stderr.write('Usage: npm run forge:save -w apps/hero-editor -- <input.d2s> <output.d2s> <unique name> [min|max|random] [x] [y]\n');
  process.exit(2);
}

const [, , inputPath, outputPath, uniqueName, roll = 'max', xRaw = '10', yRaw = '7'] = process.argv;
if (!inputPath || !outputPath || !uniqueName) usage();
if (path.resolve(inputPath) === path.resolve(outputPath)) {
  throw new Error('Input and output must be different files; the forge never overwrites the source save.');
}

const unique = catalog.uniqueItems.find((item) => item.name.toLowerCase() === uniqueName.toLowerCase());
if (!unique) throw new Error(`Unique not found in BKVince catalog: ${uniqueName}`);

const item = createUniqueItemRecord(catalog, unique, {
  roll,
  x: Number.parseInt(xRaw, 10),
  y: Number.parseInt(yRaw, 10),
});
const decoded = readUniqueMiscItemRecord(item.bytes, catalog);
const result = insertItemRecord(fs.readFileSync(inputPath), item.bytes, catalog);
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, result.bytes);

process.stdout.write(`${JSON.stringify({
  output: path.resolve(outputPath),
  sourceBytes: result.before.byteLength,
  outputBytes: result.after.byteLength,
  itemCountBefore: result.before.items.count,
  itemCountAfter: result.after.items.count,
  insertedBytes: result.insertedBytes,
  item: { ...item.item, decodedStats: decoded.stats },
}, null, 2)}\n`);
