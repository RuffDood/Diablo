import { useMemo, useRef, useState } from 'react';
import catalog from './data/bkvince-catalog.json';
import { resolveUniqueProperties, searchCatalog } from './lib/catalog.js';
import { inspectD2s } from './lib/d2s.js';
import { analyzeUniqueSerialization, createUniqueItemRecord } from './lib/item-writer.js';
import { readUniqueMiscItemRecord } from './lib/item-reader.js';
import { insertItemRecord } from './lib/save-editor.js';

const CATEGORIES = [
  { id: 'unique', label: 'Uniques', count: catalog.uniqueItems.length },
  { id: 'base', label: 'Bases', count: catalog.baseItems.length },
  { id: 'set', label: 'Sets', count: catalog.setItems.length },
  { id: 'gem', label: 'Gems', count: catalog.gems.length },
  { id: 'skill', label: 'Skills', count: catalog.skills.length },
];

function hex(value) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(8, '0')}`;
}

function ResultIcon({ kind }) {
  const glyphs = { unique: '✦', base: '◆', set: '✣', gem: '⬟', skill: '◈' };
  return <span className={`result-icon ${kind}`}>{glyphs[kind] || '◆'}</span>;
}

function CatalogResult({ entry, category, active, onSelect }) {
  const subtitle = category === 'skill'
    ? `${entry.classCode || 'universal'} · ID ${entry.id}`
    : `${entry.baseCode || entry.code || entry.set || entry.kind || 'BKVince'}${entry.requiredLevel !== null && entry.requiredLevel !== undefined ? ` · lvl ${entry.requiredLevel}` : ''}`;

  return (
    <button className={`result-card${active ? ' active' : ''}`} type="button" onClick={() => onSelect(entry)}>
      <ResultIcon kind={category} />
      <span className="result-copy">
        <strong>{entry.name}</strong>
        <small>{subtitle}</small>
      </span>
      <span className="result-arrow">›</span>
    </button>
  );
}

function EncodingBadge({ encoding }) {
  if (!encoding) return <span className="encoding missing">stat non résolue</span>;
  if (encoding.saveBits === null) return <span className="encoding missing">non sauvegardée</span>;
  return (
    <span className="encoding">
      {encoding.name} · {encoding.saveBits} bits · add {encoding.saveAdd || 0}
      {encoding.saveParamBits ? ` · param ${encoding.saveParamBits}` : ''}
    </span>
  );
}

function UniqueDetails({ entry }) {
  const properties = useMemo(() => resolveUniqueProperties(catalog, entry), [entry]);
  return (
    <>
      <div className="item-title unique-title">
        <span>Unique</span>
        <h3>{entry.name}</h3>
        <p>{entry.baseCode} · ilvl {entry.level ?? '—'} · requis {entry.requiredLevel ?? '—'}</p>
      </div>
      <div className="property-list">
        {properties.map((property) => (
          <div className="property" key={`${property.slot}-${property.code}`}>
            <div>
              <strong>{property.code}</strong>
              <span>{property.min ?? '—'}{property.max !== property.min ? ` – ${property.max ?? '—'}` : ''}</span>
            </div>
            {property.encodings.length === 0
              ? <span className="encoding missing">fonction à résoudre</span>
              : property.encodings.map((item) => <EncodingBadge key={`${item.slot}-${item.stat}`} encoding={item.encoding} />)}
          </div>
        ))}
      </div>
    </>
  );
}

function GenericDetails({ entry, category }) {
  return (
    <>
      <div className={`item-title ${category}-title`}>
        <span>{CATEGORIES.find((item) => item.id === category)?.label}</span>
        <h3>{entry.name}</h3>
        <p>{entry.code || entry.baseCode || entry.descriptionKey || entry.kind || 'BKVince'}</p>
      </div>
      <dl className="detail-grid">
        {'id' in entry && <><dt>ID</dt><dd>{entry.id}</dd></>}
        {entry.type && <><dt>Type</dt><dd>{entry.type}{entry.type2 ? ` / ${entry.type2}` : ''}</dd></>}
        {entry.width && <><dt>Dimensions</dt><dd>{entry.width} × {entry.height}</dd></>}
        {entry.maxLevel && <><dt>Niveau max</dt><dd>{entry.maxLevel}</dd></>}
        {entry.stackable && <><dt>Stack</dt><dd>{entry.minStack ?? 0} – {entry.maxStack ?? '∞'}</dd></>}
        {entry.set && <><dt>Set</dt><dd>{entry.set}</dd></>}
      </dl>
    </>
  );
}

function CharacterReport({ file, report }) {
  if (!report) return null;
  if (!report.ok) {
    return (
      <section className="character-report invalid">
        <span className="report-kicker">Import refusé</span>
        <h2>{file?.name}</h2>
        <p>{report.error.message}</p>
        <code>{report.error.code}{report.error.offset !== null ? ` @ ${report.error.offset}` : ''}</code>
      </section>
    );
  }

  return (
    <section className="character-report valid">
      <div className="character-heading">
        <div className="portrait-rune">{report.character.className.slice(0, 1)}</div>
        <div>
          <span className="report-kicker">Personnage chargé</span>
          <h2>{report.character.name || file?.name.replace(/\.d2s$/i, '')}</h2>
          <p>{report.character.className} · niveau {report.character.level} · {report.character.gameVersion}</p>
        </div>
        <span className="valid-seal">✓ D2S valide</span>
      </div>
      <div className="report-stats">
        <div><strong>{report.items.count}</strong><span>items</span></div>
        <div><strong>{report.character.skillCount}</strong><span>skills</span></div>
        <div><strong>{report.playerStats.ids.length}</strong><span>stats joueur</span></div>
        <div><strong>{report.byteLength}</strong><span>octets</span></div>
      </div>
      <div className="integrity-line">
        <span>Version {report.version}</span>
        <span>Checksum {hex(report.checksum)}</span>
        <span>{report.items.corpseOffset === null ? 'Frontière items à prouver' : `Cadavres @ ${report.items.corpseOffset}`}</span>
      </div>
      {report.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
    </section>
  );
}

export default function App() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [sourceBytes, setSourceBytes] = useState(null);
  const [report, setReport] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [category, setCategory] = useState('unique');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => catalog.uniqueItems.find((item) => item.name === 'Annihilus') || null);
  const [roll, setRoll] = useState('max');
  const [position, setPosition] = useState({ x: 10, y: 7 });
  const [forgeStatus, setForgeStatus] = useState(null);

  const results = useMemo(() => searchCatalog(catalog, query, category), [query, category]);
  const serialization = useMemo(
    () => (category === 'unique' && selected ? analyzeUniqueSerialization(catalog, selected) : null),
    [category, selected],
  );
  const canForge = Boolean(
    report?.ok
    && sourceBytes
    && report.items.corpseOffset !== null
    && serialization?.supported,
  );

  async function loadFile(nextFile) {
    if (!nextFile) return;
    setFile(nextFile);
    const bytes = new Uint8Array(await nextFile.arrayBuffer());
    setSourceBytes(bytes);
    setReport(inspectD2s(bytes, catalog));
    setForgeStatus(null);
  }

  function acceptDrop(event) {
    event.preventDefault();
    setDragging(false);
    loadFile(event.dataTransfer.files?.[0]);
  }

  function switchCategory(nextCategory) {
    setCategory(nextCategory);
    setQuery('');
    setSelected(null);
    setForgeStatus(null);
  }

  function updatePosition(axis, rawValue) {
    const value = Number.parseInt(rawValue, 10);
    setPosition((current) => ({ ...current, [axis]: Number.isNaN(value) ? 0 : value }));
    setForgeStatus(null);
  }

  function forgeAndDownload() {
    if (!canForge) return;
    try {
      const generated = createUniqueItemRecord(catalog, selected, {
        roll,
        x: position.x,
        y: position.y,
      });
      const decoded = readUniqueMiscItemRecord(generated.bytes, catalog);
      const result = insertItemRecord(sourceBytes, generated.bytes, catalog);
      const filename = `${file.name.replace(/\.d2s$/i, '')}-BKVince.d2s`;
      const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/octet-stream' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setForgeStatus({
        ok: true,
        filename,
        insertedBytes: result.insertedBytes,
        itemCount: result.after.items.count,
        stats: decoded.stats.length,
      });
    } catch (error) {
      setForgeStatus({ ok: false, message: error.message });
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="BKVince Mod Hero Editor">
          <span className="brand-mark">B</span>
          <span><strong>BKVince</strong><small>Mod Hero Editor</small></span>
        </a>
        <nav>
          <a className="active" href="#forge">Hero Forge</a>
          <a href="#catalogue">Catalogue</a>
          <a href="/roadmap">ROADMAP</a>
        </nav>
        <span className="profile-pill"><i /> TXT BKVince 3.2</span>
      </header>

      <main>
        <section className="hero" id="forge">
          <div>
            <span className="eyebrow">Forge locale · version 105</span>
            <h1>Façonne ton héros.<br /><em>Sans trahir le mod.</em></h1>
            <p>Items, skills et encodages proviennent directement des tables BKVince. Ta sauvegarde reste dans ton navigateur.</p>
          </div>
          <div
            className={`drop-zone${dragging ? ' dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={acceptDrop}
          >
            <input ref={inputRef} type="file" accept=".d2s" onChange={(event) => loadFile(event.target.files?.[0])} />
            <span className="drop-glyph">⌁</span>
            <strong>Dépose un personnage `.d2s`</strong>
            <small>ou choisis une sauvegarde locale</small>
            <button type="button" onClick={() => inputRef.current?.click()}>Charger un personnage</button>
            <span className="privacy">Aucun fichier envoyé · traitement 100 % local</span>
          </div>
        </section>

        <CharacterReport file={file} report={report} />

        <section className="workspace" id="catalogue">
          <div className="catalog-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Catalogue généré</span>
                <h2>Choisir dans BKVince</h2>
              </div>
              <span>{results.length}{results.length === 60 ? '+' : ''} résultats</span>
            </div>

            <div className="category-tabs">
              {CATEGORIES.map((item) => (
                <button
                  type="button"
                  className={category === item.id ? 'active' : ''}
                  key={item.id}
                  onClick={() => switchCategory(item.id)}
                >
                  {item.label}<span>{item.count}</span>
                </button>
              ))}
            </div>

            <label className="search-box">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Rechercher dans ${CATEGORIES.find((item) => item.id === category)?.label.toLowerCase()}…`} />
              {query && <button type="button" onClick={() => setQuery('')}>×</button>}
            </label>

            <div className="results">
              {results.map((entry) => (
                <CatalogResult
                  key={`${category}-${entry.id}-${entry.name}`}
                  entry={entry}
                  category={category}
                  active={selected === entry}
                  onSelect={setSelected}
                />
              ))}
              {results.length === 0 && <p className="empty">Aucun résultat dans les TXT BKVince.</p>}
            </div>
          </div>

          <aside className="forge-panel">
            <div className="forge-panel-head">
              <span>Prévisualisation mod-aware</span>
              <b>TXT LIVE</b>
            </div>
            {selected ? (
              <>
                {category === 'unique'
                  ? <UniqueDetails entry={selected} />
                  : <GenericDetails entry={selected} category={category} />}
                <div className="forge-action">
                  {category === 'unique' && (
                    <div className="forge-options">
                      <label>
                        Rolls
                        <select value={roll} onChange={(event) => { setRoll(event.target.value); setForgeStatus(null); }}>
                          <option value="max">Maximum</option>
                          <option value="random">Aléatoires</option>
                          <option value="min">Minimum</option>
                        </select>
                      </label>
                      <label>
                        Case X
                        <input type="number" min="0" max="15" value={position.x} onChange={(event) => updatePosition('x', event.target.value)} />
                      </label>
                      <label>
                        Case Y
                        <input type="number" min="0" max="15" value={position.y} onChange={(event) => updatePosition('y', event.target.value)} />
                      </label>
                    </div>
                  )}
                  <button type="button" disabled={!canForge} onClick={forgeAndDownload}>Forger et télécharger une copie</button>
                  {serialization && !serialization.supported && (
                    <p className="forge-error">{serialization.reasons.join(' ')}</p>
                  )}
                  {!report?.ok && <p>Charge d’abord un personnage D2S valide.</p>}
                  {report?.ok && report.items.corpseOffset === null && <p className="forge-error">Ajout bloqué : frontière items/cadavres non prouvée.</p>}
                  {canForge && !forgeStatus && <p>La source n’est jamais écrasée. Case proposée : inventaire {position.x},{position.y}; vérifie qu’elle est libre.</p>}
                  {forgeStatus?.ok && <p className="forge-success">✓ {forgeStatus.filename} · {forgeStatus.insertedBytes} octets · {forgeStatus.stats} stats · {forgeStatus.itemCount} items</p>}
                  {forgeStatus && !forgeStatus.ok && <p className="forge-error">{forgeStatus.message}</p>}
                </div>
              </>
            ) : (
              <div className="selection-empty"><span>✦</span><p>Sélectionne un élément du catalogue.</p></div>
            )}
          </aside>
        </section>

        <section className="source-strip">
          <div><strong>{catalog.baseItems.length}</strong><span>bases</span></div>
          <div><strong>{catalog.uniqueItems.length}</strong><span>uniques</span></div>
          <div><strong>{catalog.setItems.length}</strong><span>set items</span></div>
          <div><strong>{catalog.skills.length}</strong><span>skills</span></div>
          <div><strong>{catalog.itemStats.length}</strong><span>stats encodées</span></div>
          <p>Source : <code>{catalog.profile.sourceRoot}</code></p>
        </section>
      </main>

      <footer>
        <span>BKVince Mod Hero Editor · fondation MVP</span>
        <span>Lecture locale · aucun backend · aucun upload</span>
      </footer>
    </div>
  );
}
