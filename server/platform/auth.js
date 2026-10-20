// Password hashing (scrypt) and signed-cookie sessions. No external dependencies.
import crypto from 'node:crypto';

const COOKIE = 'lv_session';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
export const sessionSecretIsEphemeral = !process.env.SESSION_SECRET;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const [, salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(got, expected);
}

const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function issueSession(req, res, userId, days) {
  const maxAge = days * 864e5;
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + maxAge })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge, path: '/' });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Returns { u: userId } for a valid, unexpired session cookie, else null. */
export function readSession(req) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.e > Date.now() ? data : null;
  } catch {
    return null;
  }
}
