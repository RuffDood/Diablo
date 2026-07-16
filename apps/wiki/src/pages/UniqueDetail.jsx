import { Link, useParams } from 'react-router-dom';
import data from '../data/uniques.json';

export default function UniqueDetail() {
  const { slug } = useParams();
  const item = data.items.find((i) => i.slug === slug);

  if (!item) {
    return (
      <div className="page">
        <p className="vide">Objet inconnu.</p>
        <Link to="/">← Retour à la liste</Link>
      </div>
    );
  }

  return (
    <div className="page detail">
      <Link to="/" className="retour">← Tous les objets uniques</Link>
      <h2>
        {item.name}
        {item.isNew && <span className="badge badge-nouveau">Nouveau</span>}
      </h2>
      <p className="sous-titre">{item.fields.itemName.value}</p>

      <table className="table-champs">
        <tbody>
          {Object.entries(item.fields).map(([key, f]) => (
            <tr key={key} className={item.diffFields.includes(key) ? 'diff' : ''}>
              <td className="k">{f.label}</td>
              <td>{f.value || '—'}</td>
              {item.diffFields.includes(key) && <td className="vanilla-val">vanilla : {f.vanilla || '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Propriétés</h3>
      <p className="note">
        Codes bruts du fichier .txt (<code>propriété : min–max</code>) — traduction en texte lisible à venir.
      </p>
      <ul className="liste-proprietes">
        {item.properties.map((p) => (
          <li key={p.slot} className={p.diff ? 'diff' : ''}>
            <code>{p.prop}</code> : {p.min === p.max ? p.min : `${p.min}–${p.max}`}
            {p.par !== '' && <span className="par"> (par {p.par})</span>}
          </li>
        ))}
        {item.properties.length === 0 && <li className="vide">Aucune propriété.</li>}
      </ul>
      {item.propertiesRemovedFromVanilla.length > 0 && (
        <p className="note note-retire">
          {item.propertiesRemovedFromVanilla.length} propriété(s) du vanilla retirée(s) dans TCP.
        </p>
      )}
    </div>
  );
}
