const CHECKSUM_OFFSET = 12;

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected an ArrayBuffer or Uint8Array.');
}

export function readUint32LE(input, offset) {
  const bytes = asBytes(input);
  if (offset < 0 || offset + 4 > bytes.length) throw new RangeError(`Cannot read uint32 at offset ${offset}.`);
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function writeUint32LE(input, offset, value) {
  const bytes = asBytes(input);
  if (offset < 0 || offset + 4 > bytes.length) throw new RangeError(`Cannot write uint32 at offset ${offset}.`);
  const normalized = value >>> 0;
  bytes[offset] = normalized & 0xff;
  bytes[offset + 1] = (normalized >>> 8) & 0xff;
  bytes[offset + 2] = (normalized >>> 16) & 0xff;
  bytes[offset + 3] = (normalized >>> 24) & 0xff;
  return bytes;
}

export function calculateChecksum(input) {
  const bytes = asBytes(input);
  let checksum = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const value = index >= CHECKSUM_OFFSET && index < CHECKSUM_OFFSET + 4 ? 0 : bytes[index];
    checksum = ((((checksum << 1) >>> 0) | (checksum >>> 31)) + value) >>> 0;
  }
  return checksum;
}

export function verifyChecksum(input) {
  const bytes = asBytes(input);
  return bytes.length >= 16 && readUint32LE(bytes, CHECKSUM_OFFSET) === calculateChecksum(bytes);
}

export function updateHeader(input) {
  const bytes = new Uint8Array(asBytes(input));
  if (bytes.length < 16) throw new RangeError('D2S data is too short for a header.');
  writeUint32LE(bytes, 8, bytes.length);
  writeUint32LE(bytes, CHECKSUM_OFFSET, 0);
  writeUint32LE(bytes, CHECKSUM_OFFSET, calculateChecksum(bytes));
  return bytes;
}
