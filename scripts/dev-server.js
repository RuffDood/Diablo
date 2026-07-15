'use strict';
// Serveur de developpement LOCAL : lit/ecrit les tables .txt du mod TCP.
//
//   GET  /api/table/:name  -> { name, schema, headers, rows, eol, hasFinalEol }
//   PUT  /api/table/:name  -> reecrit le .txt (round-trip byte-exact hors valeurs editees)
//
// Aucune base de donnees : les .txt sont la source de verite. En production
// (Netlify), l'ecriture passera par des commits via l'API GitHub (voir plan I3).

const http = require('http');
const path = require('path');
const fs = require('fs');
const { parseTable, writeTable } = require('./build-data/tsv');

const PORT = process.env.DEV_SERVER_PORT || 4000;
const EXCEL_DIR = path.join(__dirname, '..', 'data-TCP', 'global', 'excel');
const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

// Sources de reference pour le Comparateur (lecture seule, jamais ecrites).
const REF_DIRS = {
  vanilla: path.join(__dirname, '..', 'excel-vanilla'),
  BK: path.join(__dirname, '..', 'data-BK', 'global', 'excel'),
  BT: path.join(__dirname, '..', 'data-BT', 'global', 'excel'),
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function tablePath(name) {
  // garde-fou : nom de table simple, pas de traversee de chemin
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return null;
  return path.join(EXCEL_DIR, name + '.txt');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // auth : en dev local, aucune authentification (edition directe du FS)
  if (url.pathname === '/api/me' && req.method === 'GET') {
    return send(res, 200, { authenticated: true, user: { email: 'local' }, authConfigured: false, mode: 'local' });
  }

  // tableau de bord ROADMAP (servi tel quel, toujours a jour)
  if (url.pathname === '/roadmap' && req.method === 'GET') {
    const p = path.join(__dirname, '..', 'ROADMAP.html');
    if (fs.existsSync(p)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(p));
    }
    res.writeHead(404);
    return res.end('ROADMAP.html introuvable');
  }

  // liste des tables editables (les .txt de global/excel), avec leur categorie de nav
  if (url.pathname === '/api/tables' && req.method === 'GET') {
    const tables = fs.readdirSync(EXCEL_DIR)
      .filter((f) => f.endsWith('.txt'))
      .map((f) => f.slice(0, -4))
      .sort()
      .map((name) => {
        const schemaFile = path.join(SCHEMAS_DIR, name + '.json');
        let category = 'other';
        if (fs.existsSync(schemaFile)) {
          try { category = JSON.parse(fs.readFileSync(schemaFile, 'utf8')).category || 'other'; } catch { /* schema illisible */ }
        }
        return { name, category };
      });
    return send(res, 200, { tables });
  }

  // Comparateur : lit la meme table dans vanilla/BK/BT (lecture seule).
  const cmpMatch = url.pathname.match(/^\/api\/compare\/([^/]+)$/);
  if (cmpMatch && req.method === 'GET') {
    const name = decodeURIComponent(cmpMatch[1]);
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return send(res, 400, { error: 'nom de table invalide' });
    const out = { name };
    for (const [src, dir] of Object.entries(REF_DIRS)) {
      const f = path.join(dir, name + '.txt');
      out[src] = fs.existsSync(f) ? (({ headers, rows }) => ({ headers, rows }))(parseTable(f)) : null;
    }
    return send(res, 200, out);
  }

  const match = url.pathname.match(/^\/api\/table\/([^/]+)$/);
  if (!match) return send(res, 404, { error: 'route inconnue' });

  const name = decodeURIComponent(match[1]);
  const file = tablePath(name);
  if (!file || !fs.existsSync(file)) {
    return send(res, 404, { error: 'table introuvable: ' + name });
  }

  if (req.method === 'GET') {
    const table = parseTable(file);
    let schema = null;
    const schemaFile = path.join(SCHEMAS_DIR, name + '.json');
    if (fs.existsSync(schemaFile)) schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
    return send(res, 200, { name, schema, ...table });
  }

  if (req.method === 'PUT') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(raw);
        const current = parseTable(file);
        // on ne prend que headers/rows du client ; on preserve les fins de ligne du fichier
        writeTable(file, {
          headers: incoming.headers || current.headers,
          rows: incoming.rows || current.rows,
          eol: current.eol,
          hasFinalEol: current.hasFinalEol,
        });
        send(res, 200, { ok: true, name });
      } catch (e) {
        send(res, 400, { error: String((e && e.message) || e) });
      }
    });
    return;
  }

  return send(res, 405, { error: 'methode non supportee' });
});

server.listen(PORT, () => {
  console.log('[dev-server] http://localhost:' + PORT + '  (tables: ' + EXCEL_DIR + ')');
});
