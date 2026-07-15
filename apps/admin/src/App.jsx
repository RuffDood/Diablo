import { useEffect, useMemo, useState, useCallback, useRef, Fragment } from 'react';

const PAGE_SIZE = 1000;

const CATEGORY_LABELS = {
  items: 'Objets',
  characters: 'Personnages & monstres',
  skills: 'Compétences',
  system: 'Système & progression',
  other: 'Divers',
};
const CATEGORY_ORDER = ['items', 'characters', 'skills', 'system', 'other'];

// Validation d'une cellule selon le schema. Retourne un message d'erreur, ou null si valide.
function cellError(meta, value) {
  if (!meta || value === '') return null;
  if (meta.type === 'number' && !/^-?\d+$/.test(value)) return 'attend un nombre entier';
  if (meta.type === 'boolean' && value !== '0' && value !== '1') return 'attend 0 ou 1';
  return null;
}

// Presets de colonnes visibles, par table — localStorage (personnel, pas partage entre postes).
const presetsKey = (table) => `diablo-admin:col-presets:${table}`;

function loadPresets(table) {
  try {
    const raw = localStorage.getItem(presetsKey(table));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function savePresetsToStorage(table, list) {
  try { localStorage.setItem(presetsKey(table), JSON.stringify(list)); } catch { /* stockage indisponible */ }
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
  const [search, setSearch] = useState('');
  const [filterCol, setFilterCol] = useState('');
  const [filterMin, setFilterMin] = useState('');
  const [filterMax, setFilterMax] = useState('');
  const [filterText, setFilterText] = useState('');
  const [hiddenCols, setHiddenCols] = useState(() => new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [colsSearch, setColsSearch] = useState('');
  const [presets, setPresets] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [mode, setMode] = useState('editor'); // 'editor' | 'compare' — persiste au changement de table
  const [compareData, setCompareData] = useState(null);

  useEffect(() => {
    fetch('/api/tables').then((r) => r.json()).then((d) => setTables(d.tables || [])).catch(() => {});
  }, []);

  const loadTable = useCallback((name) => {
    setData(null); setStatus('Chargement…'); setPage(0); setEditing(null); setDirty(false);
    setSearch(''); setFilterCol(''); setFilterMin(''); setFilterMax(''); setFilterText('');
    setHiddenCols(new Set()); setColsOpen(false); setColsSearch('');
    setPresets(loadPresets(name)); setSelectedPreset('');
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

  // Lignes filtrees (recherche libre + filtre colonne), en conservant l'index original
  // (necessaire pour que commit() continue de viser la bonne ligne de data.rows).
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const filterColIdx = filterCol ? data.headers.indexOf(filterCol) : -1;
    const filterMeta = filterCol ? colMeta[filterCol] : null;
    return data.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => {
        if (q && !row.some((cell) => cell.toLowerCase().includes(q))) return false;
        if (filterColIdx !== -1) {
          const cell = row[filterColIdx];
          if (filterMeta?.type === 'number') {
            const n = Number(cell);
            if (cell === '' || Number.isNaN(n)) return false;
            if (filterMin !== '' && n < Number(filterMin)) return false;
            if (filterMax !== '' && n > Number(filterMax)) return false;
          } else if (filterText && !cell.toLowerCase().includes(filterText.toLowerCase())) {
            return false;
          }
        }
        return true;
      });
  }, [data, search, filterCol, filterMin, filterMax, filterText, colMeta]);

  // Index des colonnes visibles (masquage via le selecteur de colonnes).
  const visibleCols = useMemo(() => {
    if (!data) return [];
    return data.headers.map((_, j) => j).filter((j) => !hiddenCols.has(data.headers[j]));
  }, [data, hiddenCols]);

  // Comparateur : charge vanilla/BK/BT pour la table courante, seulement si le mode est actif.
  // Cache par table (donnees de reference statiques pour la session) + garde de fraicheur
  // (une reponse tardive pour une table qu'on a deja quittee ne doit pas ecraser compareData).
  const compareCacheRef = useRef({});
  useEffect(() => {
    if (mode !== 'compare' || !table) return;
    const cached = compareCacheRef.current[table];
    if (cached) { setCompareData(cached); return; }
    setCompareData(null);
    fetch(`/api/compare/${table}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.name !== table) return;
        compareCacheRef.current[table] = d;
        setCompareData(d);
      })
      .catch(() => setCompareData({ name: table, vanilla: null, BK: null, BT: null }));
  }, [mode, table]);

  // Index nom-de-colonne -> position, par source de reference (une table peut avoir des
  // colonnes en plus/en moins que TCP — ex. armor.txt chez BK).
  const refIdx = useMemo(() => {
    const build = (src) => {
      const map = {};
      (src?.headers || []).forEach((h, idx) => { map[h] = idx; });
      return map;
    };
    return { vanilla: build(compareData?.vanilla), BK: build(compareData?.BK), BT: build(compareData?.BT) };
  }, [compareData]);

  function refValue(src, colName, rowIdx) {
    const refTable = compareData?.[src];
    if (!refTable) return null;
    const idx = refIdx[src][colName];
    if (idx === undefined) return null;
    const row = refTable.rows[rowIdx];
    return row ? row[idx] : null;
  }

  function applyPreset(name) {
    setSelectedPreset(name);
    if (!name) return;
    const preset = presets.find((p) => p.name === name);
    if (preset && Array.isArray(preset.hidden)) setHiddenCols(new Set(preset.hidden));
  }

  function saveCurrentPreset() {
    const name = window.prompt('Nom de la vue à sauvegarder :');
    if (!name) return;
    const next = [...presets.filter((p) => p.name !== name), { name, hidden: [...hiddenCols] }];
    setPresets(next);
    savePresetsToStorage(table, next);
    setSelectedPreset(name);
  }

  function deleteSelectedPreset() {
    if (!selectedPreset) return;
    const next = presets.filter((p) => p.name !== selectedPreset);
    setPresets(next);
    savePresetsToStorage(table, next);
    setSelectedPreset('');
  }

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

  const pageCount = data ? Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE)) : 1;
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * PAGE_SIZE;
  const pageRows = filteredRows.slice(start, start + PAGE_SIZE);

  return (
    <div className="app">
      {!auth.authConfigured && <div className="banniere">⚠ Mode ouvert (local) — aucune authentification.</div>}
      <header>
        <h1>Éditeur de tables <small>· mod TCP</small> <a className="roadmap-lien" href="/roadmap">📋 ROADMAP</a></h1>
        <div className="breadcrumb">
          <span>Accueil</span>
          <span className="sep">›</span>
          <span>{CATEGORY_LABELS[data?.schema?.category] || '…'}</span>
          <span className="sep">›</span>
          <span className="current">{table}.txt</span>
        </div>
        <div className="bar">
          <select value={table} onChange={(e) => changeTable(e.target.value)}>
            {tables.length === 0 && <option value={table}>{table}</option>}
            {CATEGORY_ORDER.map((cat) => {
              const group = tables.filter((t) => t.category === cat);
              if (!group.length) return null;
              return (
                <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                  {group.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </optgroup>
              );
            })}
          </select>
          <button onClick={save} disabled={!dirty || !data}>Sauvegarder</button>
          {data && (
            <span className="pager">
              <button onClick={() => setPage(Math.max(0, clampedPage - 1))} disabled={clampedPage === 0}>‹</button>
              <span>
                page {clampedPage + 1} / {pageCount} · lignes {filteredRows.length === 0 ? 0 : start + 1}–{Math.min(start + PAGE_SIZE, filteredRows.length)}
                {filteredRows.length !== data.rows.length ? ` sur ${filteredRows.length} (${data.rows.length} au total)` : ''}
              </span>
              <button onClick={() => setPage(Math.min(pageCount - 1, clampedPage + 1))} disabled={clampedPage >= pageCount - 1}>›</button>
            </span>
          )}
          <span className="status">{status}</span>
          <div className="toggle-vue">
            <button className={mode === 'compare' ? 'actif' : ''} onClick={() => setMode('compare')}>Comparateur</button>
            <button className={mode === 'editor' ? 'actif' : ''} onClick={() => setMode('editor')}>Éditeur</button>
          </div>
          {auth.authenticated && auth.user?.email !== 'local' && (
            <span className="compte">{auth.user?.email} · <a onClick={onLogout}>déconnexion</a></span>
          )}
        </div>
        {data && (
          <div className="toolbar">
            <input type="text" className="recherche" placeholder="Rechercher dans les lignes…"
                   value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            <select value={filterCol} onChange={(e) => { setFilterCol(e.target.value); setFilterMin(''); setFilterMax(''); setFilterText(''); setPage(0); }}>
              <option value="">Filtrer une colonne…</option>
              {data.headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            {filterCol && (colMeta[filterCol]?.type === 'number' ? (
              <span className="filtre-plage">
                <input type="text" inputMode="numeric" className="filtre-num" placeholder="min" value={filterMin}
                       onChange={(e) => { setFilterMin(e.target.value); setPage(0); }} />
                <span>–</span>
                <input type="text" inputMode="numeric" className="filtre-num" placeholder="max" value={filterMax}
                       onChange={(e) => { setFilterMax(e.target.value); setPage(0); }} />
              </span>
            ) : (
              <input type="text" className="filtre-texte" placeholder="valeur…" value={filterText}
                     onChange={(e) => { setFilterText(e.target.value); setPage(0); }} />
            ))}
            {filterCol && (
              <button className="filtre-clear"
                      onClick={() => { setFilterCol(''); setFilterMin(''); setFilterMax(''); setFilterText(''); setPage(0); }}>×</button>
            )}
            <div className="cols-picker">
              <button onClick={() => setColsOpen((v) => !v)}>Colonnes ({visibleCols.length}/{data.headers.length})</button>
              {colsOpen && (
                <div className="cols-panel">
                  <input type="text" className="cols-recherche" placeholder="Chercher une colonne…"
                         value={colsSearch} onChange={(e) => setColsSearch(e.target.value)} />
                  <div className="cols-actions">
                    <button onClick={() => setHiddenCols(new Set())}>Tout afficher</button>
                    <button onClick={() => setHiddenCols(new Set(data.headers))}>Tout désélectionner</button>
                  </div>
                  <div className="cols-presets">
                    <select value={selectedPreset} onChange={(e) => applyPreset(e.target.value)}>
                      <option value="">Vues sauvegardées…</option>
                      {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                    <button className="preset-save" onClick={saveCurrentPreset} title="Sauvegarder la vue actuelle">+</button>
                    <button className="preset-del" onClick={deleteSelectedPreset} disabled={!selectedPreset} title="Supprimer la vue sélectionnée">×</button>
                  </div>
                  {data.headers.filter((h) => h.toLowerCase().includes(colsSearch.toLowerCase())).map((h) => (
                    <label key={h} className="cols-item">
                      <input type="checkbox" checked={!hiddenCols.has(h)}
                             onChange={() => setHiddenCols((prev) => {
                               const next = new Set(prev);
                               if (next.has(h)) next.delete(h); else next.add(h);
                               return next;
                             })} />
                      {h}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {data?.schema && <p className="desc">{data.schema.description} <em>· clique une cellule pour l'éditer</em></p>}
      </header>

      {data && mode === 'editor' && (
        <div className="grid">
          <table>
            <thead>
              <tr>
                <th className="rownum">#</th>
                {visibleCols.map((j, idx) => {
                  const h = data.headers[j];
                  const meta = colMeta[h];
                  const cls = (meta?.comment ? 'comment' : meta?.type === 'number' ? 'num' : 'text') + (idx === 0 ? ' cle-col' : '');
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
              {pageRows.length === 0 && (
                <tr><td className="vide" colSpan={visibleCols.length + 1}>Aucune ligne ne correspond à la recherche/au filtre.</td></tr>
              )}
              {pageRows.map(({ row, i }) => (
                <tr key={i}>
                  <td className="rownum">{i + 1}</td>
                  {visibleCols.map((j, idx) => {
                    const cell = row[j];
                    const meta = colMeta[data.headers[j]];
                    const isNum = meta?.type === 'number';
                    const isEditing = editing && editing.row === i && editing.col === j;
                    const err = cellError(meta, cell);
                    const cls = (isNum ? 'num ' : '') + (err ? 'err ' : '') + (idx === 0 ? 'cle-col' : '');
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && mode === 'compare' && !compareData && (
        <p className="chargement-compare">Chargement des sources de référence…</p>
      )}

      {data && mode === 'compare' && compareData && (
        <div className="grid">
          <table>
            <thead>
              <tr>
                <th className="rownum" rowSpan={2}>#</th>
                {visibleCols.map((j) => (
                  <th key={j} className="grp" colSpan={4}>{data.headers[j]}</th>
                ))}
              </tr>
              <tr>
                {visibleCols.map((j) => (
                  <Fragment key={j}>
                    <th className="sub">vanilla</th>
                    <th className="sub">BK</th>
                    <th className="sub">BT</th>
                    <th className="sub tcp">TCP</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td className="vide" colSpan={visibleCols.length * 4 + 1}>Aucune ligne ne correspond à la recherche/au filtre.</td></tr>
              )}
              {pageRows.map(({ row, i }) => (
                <tr key={i}>
                  <td className="rownum">{i + 1}</td>
                  {visibleCols.map((j) => {
                    const h = data.headers[j];
                    const cell = row[j];
                    const meta = colMeta[h];
                    const isNum = meta?.type === 'number';
                    const isEditing = editing && editing.row === i && editing.col === j;
                    const err = cellError(meta, cell);
                    const tcpCls = 'tcp-cell' + (isNum ? ' num' : '') + (err ? ' err' : '');
                    return (
                      <Fragment key={j}>
                        <td className={'ref-cell' + (isNum ? ' num' : '')}>{refValue('vanilla', h, i) ?? '—'}</td>
                        <td className={'ref-cell' + (isNum ? ' num' : '')}>{refValue('BK', h, i) ?? '—'}</td>
                        <td className={'ref-cell' + (isNum ? ' num' : '')}>{refValue('BT', h, i) ?? '—'}</td>
                        <td className={tcpCls}
                            title={err ? `⚠ ${h} : ${err}` : undefined}
                            onClick={() => setEditing({ row: i, col: j })}>
                          {isEditing ? (
                            <input autoFocus defaultValue={cell} inputMode={isNum ? 'numeric' : 'text'}
                                   onBlur={(e) => { commit(i, j, e.target.value); setEditing(null); }}
                                   onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }} />
                          ) : (
                            <span className="cell">{cell === '' ? ' ' : cell}</span>
                          )}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
