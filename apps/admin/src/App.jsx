import { useEffect, useMemo, useState, useCallback } from 'react';

const PAGE_SIZE = 25;

// Validation d'une cellule selon le schema. Retourne un message d'erreur, ou null si valide.
function cellError(meta, value) {
  if (!meta || value === '') return null;
  if (meta.type === 'number' && !/^-?\d+$/.test(value)) return 'attend un nombre entier';
  if (meta.type === 'boolean' && value !== '0' && value !== '1') return 'attend 0 ou 1';
  return null;
}

// --- Écran de connexion (courriel autorisé) ---
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || 'échec de connexion');
      onLogin();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h1>Éditeur de tables <small>· mod TCP</small></h1>
      <form onSubmit={submit}>
        <p>Connecte-toi avec ton courriel autorisé.</p>
        <input type="email" required placeholder="toi@spheredi.com" value={email}
               onChange={(e) => setEmail(e.target.value)} autoFocus />
        <button type="submit" disabled={busy}>{busy ? '…' : 'Entrer'}</button>
        {err && <p className="err-msg">{err}</p>}
      </form>
    </div>
  );
}

// --- Application : porte d'auth ---
export default function App() {
  const [auth, setAuth] = useState(null);

  const loadMe = useCallback(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then(setAuth)
      .catch(() => setAuth({ authenticated: false, authConfigured: false }));
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  async function logout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch {}
    loadMe();
  }

  if (!auth) return <div className="app"><p className="status">Chargement…</p></div>;
  if (!auth.authenticated && auth.authConfigured) return <Login onLogin={loadMe} />;

  return <Editor auth={auth} onLogout={logout} />;
}

// --- L'éditeur (monté uniquement si autorisé) ---
function Editor({ auth, onLogout }) {
  const [tables, setTables] = useState([]);
  const [table, setTable] = useState('hireling');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('Chargement…');
  const [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    fetch('/api/tables').then((r) => r.json()).then((d) => setTables(d.tables || [])).catch(() => {});
  }, []);

  const loadTable = useCallback((name) => {
    setData(null); setStatus('Chargement…'); setPage(0); setEditing(null); setDirty(false);
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
      return { ...prev, rows: prev.rows.map((r, i) => (i === rowIdx ? r.map((c, j) => (j === colIdx ? value : c)) : r)) };
    });
  }

  function countErrors() {
    if (!data) return 0;
    let n = 0;
    for (const row of data.rows) for (let j = 0; j < data.headers.length; j++) if (cellError(colMeta[data.headers[j]], row[j])) n++;
    return n;
  }

  async function save() {
    const errors = countErrors();
    if (errors > 0 && !window.confirm(`${errors} cellule(s) invalide(s) selon le schéma. Sauvegarder quand même ?`)) {
      setStatus(`${errors} cellule(s) invalide(s) — sauvegarde annulée`);
      return;
    }
    setStatus('Sauvegarde…');
    try {
      const res = await fetch(`/api/table/${table}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: data.headers, rows: data.rows }),
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || 'inconnue');
      setStatus(out.commit ? `Sauvegardé ✓ (commit ${String(out.commit).slice(0, 7)})` : 'Sauvegardé ✓');
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
      {!auth.authConfigured && <div className="banniere">⚠ Mode ouvert (local) — aucune authentification.</div>}
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
          {auth.authenticated && auth.user?.email !== 'local' && (
            <span className="compte">{auth.user?.email} · <a onClick={onLogout}>déconnexion</a></span>
          )}
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
                      const err = cellError(meta, cell);
                      const cls = (isNum ? 'num ' : '') + (err ? 'err' : '');
                      return (
                        <td key={j} className={cls.trim()}
                            title={err ? `⚠ ${data.headers[j]} : ${err}` : undefined}
                            onClick={() => setEditing({ row: i, col: j })}>
                          {isEditing ? (
                            <input autoFocus defaultValue={cell} inputMode={isNum ? 'numeric' : 'text'}
                                   onBlur={(e) => { commit(i, j, e.target.value); setEditing(null); }}
                                   onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }} />
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
