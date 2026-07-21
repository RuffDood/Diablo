import { BitWriter } from './bit-writer.js';
import { writeItemCode } from './huffman.js';
import { resolveUniqueProperties } from './catalog.js';

const ITEM_FLAGS = {
  identified: 0x00000010,
  justSaved: 0x00800000,
};

const ITEM_QUALITY_UNIQUE = 7;
const ITEM_MODE_STORED = 0;
const STORE_PAGE_INVENTORY_FILE_VALUE = 1;
const ITEM_FORMAT_VERSION = 101;
const SUPPORTED_PROPERTY_FUNCTIONS = new Set([1, 3]);

export class ItemSerializationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ItemSerializationError';
    this.code = code;
  }
}

function assertIntegerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ItemSerializationError('out-of-range', `${label} doit être compris entre ${minimum} et ${maximum}.`);
  }
}

function randomSeed() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] || 0x6d2b79f5;
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function rollValue(minimum, maximum, strategy, nextRandom) {
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum > maximum) {
    throw new ItemSerializationError('invalid-roll-range', `Plage de roll invalide: ${minimum}–${maximum}.`);
  }
  if (strategy === 'min') return minimum;
  if (strategy === 'max') return maximum;
  if (strategy !== 'random') throw new ItemSerializationError('invalid-roll-strategy', `Stratégie de roll inconnue: ${strategy}.`);
  return minimum + (nextRandom() % ((maximum - minimum) + 1));
}

function itemTypeForBase(catalog, base) {
  return catalog.itemTypes.find((entry) => entry.code === base.type) || null;
}

export function analyzeUniqueSerialization(catalog, unique) {
  const reasons = [];
  const base = catalog.baseItems.find((entry) => entry.code === unique?.baseCode) || null;
  if (!unique) reasons.push('Aucun unique sélectionné.');
  if (!base) reasons.push(`Base ${unique?.baseCode || 'inconnue'} absente du catalogue.`);
  if (unique?.id === null || unique?.id < 0 || unique?.id > 4095) reasons.push('Index unique hors de la plage 12 bits.');
  if (base?.compactSave) reasons.push('Les items compact-save ne sont pas encore sérialisés par ce jalon.');
  if (base?.kind !== 'misc') reasons.push('Ce jalon écrit uniquement les uniques de type misc (charms, bijoux et consommables non stackables).');
  if (base?.stackable) reasons.push('Les quantités stackables ne sont pas encore sérialisées.');
  if (base?.quest || base?.questDifficultyCheck) reasons.push('Les champs de difficulté des objets de quête ne sont pas encore sérialisés.');

  const properties = unique ? resolveUniqueProperties(catalog, unique) : [];
  for (const property of properties) {
    if (!property.definition) {
      reasons.push(`Propriété ${property.code} introuvable dans properties.txt.`);
      continue;
    }
    if (!Number.isInteger(property.min) || !Number.isInteger(property.max)) {
      reasons.push(`Propriété ${property.code}: plage min/max incomplète.`);
    }
    for (const part of property.encodings) {
      if (!SUPPORTED_PROPERTY_FUNCTIONS.has(part.func)) {
        reasons.push(`Propriété ${property.code}: func ${part.func ?? 'vide'} non prouvée.`);
      }
      if (!part.encoding || !Number.isInteger(part.encoding.saveBits) || part.encoding.saveBits <= 0) {
        reasons.push(`Propriété ${property.code}: encodage de ${part.stat || 'stat inconnue'} absent.`);
      }
      if ((part.encoding?.saveParamBits || 0) > 0 && property.parameter === '') {
        reasons.push(`Propriété ${property.code}: paramètre requis pour ${part.stat}.`);
      }
    }
  }

  return { supported: reasons.length === 0, reasons, base, itemType: base ? itemTypeForBase(catalog, base) : null, properties };
}

function buildUniqueStats(catalog, unique, strategy, nextRandom) {
  const analysis = analyzeUniqueSerialization(catalog, unique);
  if (!analysis.supported) {
    throw new ItemSerializationError('unsupported-unique', analysis.reasons.join(' '));
  }

  const stats = [];
  const rolls = [];
  for (const property of analysis.properties) {
    const value = rollValue(property.min, property.max, strategy, nextRandom);
    rolls.push({ slot: property.slot, code: property.code, value });
    for (const part of property.encodings) {
      stats.push({
        id: part.encoding.id,
        name: part.encoding.name,
        value,
        layer: property.parameter === '' ? 0 : Number.parseInt(property.parameter, 10),
        encoding: part.encoding,
      });
    }
  }
  return { ...analysis, stats, rolls };
}

