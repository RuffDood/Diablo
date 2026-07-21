export class BitReader {
  constructor(bytes, bitOffset = 0) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.bitOffset = bitOffset;
  }

  get bitsRemaining() {
    return (this.bytes.length * 8) - this.bitOffset;
  }

  readBits(count) {
    if (!Number.isInteger(count) || count < 0 || count > 32) throw new RangeError(`Invalid bit count ${count}.`);
    if (this.bitsRemaining < count) throw new RangeError(`Unexpected end of D2S bitstream at bit ${this.bitOffset}.`);
    let value = 0;
    for (let bit = 0; bit < count; bit += 1) {
      const absoluteBit = this.bitOffset + bit;
      const source = (this.bytes[absoluteBit >>> 3] >>> (absoluteBit & 7)) & 1;
      value += source * (2 ** bit);
    }
    this.bitOffset += count;
    return value >>> 0;
  }

  skipBits(count) {
    if (!Number.isInteger(count) || count < 0) throw new RangeError(`Invalid bit count ${count}.`);
    if (this.bitsRemaining < count) throw new RangeError(`Unexpected end of D2S bitstream at bit ${this.bitOffset}.`);
    this.bitOffset += count;
  }

  alignToByte() {
    this.bitOffset = Math.ceil(this.bitOffset / 8) * 8;
  }

  get byteOffset() {
    if ((this.bitOffset & 7) !== 0) throw new Error('Bit reader is not aligned to a byte boundary.');
    return this.bitOffset >>> 3;
  }
}
