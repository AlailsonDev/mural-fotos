import crypto from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

/** Gera hash scrypt no formato  scrypt$N$r$p$salt$hash  (base64url). */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve) => {
    const parts = (stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64url');
    if (!expected.length) return resolve(false);
    crypto.scrypt(
      String(password).normalize('NFKC'),
      Buffer.from(saltB64, 'base64url'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 },
      (err, derived) => {
        if (err || derived.length !== expected.length) return resolve(false);
        resolve(crypto.timingSafeEqual(derived, expected));
      },
    );
  });
}

export interface SessionPayload {
  sid: string;
  role: 'admin' | 'display';
  exp: number;
  ver: number;
}

function hmac(secret: string, data: string) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signSession(secret: string, payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function verifySession(secret: string, token: string | undefined, currentVersion: number): SessionPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!safeEqual(sig || '', hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.sid || payload.exp < Date.now() || payload.ver !== currentVersion) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Token CSRF derivado da sessão (padrão "synchronizer token" sem armazenamento). */
export function csrfFor(secret: string, sid: string) {
  return hmac(secret, `csrf:${sid}`);
}

export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}
