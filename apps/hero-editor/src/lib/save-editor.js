import { updateHeader } from './checksum.js';
import { parseD2s, D2sValidationError } from './d2s.js';

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected an ArrayBuffer or Uint8Array.');
}

function writeUint16LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

export function insertItemRecord(input, itemRecord, catalog) {
  const source = asBytes(input);
  const record = asBytes(itemRecord);
  if (record.length === 0) throw new RangeError('Item record cannot be empty.');

  const before = parseD2s(source, catalog);
  if (before.items.corpseOffset === null) {
    throw new D2sValidationError(
      'unproven-item-boundary',
      'Ajout refusé: la frontière entre les items et les cadavres n’est pas prouvée.',
      before.items.offset,
    );
  }
  if (before.items.count >= 0xffff) throw new RangeError('The item count is already at its uint16 limit.');

  const output = new Uint8Array(source.length + record.length);
  output.set(source.subarray(0, before.items.corpseOffset), 0);
  output.set(record, before.items.corpseOffset);
  output.set(source.subarray(before.items.corpseOffset), before.items.corpseOffset + record.length);
  writeUint16LE(output, before.items.offset + 2, before.items.count + 1);

  const finalized = updateHeader(output);
  const after = parseD2s(finalized, catalog);
  if (after.items.count !== before.items.count + 1) throw new Error('Post-write item-count validation failed.');
  if (after.items.corpseOffset !== before.items.corpseOffset + record.length) {
    throw new Error('Post-write corpse-boundary validation failed.');
  }

  return { bytes: finalized, before, after, insertedBytes: record.length };
}
