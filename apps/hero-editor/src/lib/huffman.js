// D2R item-code Huffman table. The table is independently represented here
// from the game-format evidence pinned as D2SSharp in references.json.
const TABLE = [
  ['0', 0b11111011, 8], [' ', 0b10, 2], ['1', 0b1111100, 7],
  ['2', 0b001100, 6], ['3', 0b1101101, 7], ['4', 0b11111010, 8],
  ['5', 0b00010110, 8], ['6', 0b1101111, 7], ['7', 0b01111, 5],
  ['8', 0b000100, 6], ['9', 0b01110, 5], ['a', 0b11110, 5],
  ['b', 0b0101, 4], ['c', 0b01000, 5], ['d', 0b110001, 6],
  ['e', 0b110000, 6], ['f', 0b010011, 6], ['g', 0b11010, 5],
  ['h', 0b00011, 5], ['i', 0b1111110, 7], ['j', 0b000101110, 9],
  ['k', 0b010010, 6], ['l', 0b11101, 5], ['m', 0b01101, 5],
  ['n', 0b001101, 6], ['o', 0b1111111, 7], ['p', 0b11001, 5],
  ['q', 0b11011001, 8], ['r', 0b11100, 5], ['s', 0b0010, 4],
  ['t', 0b01100, 5], ['u', 0b00001, 5], ['v', 0b1101110, 7],
  ['w', 0b00000, 5], ['x', 0b00111, 5], ['y', 0b0001010, 7],
  ['z', 0b11011000, 8],
];

function reverseBits(value, length) {
  let input = value;
  let result = 0;
  for (let index = 0; index < length; index += 1) {
    result = (result << 1) | (input & 1);
    input >>>= 1;
  }
  return result >>> 0;
}

const ENCODINGS = new Map(TABLE.map(([symbol, bits, length]) => [
  symbol,
  { bits: reverseBits(bits, length), length },
]));

const DECODINGS = new Map(TABLE.map(([symbol, bits, length]) => [`${length}:${bits}`, symbol]));
const MAX_CODE_LENGTH = Math.max(...TABLE.map(([, , length]) => length));

export function writeItemCode(writer, itemCode) {
  if (typeof itemCode !== 'string' || itemCode.length < 1 || itemCode.length > 4) {
    throw new TypeError(`Invalid item code ${itemCode}.`);
  }
  for (const character of itemCode.padEnd(4, ' ')) {
    const encoding = ENCODINGS.get(character);
    if (!encoding) throw new RangeError(`Item-code character ${character} is not encodable.`);
    writer.writeBits(encoding.bits, encoding.length);
  }
}

export function readItemCode(reader) {
  let result = '';
  for (let characterIndex = 0; characterIndex < 4; characterIndex += 1) {
    let code = 0;
    let decoded = null;
    for (let length = 1; length <= MAX_CODE_LENGTH; length += 1) {
      code = (code << 1) | reader.readBits(1);
      decoded = DECODINGS.get(`${length}:${code}`) || null;
      if (decoded !== null) break;
    }
    if (decoded === null) throw new RangeError(`Invalid D2R Huffman code at item-code character ${characterIndex}.`);
    result += decoded;
  }
  return result.trimEnd();
}
