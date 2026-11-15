// Senha do painel. No primeiro acesso (só pelo próprio PC) você cria a senha.
// Depois, PC ou celular, sempre pede a senha. A sessão dura 30 dias.

import crypto from 'node:crypto';

const COOKIE = 'rob7_sessao';
const SESSION_DAYS = 30;
const attempts = new Map();

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}

export function checkPassword(password, { hash, salt }) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

// Acesso pelo próprio PC (não pelo túnel da Cloudflare)?
export function isLocalRequest(req) {
  const ip = req.socket?.remoteAddress || '';
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const proxied = Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['cf-ray']);
  return loopback && !proxied;
}

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || '?');
}

export function tooManyAttempts(req) {
  const ip = clientIp(req);
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= 5;
}

export function registerFailure(req) {
  const ip = clientIp(req);
  const entry = attempts.get(ip) || { count: 0, until: Date.now() + 10 * 60_000 };
  entry.count++;
  attempts.set(ip, entry);
}

export function clearFailures(req) {
  attempts.delete(clientIp(req));
}

export function createSession(db, res, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  db.update((data) => {
    data.sessions = (data.sessions || []).filter((s) => s.exp > Date.now()).slice(-30);
    data.sessions.push({ hash: tokenHash(token), exp });
  });
  const secure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-visitor']);
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
}

export function destroySession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const hash = tokenHash(token);
    db.update((data) => { data.sessions = (data.sessions || []).filter((s) => s.hash !== hash); });
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function destroyAllSessions(db) {
  db.update((data) => { data.sessions = []; });
}

export function isAuthenticated(db, req) {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const hash = tokenHash(token);
  return (db.get().sessions || []).some((s) => s.hash === hash && s.exp > Date.now());
}