function writeItemFormat(writer, version) {
  if (version < 100 || version > 102) throw new ItemSerializationError('item-format', `Format item ${version} non pris en charge.`);
  writer.writeBool(true);
  writer.writeBits(version - 99, 2);
}

function writeStoredPosition(writer, x, y) {
  writer.writeBits(ITEM_MODE_STORED, 3);
  writer.writeBits(0, 4); // Body location: none.
  writer.writeBits(x, 4);
  writer.writeBits(y, 4);
  writer.writeBits(STORE_PAGE_INVENTORY_FILE_VALUE, 3);
}

function writeStat(writer, stat) {
  const { encoding } = stat;
  const shift = encoding.valShift || 0;
  const shifted = Math.trunc(stat.value / (2 ** shift));
  if (shifted === 0) return;
  const raw = shifted + (encoding.saveAdd || 0);
  const maximum = (2 ** encoding.saveBits) - 1;
  if (!Number.isInteger(raw) || raw < 0 || raw > maximum) {
    throw new ItemSerializationError(
      'stat-overflow',
      `${stat.name}: ${stat.value} devient ${raw}, hors de l’encodage ${encoding.saveBits} bits / add ${encoding.saveAdd || 0}.`,
    );
  }
  writer.writeBits(stat.id, 9);
  if ((encoding.saveParamBits || 0) > 0) {
    assertIntegerInRange(stat.layer, 0, (2 ** encoding.saveParamBits) - 1, `Paramètre de ${stat.name}`);
    writer.writeBits(stat.layer, encoding.saveParamBits);
  }
  writer.writeBits(raw, encoding.saveBits);
}

export function createUniqueItemRecord(catalog, unique, options = {}) {
  const {
    x = 10,
    y = 7,
    roll = 'random',
    seed = randomSeed(),
    itemLevel = unique?.level || 1,
    variableGfxId = 0,
  } = options;
  assertIntegerInRange(x, 0, 15, 'Position X');
  assertIntegerInRange(y, 0, 15, 'Position Y');
  assertIntegerInRange(itemLevel, 1, 127, 'Item level');
  assertIntegerInRange(variableGfxId, 0, 7, 'Variable gfx ID');
  assertIntegerInRange(seed, 0, 0xffffffff, 'Item seed');

  const nextRandom = createRng(seed);
  const model = buildUniqueStats(catalog, unique, roll, nextRandom);
  const writer = new BitWriter(64);

  writer.writeUint32((ITEM_FLAGS.identified | ITEM_FLAGS.justSaved) >>> 0);
  writeItemFormat(writer, ITEM_FORMAT_VERSION);
  writeStoredPosition(writer, x, y);
  writeItemCode(writer, model.base.code);
  writer.writeBits(0, 3); // Socketed child-item count.
  writer.writeUint32(seed);
  writer.writeBits(itemLevel, 7);
  writer.writeBits(ITEM_QUALITY_UNIQUE, 4);

  const hasVariableGfx = (model.itemType?.variableInventoryGraphics || 0) > 0;
  writer.writeBool(hasVariableGfx);
  if (hasVariableGfx) writer.writeBits(variableGfxId, 3);

  writer.writeBool(false); // Auto-affix absent.
  writer.writeBits(unique.id, 12);
  writer.writeBool(false); // Realm data absent.
  writer.writeBool(false); // v105 quantity absent.

  for (const stat of model.stats) writeStat(writer, stat);
  writer.writeBits(0x1ff, 9); // Item stat-list terminator.
  writer.writeBool(false); // v102+ advanced-stash stack size absent.
  writer.alignToByte();

  return {
    bytes: writer.toUint8Array(),
    item: {
      code: model.base.code,
      uniqueId: unique.id,
      uniqueName: unique.name,
      seed: seed >>> 0,
      itemLevel,
      formatVersion: ITEM_FORMAT_VERSION,
      position: { page: 'inventory', x, y },
      rolls: model.rolls,
      stats: model.stats.map(({ encoding, ...stat }) => ({
        ...stat,
        saveBits: encoding.saveBits,
        saveAdd: encoding.saveAdd || 0,
        saveParamBits: encoding.saveParamBits || 0,
      })),
    },
  };
}
