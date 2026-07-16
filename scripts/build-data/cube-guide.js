'use strict';

// Generates the four in-game TCP cube guide tabs from cubemain.txt.
// Gameplay tables are read-only: this script only writes UI layout JSON files.

const fs = require('fs');
const path = require('path');
const { parseTable } = require('./tsv');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK_ONLY = process.argv.includes('--check');
const INPUT_FIELDS = Array.from({ length: 7 }, (_, index) => `input ${index + 1}`);
const OUTPUT_FIELDS = ['output', 'output b', 'output c'];
const MOD_FIELDS = Array.from({ length: 5 }, (_, index) => `mod ${index + 1}`);
const UBER_ANCIENT_CODES = new Set(['ua1', 'ua2', 'ua3', 'ua4', 'ua5']);
const WORLDSTONE_CODES = new Set(['xa1', 'xa2', 'xa3', 'xa4', 'xa5']);
const DISPLAY_ALIASES = {
  geg: 'Ascended Emerald',
  lcha: 'Grand Charm',
  mcha: 'Large Charm',
  scha: 'Small Charm',
  xa1: 'Western Worldstone Shard',
  xa2: 'Eastern Worldstone Shard',
  xa3: 'Southern Worldstone Shard',
  xa4: 'Deep Worldstone Shard',
  xa5: 'Northern Worldstone Shard',
};

const FILES = {
  cube: path.join(ROOT, 'data-TCP', 'global', 'excel', 'cubemain.txt'),
  misc: path.join(ROOT, 'data-TCP', 'global', 'excel', 'misc.txt'),
  armor: path.join(ROOT, 'data-TCP', 'global', 'excel', 'armor.txt'),
  weapons: path.join(ROOT, 'data-TCP', 'global', 'excel', 'weapons.txt'),
  itemTypes: path.join(ROOT, 'data-TCP', 'global', 'excel', 'itemtypes.txt'),
  layouts: path.join(ROOT, 'data-TCP', 'global', 'ui', 'layouts'),
  mouseCube: path.join(ROOT, 'data-TCP', 'global', 'ui', 'layouts', 'horadriccubelayouthd.json'),
  controllerCube: path.join(ROOT, 'data-TCP', 'global', 'ui', 'layouts', 'controller', 'horadriccubelayouthd.json'),
  profileHd: path.join(ROOT, 'data-TCP', 'global', 'ui', 'layouts', '_profilehd.json'),
  profileLv: path.join(ROOT, 'data-TCP', 'global', 'ui', 'layouts', '_profilelv.json'),
  recipeSprite: path.join(ROOT, 'data-TCP', 'hd', 'global', 'ui', 'panel', 'horadric_cube', 'Recipes.sprite'),
  recipeSpriteLow: path.join(ROOT, 'data-TCP', 'hd', 'global', 'ui', 'panel', 'horadric_cube', 'Recipes.lowend.sprite'),
};

const TABS = [
  { number: 2, key: 'essentials', panelName: 'CubeRecipes2Panel' },
  { number: 3, key: 'upgrades', panelName: 'CubeRecipes3Panel' },
  { number: 4, key: 'crafting', panelName: 'CubeRecipes4Panel' },
  { number: 5, key: 'corruptions', panelName: 'CubeRecipes5Panel' },
];

function fail(message) {
  throw new Error(message);
}

function tableObjects(filePath) {
  const table = parseTable(filePath);
  return table.rows.map((row, rowIndex) => Object.fromEntries(
    table.headers.map((header, index) => [header, row[index] ?? ''])
      .concat([['__row', rowIndex + 2]]),
  ));
}

function cleanToken(raw) {
  return String(raw || '').trim().replace(/^"|"$/g, '');
}

function tokenParts(raw) {
  const parts = cleanToken(raw).split(',').map((part) => part.trim()).filter(Boolean);
  return { base: parts[0] || '', qualifiers: parts.slice(1) };
}

function rowTokens(row, fields) {
  return fields.map((field) => tokenParts(row[field])).filter((token) => token.base);
}

function unique(values) {
  return [...new Set(values)];
}

