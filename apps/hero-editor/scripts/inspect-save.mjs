import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { inspectD2s } from '../src/lib/d2s.js';

const savePath = process.argv[2];
if (!savePath) {
  process.stderr.write('Usage: npm run inspect:save -w apps/hero-editor -- <character.d2s>\n');
  process.exit(2);
}

const catalogPath = path.resolve(import.meta.dirname, '..', 'src', 'data', 'bkvince-catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const bytes = fs.readFileSync(path.resolve(savePath));
const result = inspectD2s(bytes, catalog);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
