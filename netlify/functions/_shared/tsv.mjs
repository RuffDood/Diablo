// Parseur / ecrivain TSV (ESM, pour la Netlify Function).
// Meme logique que scripts/build-data/tsv.js — a garder synchrones.
// L'encodage byte-exact est gere par l'appelant (latin1 <-> base64 via le client GitHub).

export function parseTsv(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const hasFinalEol = raw.endsWith(eol);
  const body = hasFinalEol ? raw.slice(0, -eol.length) : raw;
  const lines = body.length === 0 ? [] : body.split(eol);
  const headers = lines.length ? lines[0].split('\t') : [];
  const rows = lines.slice(1).map((line) => line.split('\t'));
  return { headers, rows, eol, hasFinalEol };
}

export function serializeTsv({ headers, rows, eol, hasFinalEol }) {
  const lines = [headers.join('\t'), ...rows.map((r) => r.join('\t'))];
  let out = lines.join(eol);
  if (hasFinalEol) out += eol;
  return out;
}
