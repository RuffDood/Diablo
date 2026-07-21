import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateChecksum, readUint32LE, updateHeader, verifyChecksum } from './checksum.js';

test('updateHeader writes the byte length and a valid checksum without mutating the input', () => {
  const input = new Uint8Array(32);
  input.set([0x55, 0xaa, 0x55, 0xaa]);

  const output = updateHeader(input);

  assert.notEqual(output, input);
  assert.equal(readUint32LE(output, 8), 32);
  assert.equal(readUint32LE(output, 12), calculateChecksum(output));
  assert.equal(verifyChecksum(output), true);
  assert.equal(readUint32LE(input, 8), 0);
});

test('verifyChecksum rejects a modified byte', () => {
  const output = updateHeader(new Uint8Array(24));
  output[20] = 1;
  assert.equal(verifyChecksum(output), false);
});
