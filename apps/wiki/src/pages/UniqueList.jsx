import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import data from '../data/uniques.json';

export default function UniqueList() {
  const [search, setSearch] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.items.filter((item) => {
      if (onlyChanged && !isChanged(item)) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || item.fields.itemName.value.toLowerCase().includes(q);
    });
  }, [search, onlyChanged]);

  return (
    <div className="page">
      <p className="intro">
        {data.count} objets uniques du mod TCP · <b>{data.newCount}</b> nouveaux ·{' '}
        <b>{data.changedCount}</b> modifiés par rapport au vanilla.
      </p>
      <div className="toolbar">
        <input
          type="text"
          className="recherche"
          placeholder="Chercher un objet unique…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="filtre-changed">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          Modifiés seulement
        </label>
      </div>
      <ul className="liste-items">
        {filtered.map((item) => (
          <li key={item.slug}>
            <Link to={`/uniques/${item.slug}`} className="carte-item">
              <span className="nom">{item.name}</span>
              <span className="base">{item.fields.itemName.value}</span>
              {item.isNew && <span className="badge badge-nouveau">Nouveau</span>}
              {!item.isNew && isChanged(item) && <span className="badge badge-modifie">Modifié</span>}
            </Link>
          </li>
        ))}
        {filtered.length === 0 && <li className="vide">Aucun objet ne correspond à la recherche.</li>}
      </ul>
    </div>
  );
}

function isChanged(item) {
  return item.isNew || item.diffFields.length > 0 || item.properties.some((p) => p.diff) || item.propertiesRemovedFromVanilla.length > 0;
}
