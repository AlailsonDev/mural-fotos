import path from 'node:path';
import fs from 'node:fs';
import { hashPassword } from './lib/auth';

/**
 * Senha administrativa padrão FIXA ("controladoria"), usada quando ADMIN_PASSWORD_HASH
 * não está definido. Uso temporário/evento único: definir ADMIN_PASSWORD_HASH sobrescreve.
 */
const DEFAULT_ADMIN_PASSWORD = 'controladoria';
const DEFAULT_ADMIN_PASSWORD_HASH = hashPassword(DEFAULT_ADMIN_PASSWORD);

/** Carrega o .env (se existir) sem dependências externas. */
export function loadEnv(file: string = path.resolve(process.cwd(), '.env')) {
  if (fs.existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch (err) {
      console.warn('[config] Não foi possível ler o .env:', (err as Error).message);
    }
  }
}

export interface AppConfig {
  port: number;
  host: string;
  dev: boolean;
  dataDir: string;
  publicBaseUrl: string;
  adminPasswordHash: string;
  sessionSecret: string;
  trustProxy: boolean;
  allowedOrigins: string[];
}

export function normalizeBaseUrl(value: string | undefined | null): string {
  const v = (value || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function readConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    dev: env.NODE_ENV !== 'production',
    dataDir: path.resolve(process.cwd(), env.DATA_DIR || './data'),
    publicBaseUrl: normalizeBaseUrl(env.PUBLIC_BASE_URL) || normalizeBaseUrl(env.RENDER_EXTERNAL_URL),
    adminPasswordHash: (env.ADMIN_PASSWORD_HASH || '').trim() || DEFAULT_ADMIN_PASSWORD_HASH,
    sessionSecret: (env.SESSION_SECRET || '').trim(),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => normalizeBaseUrl(s))
      .filter(Boolean),
    ...overrides,
  };
}
