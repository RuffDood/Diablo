'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseTable } = require('../../../scripts/build-data/tsv');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TXT_ROOT = path.join(ROOT, 'data-BKVince', 'BKVince.mpq', 'data', 'global', 'excel');
const OUTPUT = path.join(__dirname, '..', 'src', 'data', 'bkvince-catalog.json');
const CHECK = process.argv.includes('--check');

function fail(message) {
  throw new Error(`[hero-editor catalog] ${message}`);
}

function load(name, requiredHeaders) {
  const filePath = path.join(TXT_ROOT, `${name}.txt`);
  if (!fs.existsSync(filePath)) fail(`missing BKVince table: ${filePath}`);

  const table = parseTable(filePath);
  const index = Object.fromEntries(table.headers.map((header, position) => [header, position]));
  for (const header of requiredHeaders) {
    if (index[header] === undefined) fail(`${name}.txt is missing required header ${header}`);
  }

  const raw = fs.readFileSync(filePath);
  return {
    name,
    table,
    index,
    hash: crypto.createHash('sha256').update(raw).digest('hex'),
  };
}

function value(source, row, header) {
  const position = source.index[header];
  return position === undefined ? '' : (row[position] ?? '');
}

function integer(raw) {
  if (raw === '' || raw === undefined || raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function flag(raw) {
  return raw === '1';
}

function propertySlots(source, row, count, prefix = 'prop') {
  const slots = [];
  for (let slot = 1; slot <= count; slot += 1) {
    const code = value(source, row, prefix === 'prop' ? `prop${slot}` : `mod${slot}code`);
    if (!code) continue;
    slots.push({
      slot,
      code,
      parameter: value(source, row, prefix === 'prop' ? `par${slot}` : `mod${slot}param`),
      min: integer(value(source, row, prefix === 'prop' ? `min${slot}` : `mod${slot}min`)),
      max: integer(value(source, row, prefix === 'prop' ? `max${slot}` : `mod${slot}max`)),
    });
  }
  return slots;
}

function tableMetadata(sources) {
  return Object.fromEntries(sources.map((source) => [source.name, {
    sha256: source.hash,
    rows: source.table.rows.length,
    columns: source.table.headers.length,
  }]));
}

function buildCatalog() {
  const itemStatCost = load('itemstatcost', ['Stat', '*ID', 'CSvSigned', 'CSvBits', 'CSvParam', 'Save Bits', 'Save Add', 'Save Param Bits']);
  const properties = load('properties', ['code', 'func1', 'stat1']);
  const charstats = load('charstats', ['class']);
  const skills = load('skills', ['skill', '*Id', 'charclass', 'skilldesc', 'reqlevel', 'maxlvl']);
  const skilldesc = load('skilldesc', ['skilldesc']);
  const uniqueitems = load('uniqueitems', ['index', '*ID', 'spawnable', 'code', 'prop1']);
  const setitems = load('setitems', ['index', '*ID', 'set', 'spawnable', 'item']);
  const sets = load('sets', ['index', 'name']);
  const magicprefix = load('magicprefix', ['Name', 'spawnable', 'mod1code']);
  const magicsuffix = load('magicsuffix', ['Name', 'spawnable', 'mod1code']);
  const automagic = load('automagic', ['Name', 'spawnable', 'mod1code']);
  const runes = load('runes', ['Name', '*Rune Name']);
  const gems = load('gems', ['name', 'code']);
  const armor = load('armor', ['name', 'code', 'invwidth', 'invheight', 'type']);
  const weapons = load('weapons', ['name', 'code', 'invwidth', 'invheight', 'type']);
  const misc = load('misc', ['name', 'code', 'invwidth', 'invheight', 'type']);
  const itemtypes = load('itemtypes', ['ItemType', 'Code', 'Equiv1', 'Equiv2']);
  const inventory = load('inventory', ['class', 'gridX', 'gridY']);
  const sources = [
    itemStatCost, properties, charstats, skills, skilldesc, uniqueitems, setitems, sets,
    magicprefix, magicsuffix, automagic, runes, gems, armor, weapons, misc, itemtypes, inventory,
  ];

  const stats = itemStatCost.table.rows
    .map((row) => ({
      id: integer(value(itemStatCost, row, '*ID')),
      name: value(itemStatCost, row, 'Stat'),
      saved: flag(value(itemStatCost, row, 'Saved')),
      csvSigned: flag(value(itemStatCost, row, 'CSvSigned')),
      csvBits: integer(value(itemStatCost, row, 'CSvBits')),
      csvParamBits: integer(value(itemStatCost, row, 'CSvParam')),
      saveBits: integer(value(itemStatCost, row, 'Save Bits')),
      saveAdd: integer(value(itemStatCost, row, 'Save Add')),
      saveParamBits: integer(value(itemStatCost, row, 'Save Param Bits')),
      signed: flag(value(itemStatCost, row, 'Signed')),
      encode: integer(value(itemStatCost, row, 'Encode')),
      valShift: integer(value(itemStatCost, row, 'ValShift')),
    }))
    .filter((stat) => stat.name && stat.id !== null);

  const propertyList = properties.table.rows
    .map((row) => ({
      code: value(properties, row, 'code'),
      id: integer(value(properties, row, '*Id')),
      enabled: value(properties, row, '*Enabled') !== '0',
      functions: Array.from({ length: 7 }, (_, position) => position + 1)
        .map((slot) => ({
          slot,
          func: integer(value(properties, row, `func${slot}`)),
          stat: value(properties, row, `stat${slot}`),
          set: value(properties, row, `set${slot}`),
          value: value(properties, row, `val${slot}`),
        }))
        .filter((entry) => entry.func !== null || entry.stat || entry.set || entry.value),
    }))
    .filter((entry) => entry.code);

  const classes = charstats.table.rows
    .map((row) => value(charstats, row, 'class'))
    .filter((name) => name && name !== 'Expansion')
    .map((name, id) => ({ id, name }));

  const skillList = skills.table.rows
    .map((row) => ({
      id: integer(value(skills, row, '*Id')),
      name: value(skills, row, 'skill'),
      classCode: value(skills, row, 'charclass'),
      descriptionKey: value(skills, row, 'skilldesc'),
      requiredLevel: integer(value(skills, row, 'reqlevel')),
      maxLevel: integer(value(skills, row, 'maxlvl')),
      skillPointCost: integer(value(skills, row, 'skpoints')),
      prerequisites: [1, 2, 3].map((slot) => value(skills, row, `reqskill${slot}`)).filter(Boolean),
    }))
    .filter((skill) => skill.id !== null && skill.name);

  const uniques = uniqueitems.table.rows
    .map((row) => ({
      id: integer(value(uniqueitems, row, '*ID')),
      name: value(uniqueitems, row, 'index'),
      baseCode: value(uniqueitems, row, 'code'),
      itemNameKey: value(uniqueitems, row, '*ItemName'),
      spawnable: flag(value(uniqueitems, row, 'spawnable')),
      disabled: flag(value(uniqueitems, row, 'disabled')),
      noLimit: flag(value(uniqueitems, row, 'nolimit')),
      level: integer(value(uniqueitems, row, 'lvl')),
      requiredLevel: integer(value(uniqueitems, row, 'lvl req')),
      carryOne: flag(value(uniqueitems, row, 'carry1')),
      properties: propertySlots(uniqueitems, row, 12),
    }))
    .filter((item) => item.name && item.id !== null);

  const setItemList = setitems.table.rows
    .map((row) => ({
      id: integer(value(setitems, row, '*ID')),
      name: value(setitems, row, 'index'),
      set: value(setitems, row, 'set'),
      baseCode: value(setitems, row, 'item'),
      itemNameKey: value(setitems, row, '*ItemName'),
      spawnable: flag(value(setitems, row, 'spawnable')),
      disabled: flag(value(setitems, row, 'disabled')),
      level: integer(value(setitems, row, 'lvl')),
      requiredLevel: integer(value(setitems, row, 'lvl req')),
      properties: propertySlots(setitems, row, 9),
    }))
    .filter((item) => item.name && item.id !== null);

  function affixesFrom(source, kind) {
    return source.table.rows
      .map((row, id) => ({
        id,
        kind,
        name: value(source, row, 'Name'),
        spawnable: flag(value(source, row, 'spawnable')),
        rare: flag(value(source, row, 'rare')),
        level: integer(value(source, row, 'level')),
        maxLevel: integer(value(source, row, 'maxlevel')),
        requiredLevel: integer(value(source, row, 'levelreq')),
        group: integer(value(source, row, 'group')),
        includeTypes: Array.from({ length: 7 }, (_, index) => value(source, row, `itype${index + 1}`)).filter(Boolean),
        excludeTypes: Array.from({ length: 5 }, (_, index) => value(source, row, `etype${index + 1}`)).filter(Boolean),
        properties: propertySlots(source, row, 3, 'mod'),
      }))
      .filter((entry) => entry.name);
  }

  function basesFrom(source, kind) {
    return source.table.rows
      .map((row, id) => ({
        id,
        kind,
        name: value(source, row, 'name'),
        nameKey: value(source, row, 'namestr'),
        code: value(source, row, 'code'),
        type: value(source, row, 'type'),
        type2: value(source, row, 'type2'),
        level: integer(value(source, row, 'level')),
        requiredLevel: integer(value(source, row, 'levelreq')),
        width: integer(value(source, row, 'invwidth')),
        height: integer(value(source, row, 'invheight')),
        compactSave: flag(value(source, row, 'compactsave')),
        stackable: flag(value(source, row, 'stackable')),
        quest: flag(value(source, row, 'quest')),
        questDifficultyCheck: flag(value(source, row, 'questdiffcheck')),
        minStack: integer(value(source, row, 'minstack')),
        maxStack: integer(value(source, row, 'maxstack')),
        sockets: integer(value(source, row, 'gemsockets')),
        inventoryFile: value(source, row, 'invfile'),
        uniqueInventoryFile: value(source, row, 'uniqueinvfile'),
      }))
      .filter((item) => item.name && item.code);
  }

  const baseItems = [
    ...basesFrom(armor, 'armor'),
    ...basesFrom(weapons, 'weapon'),
    ...basesFrom(misc, 'misc'),
  ];

  const setList = sets.table.rows
    .map((row, id) => ({ id, key: value(sets, row, 'index'), name: value(sets, row, 'name') }))
    .filter((set) => set.key);

  const runeWords = runes.table.rows
    .map((row, id) => ({
      id,
      name: value(runes, row, 'Name'),
      displayName: value(runes, row, '*Rune Name'),
      complete: flag(value(runes, row, 'complete')),
      runes: Array.from({ length: 6 }, (_, index) => value(runes, row, `Rune${index + 1}`)).filter(Boolean),
      includeTypes: Array.from({ length: 6 }, (_, index) => value(runes, row, `itype${index + 1}`)).filter(Boolean),
      excludeTypes: Array.from({ length: 3 }, (_, index) => value(runes, row, `etype${index + 1}`)).filter(Boolean),
    }))
    .filter((entry) => entry.name);

  const gemList = gems.table.rows
    .map((row, id) => ({ id, name: value(gems, row, 'name'), code: value(gems, row, 'code'), letter: value(gems, row, 'letter') }))
    .filter((entry) => entry.name && entry.code);

  const itemTypeList = itemtypes.table.rows
    .map((row, id) => ({
      id,
      name: value(itemtypes, row, 'ItemType'),
      code: value(itemtypes, row, 'Code'),
      equivalents: [value(itemtypes, row, 'Equiv1'), value(itemtypes, row, 'Equiv2')].filter(Boolean),
      variableInventoryGraphics: integer(value(itemtypes, row, 'VarInvGfx')) || 0,
      maxSockets: [1, 2, 3].map((slot) => ({
        max: integer(value(itemtypes, row, `MaxSockets${slot}`)),
        levelThreshold: integer(value(itemtypes, row, `MaxSocketsLevelThreshold${slot}`)),
      })),
      restricted: flag(value(itemtypes, row, 'Restricted')),
    }))
    .filter((entry) => entry.name && entry.code);

  const inventories = inventory.table.rows
    .map((row) => ({
      class: value(inventory, row, 'class'),
      grid: {
        width: integer(value(inventory, row, 'gridX')),
        height: integer(value(inventory, row, 'gridY')),
        left: integer(value(inventory, row, 'gridLeft')),
        right: integer(value(inventory, row, 'gridRight')),
        top: integer(value(inventory, row, 'gridTop')),
        bottom: integer(value(inventory, row, 'gridBottom')),
        boxWidth: integer(value(inventory, row, 'gridBoxWidth')),
        boxHeight: integer(value(inventory, row, 'gridBoxHeight')),
      },
    }))
    .filter((entry) => entry.class);

  return {
    schemaVersion: 1,
    profile: {
      id: 'bkvince',
      label: 'BKVince 3.2',
      saveVersion: 105,
      sourceRoot: 'data-BKVince/BKVince.mpq/data/global/excel',
    },
    tables: tableMetadata(sources),
    classes,
    itemStats: stats,
    properties: propertyList,
    skills: skillList,
    skillDescriptions: skilldesc.table.rows.map((row) => value(skilldesc, row, 'skilldesc')).filter(Boolean),
    baseItems,
    uniqueItems: uniques,
    setItems: setItemList,
    sets: setList,
    affixes: [
      ...affixesFrom(magicprefix, 'prefix'),
      ...affixesFrom(magicsuffix, 'suffix'),
      ...affixesFrom(automagic, 'automagic'),
    ],
    runeWords,
    gems: gemList,
    itemTypes: itemTypeList,
    inventories,
  };
}

function main() {
  const serialized = `${JSON.stringify(buildCatalog(), null, 1)}\n`;

  if (CHECK) {
    if (!fs.existsSync(OUTPUT)) fail(`generated catalog is missing: ${OUTPUT}`);
    if (fs.readFileSync(OUTPUT, 'utf8') !== serialized) fail('generated BKVince catalog is stale; run npm run generate -w apps/hero-editor');
    process.stdout.write('BKVINCE HERO CATALOG: VALID\n');
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, serialized, 'utf8');
  const catalog = JSON.parse(serialized);
  process.stdout.write(
    `BKVINCE HERO CATALOG: ${catalog.baseItems.length} bases, ${catalog.uniqueItems.length} uniques, `
    + `${catalog.setItems.length} set items, ${catalog.skills.length} skills, ${catalog.itemStats.length} stats\n`,
  );
}

main();
