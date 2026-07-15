// Client GitHub minimal : lit / ecrit les fichiers du repo via l'API "contents".
// La lecture d'un repo public ne demande pas de token (rate limit plus bas) ;
// l'ecriture (commit) exige GITHUB_DIABLO_TOKEN (fine-grained, droit contents:write).
//
// Encodage : les tables .txt D2R sont traitees en 'latin1' (byte-exact) ;
// les schemas .json en 'utf8'.

const OWNER = process.env.GITHUB_OWNER || 'RuffDood';
const REPO = process.env.GITHUB_REPO || 'Diablo';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_DIABLO_TOKEN || '';
const API = 'https://api.github.com';
const EXCEL_DIR = 'data-TCP/global/excel';

function ghHeaders(extra = {}) {
  const h = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'diablo-admin',
    ...extra,
  };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

export const paths = {
  table: (name) => `${EXCEL_DIR}/${name}.txt`,
  schema: (name) => `schemas/${name}.json`,
  // Sources de reference pour le Comparateur (lecture seule, jamais ecrites).
  vanilla: (name) => `excel-vanilla/${name}.txt`,
  BK: (name) => `data-BK/global/excel/${name}.txt`,
  BT: (name) => `data-BT/global/excel/${name}.txt`,
};

export function hasToken() {
  return Boolean(TOKEN);
}

export async function listTables() {
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${EXCEL_DIR}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub list ${res.status}`);
  const items = await res.json();
  const names = items
    .filter((i) => i.type === 'file' && i.name.endsWith('.txt'))
    .map((i) => i.name.slice(0, -4))
    .sort();

  // Un seul appel API supplementaire pour toutes les categories (plutot que 40 lectures de schema).
  let categories = {};
  const cf = await readFile('schemas/_categories.json', 'utf8');
  if (cf) { try { categories = JSON.parse(cf.content); } catch { /* manifest illisible : ignore */ } }

  return names.map((name) => ({ name, category: categories[name] || 'other' }));
}

export async function readFile(path, encoding = 'latin1') {
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read ${res.status} (${path})`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString(encoding);
  return { content, sha: data.sha };
}

export async function writeFile(path, content, sha, message, encoding = 'latin1') {
  if (!TOKEN) throw new Error('GITHUB_DIABLO_TOKEN absent : ecriture impossible (lecture seule)');
  const body = {
    message,
    content: Buffer.from(content, encoding).toString('base64'),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: ghHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub write ${res.status} (${path}): ${await res.text()}`);
  return res.json();
}
