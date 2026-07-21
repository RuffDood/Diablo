import assert from 'node:assert/strict';
import test from 'node:test';
import { updateHeader, verifyChecksum, writeUint32LE } from './checksum.js';
import { insertItemRecord } from './save-editor.js';

const catalog = {
  profile: { saveVersion: 105 },
  classes: [{ id: 0, name: 'Amazon' }],
  itemStats: [],
};

function emptyCharacterFixture() {
  const fixedEnd = 833;
  const statsEnd = fixedEnd + 4;
  const skillsOffset = statsEnd + 2;
  const itemsOffset = skillsOffset + 30;
  const corpseOffset = itemsOffset + 4;
  const bytes = new Uint8Array(corpseOffset + 15);
  bytes.set([0x55, 0xaa, 0x55, 0xaa], 0);
  writeUint32LE(bytes, 4, 105);
  bytes[26] = 30;
  bytes.set([0x57, 0x6f, 0x6f, 0x21], 0x193);
  bytes.set([0x57, 0x53], 0x2bd);
  bytes.set([0x01, 0x77], 0x30d);
  bytes.set([0x67, 0x66, 0xff, 0x01], fixedEnd);
  bytes.set([0x69, 0x66], statsEnd);
  bytes.set([0x4a, 0x4d, 0x00, 0x00], itemsOffset);
  bytes.set([0x4a, 0x4d, 0x00, 0x00, 0x6a, 0x66, 0x6b, 0x66, 0x00, 0x6c, 0x66, 0x00, 0x00], corpseOffset);
  return updateHeader(bytes);
}

test('inserts an item before the corpse section and refreshes size, count, and checksum', () => {
  const source = emptyCharacterFixture();
  const original = new Uint8Array(source);
  const record = Uint8Array.from([0x10, 0x00, 0x80, 0x00, 0x05]);
  const result = insertItemRecord(source, record, catalog);

  assert.deepEqual(source, original, 'the source save must remain unchanged');
  assert.equal(result.before.items.count, 0);
  assert.equal(result.after.items.count, 1);
  assert.equal(result.after.byteLength, source.length + record.length);
  assert.equal(result.after.items.corpseOffset, result.before.items.corpseOffset + record.length);
  assert.equal(verifyChecksum(result.bytes), true);
});
