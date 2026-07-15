// Auth minimale : cookie de session signe (HMAC-SHA256) + allowlist de courriels.
// Calquee sur assurance-admin. Le login est un simple courriel autorise (MVP) ;
// a durcir en production par la protection de site Netlify (mot de passe global).
//
// Variables d'environnement :
//   SESSION_SECRET  chaine aleatoire pour signer les cookies (obligatoire en prod)
//   ALLOWED_EMAILS  liste separee par des virgules (defaut : gbarriere@spheredi.com)

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'diablo_session';
const SECRET = process.env.SESSION_SECRET || '';
const ALLOWED = (process.env.ALLOWED_EMAILS || 'gbarriere@spheredi.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const MAX_AGE_S = 30 * 24 * 60 * 60; // 30 jours

export function authConfigured() {
  return Boolean(SECRET);
}

export function isAllowed(email) {
  return ALLOWED.includes(String(email || '').trim().toLowerCase());
}

function sign(body) {
  return createHmac('sha256', SECRET).update(body).digest('base64url');
}

export function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySession(token) {
  if (!token || !SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function readUser(request) {
  const payload = verifySession(parseCookies(request)[COOKIE_NAME]);
  if (!payload || !isAllowed(payload.email)) return null;
  return { email: payload.email };
}

function secureAttr(request) {
  return new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
}

export function makeSessionCookie(email, request) {
  const clean = String(email).trim().toLowerCase();
  const token = signSession({ email: clean, exp: Date.now() + MAX_AGE_S * 1000 });
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax;${secureAttr(request)} Max-Age=${MAX_AGE_S}`;
}

export function clearCookie(request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax;${secureAttr(request)} Max-Age=0`;
}
