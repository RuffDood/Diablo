import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyPaths, globMatches, validateRegistry } from './workstreams.mjs';

const registry = {
  schemaVersion: 1,
  workstreams: [
    { id: 'alpha', name: 'Alpha', status: 'active', owner: 'Human', mission: 'Mission/a.md', nextGate: 'A', include: ['src/alpha/**', 'same.txt'] },
    { id: 'beta', name: 'Beta', status: 'active', owner: 'Human', mission: 'Mission/b.md', nextGate: 'B', include: ['src/beta/*', 'same.txt'] },
  ],
  sharedPaths: [{ pattern: 'ROADMAP.html', workstreams: ['*'], reason: 'Shared.' }],
};

test('matches exact, star and globstar patterns', () => {
  assert.equal(globMatches('a/*.txt', 'a/x.txt'), true);
  assert.equal(globMatches('a/*.txt', 'a/b/x.txt'), false);
  assert.equal(globMatches('a/**', 'a/b/x.txt'), true);
});

test('classifies owned, shared, unassigned and overlapping paths', () => {
  const result = classifyPaths(registry, ['src/alpha/x.cpp', 'src/beta/y.cpp', 'ROADMAP.html', 'other.txt', 'same.txt']);
  assert.deepEqual(result.streams.alpha, ['src/alpha/x.cpp']);
  assert.deepEqual(result.streams.beta, ['src/beta/y.cpp']);
  assert.equal(result.shared.length, 1);
  assert.deepEqual(result.unassigned, ['other.txt']);
  assert.deepEqual(result.overlaps, [{ path: 'same.txt', owners: ['alpha', 'beta'] }]);
});

test('validates missions and shared workstream ids', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diablo-workstreams-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Mission'));
  fs.writeFileSync(path.join(root, 'Mission', 'a.md'), '# A');
  fs.writeFileSync(path.join(root, 'Mission', 'b.md'), '# B');
  assert.deepEqual(validateRegistry(registry, root), []);
  const invalid = structuredClone(registry);
  invalid.sharedPaths[0].workstreams = ['missing'];
  assert.match(validateRegistry(invalid, root).join('\n'), /Unknown shared workstream/);
});
