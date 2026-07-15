import { useEffect, useMemo, useState, useCallback } from 'react';

const PAGE_SIZE = 25;

export default function App() {
  const [tables, setTables] = useState([]);
  const [table, setTable] = useState('hireling');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('Chargement…');
  const [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null); // { row, col }

  // liste des tables (une fois)
  useEffect(() => {
    fetch('/api/tables')
      .then((r) => r.json())
      .then((d) => setTables(d.tables || []))
      .catch(() => {});
  }, []);

  // charge la table courante
  const loadTable = useCallback((name) => {
    setData(null);
    setStatus('Chargement…');
    setPage(0);
    setEditing(null);
    setDirty(false);
    fetch(`/api/table/${name}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        setStatus(`${d.rows.length} lignes × ${d.headers.length} colonnes${d.schema ? ' · schéma chargé' : ' · non documentée'}`);
      })
      .catch((e) => setStatus('Erreur : ' + e.message));
  }, []);

  useEffect(() => { loadTable(table); }, [table, loadTable]);

  function changeTable(name) {
    if (name === table) return;
    if (dirty && !window.confirm('Modifications non sauvegardées sur ' + table + '.txt — changer de table quand même ?')) return;
    setTable(name);
  }

  const colMeta = useMemo(() => {
    const map = {};
    (data?.schema?.columns || []).forEach((c) => { map[c.name] = c; });
    return map;
  }, [data]);

  function commit(rowIdx, colIdx, value) {
    setData((prev) => {
      if (prev.rows[rowIdx][colIdx] === value) return prev;
      setDirty(true);
      setStatus('Modifié (non sauvegardé)');
      return {
        ...prev,
        rows: prev.rows.map((r, i) =>
          i === rowIdx ? r.map((c, j) => (j === colIdx ? value : c)) : r,
        ),
      };
    });
  }

  async function save() {
    setStatus('Sauvegarde…');
    try {
      const res = await fetch(`/api/table/${table}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: data.headers, rows: data.rows }),
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || 'inconnue');
      setStatus('Sauvegardé ✓');
      setDirty(false);
    } catch (e) {
      setStatus('Erreur : ' + e.message);
    }
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.rows.length / PAGE_SIZE)) : 1;
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * PAGE_SIZE;
  const pageRows = data ? data.rows.slice(start, start + PAGE_SIZE) : [];

  return (
    <div className="app">
      <header>
        <h1>Éditeur de tables <small>· mod TCP</small></h1>
        <div className="bar">
          <select value={table} onChange={(e) => changeTable(e.target.value)}>
            {tables.length === 0 && <option value={table}>{table}</option>}
            {tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={save} disabled={!dirty || !data}>Sauvegarder</button>
          {data && (
            <span className="pager">
              <button onClick={() => setPage(Math.max(0, clampedPage - 1))} disabled={clampedPage === 0}>‹</button>
              <span>page {clampedPage + 1} / {pageCount} · lignes {start + 1}–{Math.min(start + PAGE_SIZE, data.rows.length)}</span>
              <button onClick={() => setPage(Math.min(pageCount - 1, clampedPage + 1))} disabled={clampedPage >= pageCount - 1}>›</button>
            </span>
          )}
          <span className="status">{status}</span>
        </div>
        {data?.schema && <p className="desc">{data.schema.description} <em>· clique une cellule pour l'éditer</em></p>}
      </header>

      {data && (
        <div className="grid">
          <table>
            <thead>
              <tr>
                <th className="rownum">#</th>
                {data.headers.map((h, j) => {
                  const meta = colMeta[h];
                  const cls = meta?.comment ? 'comment' : meta?.type === 'number' ? 'num' : 'text';
                  return (
                    <th key={j} className={cls}
                        title={meta ? `${meta.type}${meta.ref ? ' → ' + meta.ref : ''} — ${meta.description}` : 'colonne non documentée'}>
                      {h}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, pi) => {
                const i = start + pi;
                return (
                  <tr key={i}>
                    <td className="rownum">{i + 1}</td>
                    {row.map((cell, j) => {
                      const meta = colMeta[data.headers[j]];
                      const isNum = meta?.type === 'number';
                      const isEditing = editing && editing.row === i && editing.col === j;
                      return (
                        <td key={j} className={isNum ? 'num' : ''} onClick={() => setEditing({ row: i, col: j })}>
                          {isEditing ? (
                            <input
                              autoFocus
                              defaultValue={cell}
                              inputMode={isNum ? 'numeric' : 'text'}
                              onBlur={(e) => { commit(i, j, e.target.value); setEditing(null); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') setEditing(null);
                              }}
                            />
                          ) : (
                            <span className="cell">{cell === '' ? ' ' : cell}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
