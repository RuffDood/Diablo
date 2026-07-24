import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCurrentMission } from './validate.mjs';

function fixture({ current, roadmap, mission = '# Extended Item Stats\n' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diablo-current-mission-'));
  fs.mkdirSync(path.join(root, 'Mission'));
  if (current !== null) fs.writeFileSync(path.join(root, 'Mission', 'CURRENT.md'), current);
  fs.writeFileSync(path.join(root, 'Mission', 'extended-item-stats-3.2.md'), mission);
  fs.writeFileSync(path.join(root, 'ROADMAP.html'), roadmap);
  return root;
}

const validCurrent = `# Mission courante

## Priorité active

[Extended Item Stats](extended-item-stats-3.2.md)

## Prochain gate

Mesurer l'overflow natif.
`;
const validRoadmap = '<p><b>Priorité courante — Extended Item Stats.</b> Gate actif.</p>';

test('accepts an existing mission aligned with the roadmap', (t) => {
  const root = fixture({ current: validCurrent, roadmap: validRoadmap });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(validateCurrentMission(root).errors, []);
});

test('rejects a missing next gate', (t) => {
  const root = fixture({
    current: validCurrent.replace("Mesurer l'overflow natif.", ''),
    roadmap: validRoadmap,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.match(validateCurrentMission(root).errors.join('\n'), /Prochain gate/);
});

test('rejects a missing linked mission', (t) => {
  const root = fixture({
    current: validCurrent.replace('extended-item-stats-3.2.md', 'missing.md'),
    roadmap: validRoadmap,
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.match(validateCurrentMission(root).errors.join('\n'), /does not exist/);
});

test('rejects a roadmap priority mismatch', (t) => {
  const root = fixture({ current: validCurrent, roadmap: '<p>Priorité courante — Qty Display.</p>' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.match(validateCurrentMission(root).errors.join('\n'), /does not name/);
});
