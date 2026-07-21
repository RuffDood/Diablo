function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matches(query, ...values) {
  const needle = normalize(query).trim();
  return !needle || values.some((value) => normalize(value).includes(needle));
}

export function searchCatalog(catalog, query, category = 'unique', limit = 60) {
  let source;
  if (category === 'base') source = catalog.baseItems;
  else if (category === 'set') source = catalog.setItems;
  else if (category === 'skill') source = catalog.skills;
  else if (category === 'gem') source = catalog.gems;
  else source = catalog.uniqueItems;

  return (source || [])
    .filter((entry) => matches(query, entry.name, entry.code, entry.baseCode, entry.itemNameKey, entry.descriptionKey))
    .slice(0, limit);
}

export function resolveUniqueProperties(catalog, unique) {
  const properties = new Map(catalog.properties.map((entry) => [entry.code, entry]));
  const stats = new Map(catalog.itemStats.map((entry) => [entry.name, entry]));

  return unique.properties.map((slot) => {
    const definition = properties.get(slot.code);
    const encodings = (definition?.functions || [])
      .map((entry) => ({ ...entry, encoding: entry.stat ? stats.get(entry.stat) || null : null }));
    return { ...slot, definition: definition || null, encodings };
  });
}
