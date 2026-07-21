import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveUniqueProperties, searchCatalog } from './catalog.js';

const catalog = {
  uniqueItems: [{ name: 'Annihilus', baseCode: 'cm1', properties: [{ slot: 1, code: 'allskills', min: 1, max: 1 }] }],
  baseItems: [{ name: 'Small Charm', code: 'cm1' }],
  setItems: [],
  skills: [{ name: 'Warlock Nova', descriptionKey: 'warlocknova' }],
  gems: [],
  properties: [{ code: 'allskills', functions: [{ slot: 1, func: 1, stat: 'item_allskills' }] }],
  itemStats: [{ name: 'item_allskills', saveBits: 7, saveAdd: 64 }],
};

test('searches BKVince catalog entries by display name or code', () => {
  assert.equal(searchCatalog(catalog, 'anni', 'unique')[0].name, 'Annihilus');
  assert.equal(searchCatalog(catalog, 'cm1', 'base')[0].name, 'Small Charm');
  assert.equal(searchCatalog(catalog, 'nova', 'skill')[0].name, 'Warlock Nova');
});

test('resolves a unique property to the BKVince ItemStatCost encoding', () => {
  const [property] = resolveUniqueProperties(catalog, catalog.uniqueItems[0]);
  assert.equal(property.encodings[0].encoding.saveBits, 7);
  assert.equal(property.encodings[0].encoding.saveAdd, 64);
});
