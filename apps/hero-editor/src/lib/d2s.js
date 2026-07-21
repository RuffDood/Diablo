import { BitReader } from './bit-reader.js';
import { readUint32LE, verifyChecksum } from './checksum.js';

const FILE_MAGIC = 0xaa55aa55;
const HEADER_SIZE = 16;
const FIXED_END_V104 = 833;
const CHARACTER_CLASS_OFFSET = 24;
const CHARACTER_SKILL_COUNT_OFFSET = 26;
const CHARACTER_LEVEL_OFFSET = 27;
const PREVIEW_OFFSET_V104 = 175;
const PREVIEW_GAME_VERSION_OFFSET = PREVIEW_OFFSET_V104 + 73;
const PREVIEW_NAME_OFFSET_V104 = PREVIEW_OFFSET_V104 + 124;
const PREVIEW_NAME_SIZE_V104 = 96;

const FIXED_MAGICS_V104 = [
  { name: 'quests', offset: 0x193, bytes: [0x57, 0x6f, 0x6f, 0x21], label: 'Woo!' },
  { name: 'waypoints', offset: 0x2bd, bytes: [0x57, 0x53], label: 'WS' },
  { name: 'playerIntro', offset: 0x30d, bytes: [0x01, 0x77], label: '01 77' },
];

const GAME_VERSIONS = ['Unknown', 'Classic', 'Expansion', 'Reign of the Warlock'];

export class D2sValidationError extends Error {
  constructor(code, message, offset = null) {
    super(message);
    this.name = 'D2sValidationError';
    this.code = code;
    this.offset = offset;
  }
}

function ensureBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Expected an ArrayBuffer or Uint8Array.');
}

function readUint16LE(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) throw new D2sValidationError('truncated', `Lecture impossible à l’octet ${offset}.`, offset);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function assertBytes(bytes, offset, expected, section) {
  if (offset + expected.length > bytes.length) {
    throw new D2sValidationError('truncated-section', `La section ${section} est tronquée.`, offset);
  }
  const valid = expected.every((value, index) => bytes[offset + index] === value);
  if (!valid) {
    throw new D2sValidationError('bad-section-magic', `Marqueur invalide pour la section ${section}.`, offset);
  }
}

function readFixedUtf8(bytes, offset, length) {
  const end = Math.min(bytes.length, offset + length);
  let zero = offset;
  while (zero < end && bytes[zero] !== 0) zero += 1;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(offset, zero));
}

function statEncodingMap(catalog) {
  return new Map((catalog?.itemStats || []).map((stat) => [stat.id, stat]));
}

function parsePlayerStats(bytes, offset, catalog) {
  assertBytes(bytes, offset, [0x67, 0x66], 'player stats (gf)');
  const reader = new BitReader(bytes, (offset + 2) * 8);
  const encodings = statEncodingMap(catalog);
  const ids = [];

  for (let guard = 0; guard < 512; guard += 1) {
    const id = reader.readBits(9);
    if (id === 0x1ff) {
      reader.alignToByte();
      return { offset, endOffset: reader.byteOffset, ids };
    }

    const encoding = encodings.get(id);
    if (!encoding || encoding.csvBits === null) {
      throw new D2sValidationError(
        'unknown-player-stat',
        `La stat joueur ${id} n’a pas d’encodage CSvBits dans itemstatcost.txt.`,
        reader.byteOffset,
      );
    }
    reader.skipBits((encoding.csvParamBits || 0) + encoding.csvBits);
    ids.push(id);
  }

  throw new D2sValidationError('player-stats-overflow', 'La section des statistiques ne contient aucun terminateur.', offset);
}

function findZeroCorpseTail(bytes, startOffset) {
  for (let offset = bytes.length - 6; offset >= startOffset; offset -= 1) {
    const isEmptyCorpse = bytes[offset] === 0x4a
      && bytes[offset + 1] === 0x4d
      && bytes[offset + 2] === 0
      && bytes[offset + 3] === 0;
    const followedByMerc = bytes[offset + 4] === 0x6a && bytes[offset + 5] === 0x66;
    if (isEmptyCorpse && followedByMerc) return offset;
  }
  return null;
}

function classLabel(classId, catalog) {
  return catalog?.classes?.find((entry) => entry.id === classId)?.name || `Classe ${classId}`;
}

