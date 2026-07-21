import { BitReader } from './bit-reader.js';
import { readItemCode } from './huffman.js';

const ITEM_FLAG_COMPACT_SAVE = 0x00200000;
const ITEM_QUALITY_UNIQUE = 7;

function itemTypeForBase(catalog, base) {
  return catalog.itemTypes.find((entry) => entry.code === base.type) || null;
}

function readPosition(reader, mode) {
  if (mode === 3 || mode === 5) {
    return { mode, groundX: reader.readBits(16), groundY: reader.readBits(16) };
  }
  const bodyLocation = reader.readBits(4);
  const x = reader.readBits(4);
  const y = reader.readBits(4);
  const rawStorePage = reader.readBits(3);
  return { mode, bodyLocation, x, y, storePage: rawStorePage === 0 ? null : rawStorePage - 1 };
}

function readItemFormat(reader, saveVersion) {
  if (saveVersion <= 96) return reader.readBits(10);
  const high = reader.readBits(1) === 1;
  const value = reader.readBits(2);
  return high ? value + 99 : value;
}

export function readUniqueMiscItemRecord(input, catalog, saveVersion = 105) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new BitReader(bytes);
  const flags = reader.readBits(32);
  if ((flags & ITEM_FLAG_COMPACT_SAVE) !== 0) throw new RangeError('Expected a complete item, received compact-save data.');
  const formatVersion = readItemFormat(reader, saveVersion);
  const mode = reader.readBits(3);
  const position = readPosition(reader, mode);
  const code = readItemCode(reader);
  const base = catalog.baseItems.find((entry) => entry.code === code);
  if (!base) throw new RangeError(`Unknown BKVince base item code ${code}.`);
  if (base.kind !== 'misc') throw new RangeError(`Expected a misc item, received ${base.kind}.`);
  const itemType = itemTypeForBase(catalog, base);

  const socketedItemCount = reader.readBits(3);
  const seed = reader.readBits(32);
  const itemLevel = reader.readBits(7);
  const quality = reader.readBits(4);
  const hasVariableGfx = reader.readBits(1) === 1;
  const variableGfxId = hasVariableGfx ? reader.readBits(3) : null;
  const typeSupportsVariableGfx = (itemType?.variableInventoryGraphics || 0) > 0;
  if (hasVariableGfx !== typeSupportsVariableGfx) {
    throw new RangeError(`Variable-gfx bit disagrees with itemtypes.txt for ${code}.`);
  }
  const hasAutoAffix = reader.readBits(1) === 1;
  const autoAffixId = hasAutoAffix ? reader.readBits(11) : null;
  if (quality !== ITEM_QUALITY_UNIQUE) throw new RangeError(`Expected unique quality, received ${quality}.`);
  const uniqueId = reader.readBits(12);

  const hasRealmData = reader.readBits(1) === 1;
  if (hasRealmData) reader.skipBits(saveVersion > 96 ? 128 : (saveVersion > 93 ? 96 : 64));
  const hasQuantity = saveVersion > 104 ? reader.readBits(1) === 1 : base.stackable;
  const quantity = hasQuantity ? reader.readBits(saveVersion > 104 ? 9 : 8) : null;

  const statsById = new Map(catalog.itemStats.map((stat) => [stat.id, stat]));
  const stats = [];
  for (let guard = 0; guard < 512; guard += 1) {
    const id = reader.readBits(9);
    if (id === 0x1ff) break;
    const encoding = statsById.get(id);
    if (!encoding || !Number.isInteger(encoding.saveBits) || encoding.saveBits <= 0) {
      throw new RangeError(`Unknown item stat encoding ${id}.`);
    }
    const layer = (encoding.saveParamBits || 0) > 0 ? reader.readBits(encoding.saveParamBits) : 0;
    const raw = reader.readBits(encoding.saveBits);
    const value = (raw - (encoding.saveAdd || 0)) * (2 ** (encoding.valShift || 0));
    stats.push({ id, name: encoding.name, layer, raw, value });
  }

  const hasAdvancedStackSize = saveVersion > 101 ? reader.readBits(1) === 1 : false;
  const advancedStackSize = hasAdvancedStackSize ? reader.readBits(8) : null;
  reader.alignToByte();
  if (reader.byteOffset !== bytes.length) {
    throw new RangeError(`Item record has ${bytes.length - reader.byteOffset} unexpected trailing bytes.`);
  }

  return {
    byteLength: bytes.length,
    flags,
    formatVersion,
    position,
    code,
    socketedItemCount,
    seed,
    itemLevel,
    quality,
    variableGfxId,
    autoAffixId,
    uniqueId,
    quantity,
    stats,
    advancedStackSize,
  };
}
