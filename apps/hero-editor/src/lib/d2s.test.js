import assert from 'node:assert/strict';
import test from 'node:test';
import { updateHeader, writeUint32LE } from './checksum.js';
import { inspectD2s, parseD2s } from './d2s.js';

const catalog = {
  profile: { saveVersion: 105 },
  classes: [
    { id: 0, name: 'Amazon' },
    { id: 7, name: 'Warlock' },
  ],
  itemStats: [],
};

function fixture() {
  const fixedEnd = 833;
  const statsOffset = fixedEnd;
  const statsEnd = statsOffset + 4;
  const skillsHeader = statsEnd;
  const skillsOffset = skillsHeader + 2;
  const itemOffset = skillsOffset + 30;
  const corpseOffset = itemOffset + 4;
  const bytes = new Uint8Array(corpseOffset + 15);

  bytes.set([0x55, 0xaa, 0x55, 0xaa], 0);
  writeUint32LE(bytes, 4, 105);
  bytes[24] = 7;
  bytes[25] = 16;
  bytes[26] = 30;
  bytes[27] = 42;
  bytes.set(new TextEncoder().encode('DummyTester'), 299);
  bytes[248] = 3;

  bytes.set([0x57, 0x6f, 0x6f, 0x21], 0x193);
  bytes.set([0x57, 0x53], 0x2bd);
  bytes.set([0x01, 0x77], 0x30d);

  bytes.set([0x67, 0x66, 0xff, 0x01], statsOffset);
  bytes.set([0x69, 0x66], skillsHeader);
  bytes.set([0x4a, 0x4d, 0x00, 0x00], itemOffset);
  bytes.set([0x4a, 0x4d, 0x00, 0x00], corpseOffset);
  bytes.set([0x6a, 0x66, 0x6b, 0x66, 0x00, 0x6c, 0x66, 0x00, 0x00], corpseOffset + 4);
  return updateHeader(bytes);
}

test('parses a structurally valid v105 BKVince character', () => {
  const parsed = parseD2s(fixture(), catalog);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.version, 105);
  assert.equal(parsed.character.name, 'DummyTester');
  assert.equal(parsed.character.className, 'Warlock');
  assert.equal(parsed.character.level, 42);
  assert.equal(parsed.character.gameVersion, 'Reign of the Warlock');
  assert.equal(parsed.items.count, 0);
  assert.equal(parsed.items.corpseOffset, 873);
});

test('rejects a checksum mismatch with an actionable error', () => {
  const bytes = fixture();
  bytes[400] ^= 0xff;
  const inspected = inspectD2s(bytes, catalog);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.error.code, 'bad-checksum');
});

test('rejects a declared file size mismatch', () => {
  const bytes = fixture();
  writeUint32LE(bytes, 8, bytes.length - 1);
  const refreshed = updateHeader(bytes);
  writeUint32LE(refreshed, 8, bytes.length - 1);
  const inspected = inspectD2s(refreshed, catalog);
  assert.equal(inspected.ok, false);
  assert.equal(inspected.error.code, 'bad-size');
});