function buildTypeSystem() {
  const itemTypes = tableObjects(FILES.itemTypes);
  const typeByCode = new Map(itemTypes.map((row) => [row.Code, row]));
  const itemByCode = new Map();

  for (const filePath of [FILES.misc, FILES.armor, FILES.weapons]) {
    for (const row of tableObjects(filePath)) {
      if (!row.code) continue;
      itemByCode.set(row.code, {
        code: row.code,
        name: row.name || row.namestr || row.code,
        types: [row.type, row.type2].filter(Boolean),
      });
    }
  }

  function typeInherits(typeCode, wanted, seen = new Set()) {
    if (!typeCode || seen.has(typeCode)) return false;
    if (typeCode === wanted) return true;
    seen.add(typeCode);
    const type = typeByCode.get(typeCode);
    return Boolean(type && (
      typeInherits(type.Equiv1, wanted, seen)
      || typeInherits(type.Equiv2, wanted, seen)
    ));
  }

  function tokenInherits(base, wanted) {
    if (typeInherits(base, wanted)) return true;
    const item = itemByCode.get(base);
    return Boolean(item && item.types.some((type) => typeInherits(type, wanted)));
  }

  const qualityLabels = {
    low: 'Low Quality',
    nor: 'Normal',
    hiq: 'Superior',
    mag: 'Magic',
    rar: 'Rare',
    set: 'Set',
    uni: 'Unique',
    crf: 'Crafted',
    bas: 'Normal',
    exc: 'Exceptional',
    eli: 'Elite',
  };
  const typeLabelOverrides = {
    '2han': 'Two-Handed Weapon',
    armo: 'Armor',
    bow: 'Bow',
    helm: 'Helm',
    shld: 'Shield',
    tors: 'Torso Armor',
    weap: 'Weapon',
    xbow: 'Crossbow',
  };

  function labelToken(raw, options = {}) {
    const { base, qualifiers } = tokenParts(raw);
    if (!base) return '';
    const item = itemByCode.get(base);
    const type = typeByCode.get(base);
    let label = DISPLAY_ALIASES[base] || item?.name || typeLabelOverrides[base] || type?.ItemType || base;
    const quantity = qualifiers.find((value) => value.startsWith('qty='));
    const quality = qualifiers.find((value) => qualityLabels[value]);
    const isEthereal = qualifiers.includes('eth') && !options.dropEth;
    const prefixes = [];
    if (isEthereal) prefixes.push('Ethereal');
    if (quality) prefixes.push(qualityLabels[quality]);
    if (prefixes.length && !prefixes.some((prefix) => label.startsWith(prefix))) {
      label = `${prefixes.join(' ')} ${label}`;
    }
    if (quantity) label = `${quantity.slice(4)} ${label}`;
    return label.replace(/\s+/g, ' ').trim();
  }

  return { itemByCode, typeByCode, tokenInherits, labelToken };
}

