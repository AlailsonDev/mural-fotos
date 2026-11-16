import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';
import crypto from 'node:crypto';
import type { Services } from '../services';
import { csrfFor, parseCookies, safeEqual, signSession, verifySession, type SessionPayload } from '../lib/auth';
import { AppError } from '../lib/errors';

export const ADMIN_COOKIE = 'mf_admin';
export const DISPLAY_COOKIE = 'mf_display';
const ADMIN_TTL = 12 * 3600_000; // 12 horas
const DISPLAY_TTL = 30 * 24 * 3600_000; // 30 dias

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

export function isHttps(req: IncomingMessage, trustProxy: boolean) {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  return trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/** Origem permitida: mesmo host da requisição, endereço público configurado ou ALLOWED_ORIGINS. */
export function isAllowedOrigin(svc: Services, origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // navegadores omitem Origin em GET de mesma origem; clientes não-navegador
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (host && o.host === host) return true;
  const allowed = [svc.settings.get().publicBaseUrl, svc.config.publicBaseUrl, ...svc.config.allowedOrigins]
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return '';
      }
    });
  return allowed.includes(o.origin);
}

export function readSession(svc: Services, req: IncomingMessage, cookie: string): SessionPayload | null {
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(svc.sessionSecret, cookies[cookie], svc.settings.internal.sessionVersion);
}

export function adminSession(svc: Services, req: IncomingMessage) {
  const s = readSession(svc, req, ADMIN_COOKIE);
  return s && s.role === 'admin' ? s : null;
}

export function displayAllowed(svc: Services, req: IncomingMessage) {
  if (adminSession(svc, req)) return true;
  const s = readSession(svc, req, DISPLAY_COOKIE);
  return !!s && s.role === 'display';
}

function cookieString(name: string, value: string, maxAgeMs: number, secure: boolean) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

export function issueSession(svc: Services, req: Request, res: Response, role: 'admin' | 'display') {
  const ttl = role === 'admin' ? ADMIN_TTL : DISPLAY_TTL;
  const payload: SessionPayload = {
    sid: crypto.randomBytes(16).toString('base64url'),
    role,
    exp: Date.now() + ttl,
    ver: svc.settings.internal.sessionVersion,
  };
  const token = signSession(svc.sessionSecret, payload);
  res.append('Set-Cookie', cookieString(role === 'admin' ? ADMIN_COOKIE : DISPLAY_COOKIE, token, ttl, isHttps(req, svc.config.trustProxy)));
  return payload;
}

export function clearCookie(res: Response, name: string) {
  res.append('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Protege rotas administrativas: sessão válida + token CSRF + origem conferida em operações de escrita. */
export function requireAdmin(svc: Services) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const session = adminSession(svc, req);
    if (!session) return next(new AppError(401, 'Sessão expirada. Faça login novamente.', 'unauthorized'));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const token = String(req.headers['x-csrf-token'] || '');
      if (!token || !safeEqual(token, csrfFor(svc.sessionSecret, session.sid))) {
        return next(new AppError(403, 'Token de segurança inválido. Recarregue a página.', 'csrf'));
      }
      if (!isAllowedOrigin(svc, req.headers.origin, req.headers.host)) {
        return next(new AppError(403, 'Origem da requisição não permitida.', 'origin'));
      }
    }
    (req as Request & { session?: SessionPayload }).session = session;
    next();
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}
