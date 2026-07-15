// Netlify Function — API de l'editeur, auto-routee sur /api/*.
// Persistance : le repo GitHub (lecture via l'API contents, ecriture via commit).
// Auth : ajoutee a l'increment I3b (cookie signe + allowlist courriel).
//
//   GET  /api/tables         -> { tables }
//   GET  /api/table/:name    -> { name, schema, headers, rows, eol, hasFinalEol, sha }
//   PUT  /api/table/:name    -> commit le .txt ; { ok, name, commit }

import { parseTsv, serializeTsv } from './_shared/tsv.mjs';
import { listTables, readFile, writeFile, paths, hasToken } from './_shared/github.mjs';
import { readUser, isAllowed, makeSessionCookie, clearCookie, authConfigured } from './_shared/auth.mjs';

export const config = { path: '/api/*' };

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Auth ---
    if (path === '/api/me' && request.method === 'GET') {
      const user = readUser(request);
      return json({ authenticated: Boolean(user), user, authConfigured: authConfigured() });
    }
    if (path === '/api/login' && request.method === 'POST') {
      if (!authConfigured()) return json({ error: 'auth non configuree (SESSION_SECRET manquant)' }, 503);
      const { email } = await request.json().catch(() => ({}));
      if (!isAllowed(email)) return json({ error: 'courriel non autorise' }, 403);
      return json({ ok: true, user: { email } }, 200, { 'Set-Cookie': makeSessionCookie(email, request) });
    }
    if (path === '/api/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(request) });
    }

    // --- Garde : les routes de donnees exigent un utilisateur.
    //     En dev local sans SESSION_SECRET, l'acces reste ouvert. ---
    if (authConfigured() && !readUser(request)) {
      return json({ error: 'auth_required' }, 401);
    }

    // --- Donnees ---
    if (path === '/api/tables' && request.method === 'GET') {
      return json({ tables: await listTables() });
    }

    const m = path.match(/^\/api\/table\/([^/]+)$/);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (!NAME_RE.test(name)) return json({ error: 'nom de table invalide' }, 400);

      if (request.method === 'GET') {
        const file = await readFile(paths.table(name), 'latin1');
        if (!file) return json({ error: 'table introuvable: ' + name }, 404);
        const table = parseTsv(file.content);
        let schema = null;
        const sf = await readFile(paths.schema(name), 'utf8');
        if (sf) { try { schema = JSON.parse(sf.content); } catch { /* schema illisible : ignore */ } }
        return json({ name, schema, sha: file.sha, ...table });
      }

      if (request.method === 'PUT') {
        if (!hasToken()) return json({ error: 'ecriture indisponible : GITHUB_TOKEN non configure' }, 503);
        const incoming = await request.json();
        const current = await readFile(paths.table(name), 'latin1');
        if (!current) return json({ error: 'table introuvable: ' + name }, 404);
        const cur = parseTsv(current.content);
        const out = serializeTsv({
          headers: incoming.headers || cur.headers,
          rows: incoming.rows || cur.rows,
          eol: cur.eol,
          hasFinalEol: cur.hasFinalEol,
        });
        const commit = await writeFile(paths.table(name), out, current.sha, `edit ${name}.txt via admin`);
        return json({ ok: true, name, commit: commit.commit?.sha || null });
      }
    }

    return json({ error: 'route inconnue' }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
};