function compactDescription(value) {
  return String(value || '')
    .replace(/\bpk1\b/gi, 'Pandemonium Key')
    .replace(/\bpk2\b/gi, 'Key of Hate')
    .replace(/\bpk3\b/gi, 'Key of Destruction')
    .replace(/\bDemon Ear's\b/gi, "Demon's Ears")
    .replace(/\bUnique Jewerly\b/gi, 'Unique Jewelry')
    .replace(/\bPrime Sigil's\b/gi, 'Prime Sigils')
    .replace(/\bGheeds\b/g, "Gheed's Fortune")
    .replace(/\bSOH\b/g, 'Standard of Heroes')
    .replace(/\bRejuv\b/g, 'Rejuvenation Potion')
    .replace(/\bStandard Of Heroes\b/gi, 'Standard of Heroes')
    .replace(/\bStandard of Heros\b/gi, 'Standard of Heroes')
    .replace(/\bSaftey\b/gi, 'Safety')
    .replace(/\bChasi's Malus\b/gi, "Charsi's Malus")
    .replace(/\bPskulls\b/gi, 'Perfect Skulls')
    .replace(/\s*(?:-->|=>|=)\s*/g, ' -> ')
    .replace(/\s*->\s*/g, ' -> ')
    .replace(/\b1 (?=[A-Z])/g, '')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasModifier(row, predicate) {
  return MOD_FIELDS.some((field) => predicate(String(row[field] || '')));
}

function isCorruption(row) {
  return hasModifier(row, (value) => /^corruption/i.test(value))
    || /Corruptor|BLOCK CHARMS|BLOCK JEWELS/i.test(row.description);
}

function craftOutput(row) {
  const description = String(row.description || '').replace(/\s+/g, ' ').trim();
  const output = description.split(/\s*(?:->|-->|=)\s*/).at(-1);
  const match = output.match(/^(Ascended )?(Hit Power|Blood|Caster|Safety) (.+)$/i);
  if (!match) return null;
  if (!/Jewel|Crafting Tablet/i.test(description)) return null;
  return {
    ascended: Boolean(match[1]),
    family: match[2].replace(/^hit power$/i, 'Hit Power')
      .replace(/^blood$/i, 'Blood')
      .replace(/^caster$/i, 'Caster')
      .replace(/^safety$/i, 'Safety'),
    slot: match[3].trim(),
  };
}

function isSocketRecipe(row) {
  return /socket/i.test(row.description)
    || hasModifier(row, (value) => value === 'sock');
}

function isLarzukSocketRecipe(row) {
  return isSocketRecipe(row)
    && rowTokens(row, INPUT_FIELDS).some((token) => token.base === 'lmr')
    && hasModifier(row, (value) => value === 'sock');
}

function isUpgradeRecipe(row) {
  return isSocketRecipe(row)
    || /upgrade|exceptional|elite|augment|reroll|re-roll|imbue|quality|Forging Hammer|Charsi Hammer/i
      .test(row.description);
}

function exclusionReason(row, types, removerCodes, converterCodes) {
  const inputs = rowTokens(row, INPUT_FIELDS);
  const outputs = rowTokens(row, OUTPUT_FIELDS);
  const all = [...inputs, ...outputs];
  if (/^Block Bows$/i.test(row.description)) return 'technical-blocks';
  if (all.some(({ base }) => base === 'y01' || removerCodes.has(base))) return 'storage-bag-removers';
  if (all.some(({ base }) => WORLDSTONE_CODES.has(base))) return 'worldstone-enchantments';
  if (all.some(({ base }) => UBER_ANCIENT_CODES.has(base))) return 'uber-ancient-materials';
  if (all.some(({ base }) => types.tokenInherits(base, 'bowq') || types.tokenInherits(base, 'xboq'))) {
    return 'arrows-bolts-quivers';
  }
  const primaryOutput = tokenParts(row.output).base;
  if (
    converterCodes.has(primaryOutput)
    || all.some(({ base }) => converterCodes.has(base))
    || /^Rune Convert/i.test(row.description)
    || (
      types.tokenInherits(primaryOutput, 'rune')
      && inputs.some(({ base }) => types.tokenInherits(base, 'rune'))
    )
  ) return 'rune-conversions';
  if (
    types.tokenInherits(primaryOutput, 'gem')
    && inputs.some(({ base }) => types.tokenInherits(base, 'gem'))
  ) return 'gem-conversions';
  return null;
}

function section(text) {
  return { kind: 'section', text };
}

function line(text) {
  return { kind: 'line', text: compactDescription(text) };
}

function playerDescription(row) {
  let text = compactDescription(row.description);
  if (isSocketRecipe(row)) text = text.replace(/\bRare Item\b/g, 'Socketable Rare Item');
  return text;
}

function dedupeLines(rows) {
  const seen = new Set();
  const lines = [];
  for (const row of rows) {
    const text = playerDescription(row);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push(line(text));
  }
  return lines;
}

function chunkList(prefix, values, maximum = 112) {
  const result = [];
  let current = '';
  for (const value of unique(values)) {
    const candidate = current ? `${current}, ${value}` : value;
    if (current && prefix.length + candidate.length > maximum) {
      result.push(line(`${prefix}${current}`));
      current = value;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(line(`${prefix}${current}`));
  return result;
}

function recipeInputText(row, types) {
  return INPUT_FIELDS
    .filter((field) => tokenParts(row[field]).base)
    .map((field) => types.labelToken(row[field], { dropEth: true }))
    .filter(Boolean)
    .join(' + ');
}

function buildCraftingEntries(rows, types, anomalies) {
  const classic = [];
  const ascended = [];
  const unknownAliases = new Map();

  for (const row of rows) {
    for (const { base } of rowTokens(row, INPUT_FIELDS)) {
      if (
        /^[a-z0-9]{3}$/i.test(base)
        && !types.itemByCode.has(base)
        && !types.typeByCode.has(base)
        && DISPLAY_ALIASES[base]
      ) {
        if (!unknownAliases.has(base)) unknownAliases.set(base, []);
        unknownAliases.get(base).push(row.__row);
      }
    }
  }
  for (const [base, rowNumbers] of unknownAliases) {
    anomalies.push(
      `cubemain rows ${rowNumbers[0]}-${rowNumbers.at(-1)}: unknown item code "${base}" displayed as "${DISPLAY_ALIASES[base]}"`,
    );
  }

  for (const row of rows) {
    const output = craftOutput(row);
    if (!output) continue;
    const description = String(row.description || '');
    const isTablet = /Crafting Tablet/i.test(description);
    const isAugmented = rowTokens(row, INPUT_FIELDS).some((token) => token.base === 'mls');
    if (isTablet || isAugmented) continue;
    const text = `${output.ascended ? 'Ascended ' : ''}${output.family} ${output.slot}: ${recipeInputText(row, types)}`;
    (output.ascended ? ascended : classic).push(text);
  }

  const sortCrafts = (values) => unique(values).sort((left, right) => left.localeCompare(right));
  return [
    section('Crafting Rules'),
    line('Classic craft: use the listed Magic base, Jewel, Rune and Perfect Gem.'),
    line('Tablet shortcut: Magic base + matching Crafting Tablet -> same family craft.'),
    line("Augmented version: add Eth Rune + Charsi's Malus to a classic, tablet or Ascended craft."),
    section('Classic Crafts'),
    ...sortCrafts(classic).map(line),
    section('Ascended Crafts'),
    ...sortCrafts(ascended).map(line),
  ];
}

function levenshtein(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

function normalizedName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildCorruptionEntries(rows, types, anomalies) {
  const socketRows = rows.filter((row) => /^[1-6] Socket$/i.test(row.description));
  const socketByType = new Map();
  for (const row of socketRows) {
    const token = tokenParts(row['input 1']);
    const count = Number.parseInt(row.description, 10);
    const item = socketByType.get(token.base) || { max: 0, qualities: new Set() };
    item.max = Math.max(item.max, count);
    const quality = token.qualifiers.find((value) => ['mag', 'rar', 'set', 'uni', 'crf'].includes(value));
    if (quality) item.qualities.add(quality);
    socketByType.set(token.base, item);
  }

  const charmNames = ['Annihilus', 'Hellfire Torch', "Gheed's Fortune"];
  const charmOutcomes = new Map(charmNames.map((name) => [name, []]));
  for (const row of rows) {
    const input = tokenParts(row['input 1']).base;
    if (!charmOutcomes.has(input)) continue;
    if (/Corruptor|Brick/i.test(row.description)) continue;
    charmOutcomes.get(input).push(row.description);
  }

  const specialSockets = new Map();
  for (const row of rows) {
    if (row['input 2'] !== 'dsd' || row['mod 2'] !== 'sock' || /^[1-6] Socket$/i.test(row.description)) continue;
    const source = types.labelToken(row['input 1'], { dropEth: true });
    const intended = String(row.description || '').trim();
    const sourceName = normalizedName(source);
    const intendedName = normalizedName(intended);
    const mismatched = (
      sourceName
      && intendedName
      && !sourceName.includes(intendedName)
      && !intendedName.includes(sourceName)
      && levenshtein(sourceName, intendedName) > 3
    );
    if (mismatched) {
      anomalies.push(`cubemain row ${row.__row}: description "${intended}" targets "${source}"`);
    }
    const sockets = `${row['mod 2 min']}${row['mod 2 max'] && row['mod 2 max'] !== row['mod 2 min'] ? `-${row['mod 2 max']}` : ''}`;
    const displayName = mismatched ? source : intended;
    if (!specialSockets.has(displayName)) specialSockets.set(displayName, new Set());
    specialSockets.get(displayName).add(sockets);
  }

  const groupedSpecials = new Map();
  for (const [name, sockets] of specialSockets) {
    const key = [...sockets].sort().join('/');
    if (!groupedSpecials.has(key)) groupedSpecials.set(key, []);
    groupedSpecials.get(key).push(name);
  }

  const covered = new Set();
  for (const row of rows) {
    if (
      /^[1-6] Socket$|^Brick$|Corruptor|BLOCK CHARMS|BLOCK JEWELS/i.test(row.description)
      || charmNames.includes(tokenParts(row['input 1']).base)
      || (row['input 2'] === 'dsd' && row['mod 2'] === 'sock')
    ) covered.add(row);
  }
  const leftovers = rows.filter((row) => !covered.has(row));

  const entries = [
    section('Corruption Rules'),
    line('Standard of Heroes or Divine Standard + eligible item -> random corruption.'),
    line('Eligible qualities: Magic, Rare, Set, Crafted and Unique equipment.'),
    line('Charms and Jewels are blocked from Standard and Divine corruption.'),
    line('Brick outcome: equipment becomes Rare; Gheed\'s Fortune becomes Magic.'),
    line('Annihilus + Hellfire Ashes, Hellfire Torch + 2 Ashes, or Gheed + Ashes -> charm corruption.'),
    section('Generic Socket Outcomes'),
  ];

  const socketOrder = ['bow', 'xbow', '2han', 'weap', 'helm', 'tors', 'shld'];
  for (const code of socketOrder) {
    const group = socketByType.get(code);
    if (!group) continue;
    const label = types.labelToken(code);
    entries.push(line(`${label}: 1-${group.max} sockets (Magic, Rare, Set, Unique, Crafted).`));
  }

  entries.push(section('Charm Outcomes'));
  for (const name of charmNames) {
    entries.push(...chunkList(`${name}: `, charmOutcomes.get(name) || []));
  }

  entries.push(section('Divine Unique Socket Exceptions'));
  for (const key of [...groupedSpecials.keys()].sort((a, b) => Number(a) - Number(b))) {
    entries.push(...chunkList(`${key} sockets: `, groupedSpecials.get(key).sort()));
  }

  if (leftovers.length) {
    entries.push(section('Other Corruption Results'), ...dedupeLines(leftovers));
  }
  return entries;
}

function buildLarzukEntries(rows) {
  if (!rows.length) return [];
  return [
    section("Larzuk's Forging Hammer"),
    line('Normal, Low Quality or Superior Helm/Weapon/Armor/Shield -> maximum natural sockets.'),
    line('Magic Helm/Weapon/Armor/Shield/Throwing Weapon -> 1-2 sockets.'),
    line('Rare, Set, Unique or Crafted Helm/Weapon/Armor/Shield/Throwing Weapon -> 1 socket.'),
  ];
}

function enchantmentFamily(row) {
  const output = String(row.description || '').split(/\s*(?:->|-->|=)\s*/).at(-1);
  return output.match(/^(Virulent|Gelid|Magnetic|Incendiary|Breaching|Mystical)\b/i)?.[1] || null;
}

function buildEnchantmentEntries(rows, types) {
  if (!rows.length) return [];
  const families = new Map();
  for (const row of rows) {
    const family = enchantmentFamily(row);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(row);
  }

  const entries = [section('Worldstone Enchantments')];
  for (const [family, familyRows] of families) {
    const standard = familyRows.filter((row) => (
      rowTokens(row, INPUT_FIELDS).length === 4
      && tokenParts(row['input 1']).qualifiers.includes('mag')
    ));
    const rifts = familyRows.filter((row) => !standard.includes(row));
    if (!standard.length) {
      entries.push(...dedupeLines(familyRows));
      continue;
    }
    const ingredients = INPUT_FIELDS.slice(1)
      .filter((field) => tokenParts(standard[0][field]).base)
      .map((field) => types.labelToken(standard[0][field]))
      .join(' + ');
    const targets = standard.map((row) => types.labelToken(row['input 1']).replace(/^Magic /, ''));
    const equipment = targets.filter((target) => !/Charm/i.test(target));
    const charms = targets.filter((target) => /Charm/i.test(target));
    entries.push(...chunkList(`${family} equipment (${ingredients}): `, equipment, 145));
    if (charms.length) entries.push(line(`${family} charms (${ingredients}): ${charms.join(', ')}`));
    entries.push(...dedupeLines(rifts));
  }
  return entries;
}

function isMalusImbue(row) {
  return rowTokens(row, INPUT_FIELDS).some((token) => token.base === 'mls')
    && tokenParts(row.output).base === 'usetype'
    && tokenParts(row.output).qualifiers.includes('rar');
}

function buildMalusEntries(rows) {
  if (!rows.length) return [];
  return [
    section("Charsi's Malus Imbuing"),
    line("Charsi's Malus + Normal/Low Quality/Superior Helm, Weapon, Armor, Shield, Gloves, Belt or Boots -> Rare item."),
    line('Ethereal versions remain Ethereal; Circlets are also supported.'),
  ];
}

function buildAugmentEntries(rows) {
  if (!rows.length) return [];
  const repair = rows.filter((row) => /Repair Augment/i.test(row.description));
  const melee = rows.filter((row) => /Melee Augment/i.test(row.description));
  const entries = [];
  if (repair.length) {
    const targets = repair.map((row) => row.description.replace(/^.*Repair Augment on /i, ''));
    entries.push(
      section('Repair Augments'),
      line('Herb + Standard of Heroes + eligible item -> Repair Augment.'),
      ...chunkList('Eligible: ', targets),
    );
  }
  if (melee.length) {
    const targets = melee.map((row) => row.description.replace(/^.*Melee Augment /i, ''));
    entries.push(
      section('Melee Augments'),
      line("Item + Standard of Heroes + Charsi's Malus + Gul Rune -> Melee Augment."),
      ...chunkList('Eligible: ', targets),
    );
  }
  return entries;
}

function isMfGfRecipe(row) {
  return /(?:->|=) (?:Teleport \+ )?MF \+ GF /i.test(row.description);
}

function buildMfGfEntries(rows, types) {
  if (!rows.length) return [];
  const standard = rows.filter((row) => !/Teleport/i.test(row.description));
  const targets = standard.map((row) => row.description.replace(/^.*MF \+ GF /i, ''));
  const teleport = rows.filter((row) => /Teleport/i.test(row.description));
  return [
    section('MF + GF Augments'),
    line("Item + Jah + Lo + Vex + Standard of Heroes + Charsi's Malus -> MF + GF item."),
    ...chunkList('Eligible: ', targets),
    ...teleport.map((row) => line(`${recipeInputText(row, types)} -> Teleport + MF + GF Armor`)),
  ];
}

function isDyeRecipe(row) {
  return /^(White|Black)$/i.test(row.description)
    && ['dw1', 'db1'].includes(tokenParts(row['input 2']).base);
}

function isGfxRecipe(row) {
  return /^GFX Change$/i.test(row.description);
}

function buildDisplayEntries(dyeRows, gfxRows) {
  if (!dyeRows.length && !gfxRows.length) return [];
  const entries = [section('Appearance')];
  for (const [description, dye] of [['White', 'White Dye'], ['Black', 'Black Dye']]) {
    const targets = dyeRows
      .filter((row) => row.description === description)
      .map((row) => tokenParts(row['input 1']).base)
      .map((code) => ({ tors: 'Torso Armor', helm: 'Helm', shld: 'Shield', weap: 'Weapon' }[code] || code));
    if (targets.length) entries.push(line(`${dye} + ${targets.join('/')} -> ${description} item.`));
  }
  if (gfxRows.length) entries.push(line('Misc item + Scroll of Identify -> change its inventory graphic.'));
  return entries;
}

function isPairedCubeSocketRecipe(row) {
  return /-> Socketed (?:Torso Armor|Weapon|Helm|Shield)$/i.test(row.description)
    && !isLarzukSocketRecipe(row);
}

function buildPairedCubeSocketEntries(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = compactDescription(row.description).replace(/^SUP /i, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.keys()].map((text) => line(`Normal/Superior: ${text.replace(/^SUP /i, '')}`));
}

function hasPotionOutput(row, potionCodes) {
  return rowTokens(row, OUTPUT_FIELDS).some(({ base }) => potionCodes.has(base));
}

function subsectionForEssentials(row, potionCodes) {
  const text = row.description;
  if (/portal|cow level|horadric staff|khalim|token of absolution|uber key|pandemonium|essence/i.test(text)) {
    return 'Quests & Portals';
  }
  if (hasPotionOutput(row, potionCodes)) return 'Potions';
  if (/repair|recharge|return base|clear sockets/i.test(text)) return 'Repair & Recovery';
  return 'Utilities & Special Recipes';
}

function subsectionForUpgrades(row) {
  const text = row.description;
  if (isSocketRecipe(row)) return 'Socketing & Socket Removal';
  if (/reroll|re-roll/i.test(text)) return 'Rerolls';
  if (/augment|imbue/i.test(text)) return 'Imbuing & Augments';
  if (/upgrade|exceptional|elite|quality|Forging Hammer|Charsi Hammer/i.test(text)) return 'Item Tiers & Quality';
  return 'Other Upgrades';
}

function groupedEntries(rows, subsection, order) {
  const groups = new Map(order.map((name) => [name, []]));
  for (const row of rows) {
    const name = subsection(row);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  const entries = [];
  for (const [name, groupRows] of groups) {
    if (!groupRows.length) continue;
    entries.push(section(name), ...dedupeLines(groupRows));
  }
  return entries;
}

function textWidgetStyle(entry) {
  return entry.kind === 'section' ? '$CubeGuideSectionText' : '$CubeGuideText';
}

function makePanel(panelName, panelNumber, entries) {
  const rows = entries.map((entry, index) => {
    const name = `CubeGuide${panelNumber}Row${String(index + 1).padStart(3, '0')}`;
    const textChild = {
      type: 'TextBoxWidget',
      name: `${name}Text`,
      fields: { text: entry.text, style: textWidgetStyle(entry) },
    };
    if (entry.kind === 'section') {
      textChild.children = [{
        type: 'ImageWidget',
        name: `${name}Divider`,
        fields: { rect: '$CubeGuideDividerRect', filename: 'PauseMenu\\Divider' },
      }];
    }
    return { type: 'TableRowWidget', name, children: [textChild] };
  });

  return {
    type: 'VideoOptionsPanel',
    name: panelName,
    fields: {
      priority: 9003,
      rect: '$OptionsPanelRect',
      anchor: { x: 0.5 },
      applySettingsImmediately: true,
    },
    children: [
      {
        type: 'ImageWidget',
        name: `CubeGuide${panelNumber}ScrollBarBackground`,
        fields: {
          rect: '$OptionsScrollBarBackgroundRect',
          anchor: { x: 1.0 },
          filename: 'PauseMenu\\VerticalScroll',
        },
        children: [{
          type: 'ScrollControllerWidget',
          name: `CubeGuide${panelNumber}ScrollController`,
          fields: {
            rect: '$OptionsScrollBarRect',
            anchor: { x: 1.0 },
            upArrowFilepath: 'FrontEnd\\HD\\Final\\FrontEnd_ScrollUpBtn',
            downArrowFilepath: 'FrontEnd\\HD\\Final\\FrontEnd_ScrollDownBtn',
            barFilepath: 'PauseMenu\\VerticalIndicator',
            viewName: `CubeGuide${panelNumber}ScrollView`,
            wheelScrollSound: 'cursor_scroll_hd',
            buttonScrollSound: 'cursor_scroll_hd',
          },
        }],
      },
      {
        type: 'ScrollViewWidget',
        name: `CubeGuide${panelNumber}ScrollView`,
        fields: {
          fitToParent: true,
          scrollControllerName: `CubeGuide${panelNumber}ScrollController`,
        },
        children: [{
          type: 'TableWidget',
          name: `CubeGuide${panelNumber}Table`,
          fields: { columns: ['$CubeOptionsTableColumn1'], rowHeight: '$CubeGuideTableRowHeight' },
          children: rows,
        }],
      },
    ],
  };
}

function makeRootPanel() {
  return {
    type: 'SettingsPanel',
    name: 'CubeRecipesPanel',
    fields: { priority: 9002, fitToParent: true },
    children: [
      {
        type: 'RectangleWidget',
        name: 'CubeGuideOverlay',
        fields: { fitToScreen: true, color: [0.0, 0.0, 0.0, 0.7] },
        children: [
          {
            type: 'ClickCatcherWidget',
            name: 'CubeGuideCatcher',
            fields: { fitToParent: true },
          },
          {
            type: 'Widget',
            name: 'CubeGuideAnchor',
            fields: { anchor: { x: 0.5, y: 0.5 }, rect: '$SettingsPanelAnchorRect' },
            children: [
              {
                type: 'ImageWidget',
                name: 'CubeGuideFrame',
                fields: { filename: '\\PANEL\\Options\\FrontEndOptionsBG' },
              },
              {
                type: 'TextBoxWidget',
                name: 'CubeGuideTitle',
                fields: {
                  rect: { x: 0, y: 50, width: 1950, height: 103 },
                  text: 'TCP Cube Guide',
                  style: '$StyleTitleBlock',
                },
              },
              {
                type: 'ButtonWidget',
                name: 'CubeGuideCloseButton',
                fields: {
                  rect: { x: 1868, y: 8 },
                  filename: 'PANEL\\closebtn_4x',
                  hoveredFrame: 3,
                  onClickMessage: 'PanelManager:ClosePanel:CubeRecipesPanel',
                  tooltipString: '@strClose',
                  sound: 'cursor_close_window_hd',
                  acceptsEscKeyEverywhere: true,
                },
              },
            ],
          },
        ],
      },
      {
        type: 'ImageWidget',
        name: 'CubeGuideSettingsBackground',
        fields: {
          rect: '$SettingsPanelBackgroundRect',
          anchor: { x: 0.5 },
          filename: 'Controller/Panel/Options/Panel_Options_BG',
        },
      },
      {
        type: 'TabBarWidget',
        name: 'CubeGuideTabs',
        fields: {
          rect: '$SettingsPanelTabsRect',
          anchor: { x: 0.5 },
          tabCount: 4,
          tabSize: { x: 266, y: 121 },
          tabPadding: { x: 2, y: 0 },
          unavailableTabsLeaveGaps: false,
          tabSizingMethod: 'fixedCenter',
          filename: 'Controller/Panel/Stash/V2/StashTabs',
          inactiveFrames: [1, 1, 1, 1],
          activeFrames: [0, 0, 0, 0],
          activeTextColor: '$TabsActiveTextColor',
          inactiveTextColor: '$TabsInactiveTextColor',
          tabTextOffset: { x: 0, y: -4 },
          textStyle: {
            options: { lineWrap: true },
            pointSize: '$MediumFontSize',
            alignment: { h: 'center', v: 'center' },
            fontColor: '$FontColorWhite',
            spacing: { leading: 0.9, kerning: 0.95 },
          },
          textStrings: ['Essentials', 'Upgrades', 'Crafting', 'Corruptions'],
          tabMessages: TABS.map((tab) => `SettingsPanelMessage:CheckChanges:${tab.panelName}`),
        },
      },
    ],
  };
}

function validateEntries(entriesByTab) {
  const errors = [];
  const forbiddenText = /Storage Bag|\bRemover\b|\bArrows?\b|\bBolts?\b|\bQuivers?\b|Uber Ancient|Worldstone/i;
  for (const [tab, entries] of Object.entries(entriesByTab)) {
    for (const entry of entries) {
      if (!entry.text) errors.push(`${tab}: empty guide row`);
      if (entry.text.length > 150) errors.push(`${tab}: row longer than 150 characters: ${entry.text}`);
      if (forbiddenText.test(entry.text)) errors.push(`${tab}: excluded content leaked into guide: ${entry.text}`);
    }
  }
  if (errors.length) fail(errors.join('\n'));
}

function validateSocketRestrictions(activeRows, types) {
  const forbidden = ['ring', 'boot', 'glov', 'amul', 'belt'];
  const violations = activeRows.filter((row) => {
    if (!isSocketRecipe(row)) return false;
    const target = tokenParts(row['input 1']).base;
    return forbidden.some((type) => types.tokenInherits(target, type));
  });
  if (violations.length) {
    fail(`Active socket recipes target forbidden item types: ${violations.map((row) => row.description).join(', ')}`);
  }
}

function buildGuide() {
  const types = buildTypeSystem();
  const miscRows = tableObjects(FILES.misc);
  const removerCodes = new Set(miscRows.filter((row) => /Remover/i.test(row.name)).map((row) => row.code));
  const converterCodes = new Set(miscRows.filter((row) => /Rune Converter/i.test(row.name)).map((row) => row.code));
  const potionCodes = new Set(miscRows.filter((row) => /Potion|Elixir/i.test(row.name)).map((row) => row.code));
  const cubeRows = tableObjects(FILES.cube);
  const activeRows = cubeRows.filter((row) => row.enabled === '1');
  validateSocketRestrictions(activeRows, types);

  const excluded = new Map();
  const included = [];
  for (const row of activeRows) {
    const reason = exclusionReason(row, types, removerCodes, converterCodes);
    if (reason) {
      if (!excluded.has(reason)) excluded.set(reason, []);
      excluded.get(reason).push(row);
    } else {
      included.push(row);
    }
  }

  const corruptionRows = included.filter(isCorruption);
  const craftingRows = included.filter((row) => Boolean(craftOutput(row)));
  const remaining = included.filter((row) => !isCorruption(row) && !craftOutput(row));
  const enchantmentRows = remaining.filter((row) => Boolean(enchantmentFamily(row)));
  const malusRows = remaining.filter(isMalusImbue);
  const augmentRows = remaining.filter((row) => /Augment/i.test(row.description));
  const mfGfRows = remaining.filter(isMfGfRecipe);
  const dyeRows = remaining.filter(isDyeRecipe);
  const gfxRows = remaining.filter(isGfxRecipe);
  const familyRows = new Set([
    ...enchantmentRows, ...malusRows, ...augmentRows, ...mfGfRows, ...dyeRows, ...gfxRows,
  ]);
  const ungrouped = remaining.filter((row) => !familyRows.has(row));
  const larzukRows = ungrouped.filter(isLarzukSocketRecipe);
  const withoutLarzuk = ungrouped.filter((row) => !isLarzukSocketRecipe(row));
  const pairedSocketRows = withoutLarzuk.filter(isPairedCubeSocketRecipe);
  const ordinary = withoutLarzuk.filter((row) => !isPairedCubeSocketRecipe(row));
  const upgradeRows = ordinary.filter(isUpgradeRecipe);
  const essentialRows = ordinary.filter((row) => !isUpgradeRecipe(row));
  const anomalies = [];
  const excludedRuneRows = excluded.get('rune-conversions') || [];
  const primaryRuneConversions = excludedRuneRows.filter((row) => (
    types.tokenInherits(tokenParts(row.output).base, 'rune')
    && rowTokens(row, INPUT_FIELDS).some(({ base }) => types.tokenInherits(base, 'rune'))
  )).length;
  const keptSecondaryRuneCorruptions = included.filter((row) => (
    isCorruption(row)
    && rowTokens(row, ['output b', 'output c']).some(({ base }) => types.tokenInherits(base, 'rune'))
  )).length;

  const entriesByTab = {
    essentials: [
      ...buildDisplayEntries(dyeRows, gfxRows),
      ...groupedEntries(essentialRows, (row) => subsectionForEssentials(row, potionCodes), [
        'Quests & Portals', 'Potions', 'Repair & Recovery', 'Utilities & Special Recipes',
      ]),
    ],
    upgrades: [
      ...buildLarzukEntries(larzukRows),
      ...(pairedSocketRows.length ? [section('Cube Socketing'), ...buildPairedCubeSocketEntries(pairedSocketRows)] : []),
      ...buildEnchantmentEntries(enchantmentRows, types),
      ...buildMalusEntries(malusRows),
      ...buildAugmentEntries(augmentRows),
      ...buildMfGfEntries(mfGfRows, types),
      ...groupedEntries(upgradeRows, subsectionForUpgrades, [
        'Socketing & Socket Removal', 'Item Tiers & Quality', 'Rerolls', 'Imbuing & Augments', 'Other Upgrades',
      ]),
    ],
    crafting: buildCraftingEntries(craftingRows, types, anomalies),
    corruptions: buildCorruptionEntries(corruptionRows, types, anomalies),
  };
  validateEntries(entriesByTab);

  const generated = new Map();
  generated.set(
    path.join(FILES.layouts, 'cuberecipespanelhd.json'),
    `${JSON.stringify(makeRootPanel(), null, 4)}\n`,
  );
  for (const tab of TABS) {
    const panel = makePanel(tab.panelName, tab.number, entriesByTab[tab.key]);
    generated.set(
      path.join(FILES.layouts, `cuberecipes${tab.number}panelhd.json`),
      `${JSON.stringify(panel, null, 4)}\n`,
    );
  }

  return {
    generated,
    report: {
      active: activeRows.length,
      excluded: Object.fromEntries([...excluded].map(([reason, rows]) => [reason, rows.length])),
      included: included.length,
      sourceFamilies: {
        essentials: essentialRows.length,
        upgrades: upgradeRows.length,
        larzukSocketing: larzukRows.length,
        pairedCubeSocketing: pairedSocketRows.length,
        worldstoneEnchantments: enchantmentRows.length,
        malusImbuing: malusRows.length,
        augments: augmentRows.length,
        mfGfAugments: mfGfRows.length,
        appearanceRecipes: dyeRows.length + gfxRows.length,
        crafting: craftingRows.length,
        corruptions: corruptionRows.length,
      },
      guideRows: Object.fromEntries(Object.entries(entriesByTab).map(([tab, entries]) => [
        tab,
        entries.filter((entry) => entry.kind === 'line').length,
      ])),
      maximumTextLength: Math.max(...Object.values(entriesByTab).flat().map((entry) => entry.text.length)),
      runeHandling: {
        primaryConversionsExcluded: primaryRuneConversions,
        converterCyclesExcluded: excludedRuneRows.length - primaryRuneConversions,
        secondaryRuneCorruptionsKept: keptSecondaryRuneCorruptions,
      },
      anomalies: unique(anomalies),
    },
  };
}

function writeOrCheck(generated) {
  const stale = [];
  for (const [filePath, content] of generated) {
    if (CHECK_ONLY) {
      if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content) stale.push(filePath);
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }
  if (stale.length) fail(`Cube guide is stale. Regenerate: ${stale.join(', ')}`);
}

function validateIntegration() {
  const required = [
    FILES.mouseCube,
    FILES.controllerCube,
    FILES.profileHd,
    FILES.profileLv,
    FILES.recipeSprite,
    FILES.recipeSpriteLow,
  ];
  const missing = required.filter((filePath) => !fs.existsSync(filePath) || fs.statSync(filePath).size === 0);
  if (missing.length) fail(`Cube guide integration files missing: ${missing.join(', ')}`);

  const mouseCube = fs.readFileSync(FILES.mouseCube, 'utf8');
  const controllerCube = fs.readFileSync(FILES.controllerCube, 'utf8');
  const profileHd = fs.readFileSync(FILES.profileHd, 'utf8');
  const profileLv = fs.readFileSync(FILES.profileLv, 'utf8');
  if (!mouseCube.includes('PanelManager:OpenPanel:CubeRecipesPanel')) {
    fail('Mouse cube layout does not open CubeRecipesPanel');
  }
  if (!controllerCube.includes('"name": "Recipes"') || !controllerCube.includes('"name": "convert"')) {
    fail('Controller cube layout is missing Recipes/convert navigation');
  }
  for (const [label, profile] of [['HD', profileHd], ['LV', profileLv]]) {
    if (!profile.includes('"CubeGuideText"')) fail(`${label} profile is missing CubeGuideText`);
  }
  if (!profileHd.includes('"CubeGuideSectionText"')) fail('HD profile is missing CubeGuideSectionText');
  if (!profileHd.includes('"CubeGuideDividerRect"')) fail('HD profile is missing CubeGuideDividerRect');
  if (!profileHd.includes('"CubeGuideTableRowHeight"')) fail('HD profile is missing CubeGuideTableRowHeight');
}

function printReport(report) {
  console.log(`Cube guide ${CHECK_ONLY ? 'check' : 'generation'}: OK`);
  console.log(`Active recipes: ${report.active}`);
  console.log(`Included source recipes: ${report.included}`);
  for (const [reason, count] of Object.entries(report.excluded)) console.log(`Excluded ${reason}: ${count}`);
  for (const [tab, count] of Object.entries(report.guideRows)) console.log(`Guide ${tab}: ${count} player rows`);
  console.log(`Maximum player text length: ${report.maximumTextLength}`);
  console.log(
    `Rune handling: ${report.runeHandling.primaryConversionsExcluded} conversions + `
    + `${report.runeHandling.converterCyclesExcluded} converter cycles excluded; `
    + `${report.runeHandling.secondaryRuneCorruptionsKept} corruption rows with secondary runes kept`,
  );
  for (const anomaly of report.anomalies) console.warn(`WARNING: ${anomaly}`);
}

const { generated, report } = buildGuide();
writeOrCheck(generated);
validateIntegration();
printReport(report);
