export class BitWriter {
  constructor(initialByteCapacity = 64) {
    if (!Number.isInteger(initialByteCapacity) || initialByteCapacity < 1) {
      throw new RangeError(`Invalid initial byte capacity ${initialByteCapacity}.`);
    }
    this.bytes = new Uint8Array(initialByteCapacity);
    this.bitOffset = 0;
  }

  ensureBits(count) {
    const requiredBytes = Math.ceil((this.bitOffset + count) / 8);
    if (requiredBytes <= this.bytes.length) return;
    let nextLength = this.bytes.length;
    while (nextLength < requiredBytes) nextLength *= 2;
    const next = new Uint8Array(nextLength);
    next.set(this.bytes);
    this.bytes = next;
  }

  writeBits(value, count) {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw new RangeError(`Invalid bit count ${count}.`);
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new RangeError(`Invalid unsigned value ${value}.`);
    }
    this.ensureBits(count);
    const normalized = value >>> 0;
    for (let bit = 0; bit < count; bit += 1) {
      const targetBit = this.bitOffset + bit;
      const source = bit === 31
        ? (normalized >>> 31) & 1
        : Math.floor(normalized / (2 ** bit)) & 1;
      this.bytes[targetBit >>> 3] |= source << (targetBit & 7);
    }
    this.bitOffset += count;
  }

  writeBool(value) {
    this.writeBits(value ? 1 : 0, 1);
  }

  writeUint32(value) {
    this.writeBits(value >>> 0, 32);
  }

  alignToByte() {
    this.bitOffset = Math.ceil(this.bitOffset / 8) * 8;
  }

  toUint8Array() {
    return this.bytes.slice(0, Math.ceil(this.bitOffset / 8));
  }
}
