import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../data/bkvince-catalog.json' with { type: 'json' };
import { analyzeUniqueSerialization, createUniqueItemRecord } from './item-writer.js';
import { readUniqueMiscItemRecord } from './item-reader.js';

const annihilus = catalog.uniqueItems.find((item) => item.name === 'Annihilus');

test('recognizes Annihilus as a safely supported unique', () => {
  const analysis = analyzeUniqueSerialization(catalog, annihilus);
  assert.equal(analysis.supported, true, analysis.reasons.join('\n'));
  assert.equal(analysis.base.code, 'cm1');
  assert.equal(analysis.itemType.variableInventoryGraphics, 3);
});

test('writes and reads an Annihilus with BKVince Save Bits and Save Add values', () => {
  const generated = createUniqueItemRecord(catalog, annihilus, {
    x: 10,
    y: 7,
    roll: 'max',
    seed: 0x12345678,
  });
  const parsed = readUniqueMiscItemRecord(generated.bytes, catalog);

  assert.equal(parsed.code, 'cm1');
  assert.equal(parsed.uniqueId, 381);
  assert.equal(parsed.seed, 0x12345678);
  assert.equal(parsed.itemLevel, 110);
  assert.deepEqual(parsed.position, { mode: 0, bodyLocation: 0, x: 10, y: 7, storePage: 0 });
  assert.equal(parsed.stats.length, 10);
  assert.deepEqual(
    parsed.stats.map(({ name, raw, value }) => [name, raw, value]),
    [
      ['item_allskills', 65, 1],
      ['strength', 52, 20],
      ['energy', 52, 20],
      ['dexterity', 52, 20],
      ['vitality', 52, 20],
      ['fireresist', 220, 20],
      ['lightresist', 220, 20],
      ['coldresist', 220, 20],
      ['poisonresist', 220, 20],
      ['item_addexperience', 65, 15],
    ],
  );
});