export function parseD2s(input, catalog) {
  const bytes = ensureBytes(input);
  if (bytes.length < FIXED_END_V104) {
    throw new D2sValidationError('truncated', `Sauvegarde trop courte (${bytes.length} octets).`);
  }

  const magic = readUint32LE(bytes, 0);
  if (magic !== FILE_MAGIC) throw new D2sValidationError('bad-magic', 'Signature D2S invalide.', 0);

  const version = readUint32LE(bytes, 4);
  if (version < 104 || version > 105) {
    throw new D2sValidationError('unsupported-version', `Version D2S ${version} non prise en charge par le profil BKVince 3.2.`, 4);
  }

  const declaredSize = readUint32LE(bytes, 8);
  if (declaredSize !== bytes.length) {
    throw new D2sValidationError('bad-size', `Taille déclarée ${declaredSize}, taille réelle ${bytes.length}.`, 8);
  }
  if (!verifyChecksum(bytes)) throw new D2sValidationError('bad-checksum', 'Checksum D2S invalide.', 12);

  for (const section of FIXED_MAGICS_V104) assertBytes(bytes, section.offset, section.bytes, section.name);

  const classId = bytes[CHARACTER_CLASS_OFFSET];
  const skillCount = bytes[CHARACTER_SKILL_COUNT_OFFSET];
  const playerStats = parsePlayerStats(bytes, FIXED_END_V104, catalog);
  assertBytes(bytes, playerStats.endOffset, [0x69, 0x66], 'skills (if)');

  const skillsOffset = playerStats.endOffset + 2;
  const itemsOffset = skillsOffset + skillCount;
  assertBytes(bytes, itemsOffset, [0x4a, 0x4d], 'items (JM)');
  const itemCount = readUint16LE(bytes, itemsOffset + 2);
  const corpseOffset = findZeroCorpseTail(bytes, itemsOffset + 4);

  const gameVersionId = bytes[PREVIEW_GAME_VERSION_OFFSET];
  const warnings = [];
  if (version !== catalog?.profile?.saveVersion) {
    warnings.push(`Le profil attend la version ${catalog?.profile?.saveVersion}, mais le fichier utilise ${version}.`);
  }
  if (corpseOffset === null) {
    warnings.push('La frontière items/cadavres ne peut pas encore être prouvée sans décoder tous les items ou parce que le personnage possède un cadavre.');
  } else {
    warnings.push('La structure extérieure des items est cohérente; leur bitstream étendu sera validé par le prochain jalon du parseur.');
  }

  return {
    ok: true,
    byteLength: bytes.length,
    version,
    declaredSize,
    checksum: readUint32LE(bytes, 12),
    checksumValid: true,
    character: {
      name: readFixedUtf8(bytes, PREVIEW_NAME_OFFSET_V104, PREVIEW_NAME_SIZE_V104),
      classId,
      className: classLabel(classId, catalog),
      level: bytes[CHARACTER_LEVEL_OFFSET],
      skillCount,
      gameVersionId,
      gameVersion: GAME_VERSIONS[gameVersionId] || `Version de jeu ${gameVersionId}`,
    },
    playerStats,
    skills: {
      offset: skillsOffset,
      levels: Array.from(bytes.subarray(skillsOffset, skillsOffset + skillCount)),
    },
    items: {
      offset: itemsOffset,
      count: itemCount,
      corpseOffset,
      encodedBytes: corpseOffset === null ? null : corpseOffset - (itemsOffset + 4),
    },
    sections: [
      ...FIXED_MAGICS_V104.map((section) => ({ name: section.name, offset: section.offset, marker: section.label })),
      { name: 'playerStats', offset: FIXED_END_V104, marker: 'gf' },
      { name: 'skills', offset: playerStats.endOffset, marker: 'if' },
      { name: 'items', offset: itemsOffset, marker: 'JM' },
      ...(corpseOffset === null ? [] : [{ name: 'corpses', offset: corpseOffset, marker: 'JM 00 00' }]),
    ],
    warnings,
  };
}

export function inspectD2s(input, catalog) {
  try {
    return parseD2s(input, catalog);
  } catch (error) {
    if (error instanceof D2sValidationError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message, offset: error.offset },
      };
    }
    throw error;
  }
}
