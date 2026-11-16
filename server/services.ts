import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AppConfig } from './config';
import { SettingsStore } from './store/settings';
import { EventStore } from './store/events';
import { PlaybackEngine } from './store/playback';
import { initLogger, log } from './lib/logger';
import { pickLocalIp } from './lib/network';

export interface Services {
  config: AppConfig;
  settings: SettingsStore;
  store: EventStore;
  engine: PlaybackEngine;
  sessionSecret: string;
  tmpDir: string;
  logoFile: string;
  runCleanup: (reason: string) => Promise<{ purged: number; files: number }>;
  qrTarget: () => { url: string; mode: 'public' | 'local'; publicUrl: string; localUrl: string };
  shutdown: () => void;
}

/** Cria (se necessário) toda a estrutura de pastas em /data. */
export async function ensureDataDirs(dataDir: string) {
  for (const sub of ['events', 'config', 'logs', 'tmp']) {
    await fsp.mkdir(path.join(dataDir, sub), { recursive: true });
  }
}

/** Segredo de sessão: usa SESSION_SECRET do .env ou gera um e guarda em data/config. */
function resolveSessionSecret(config: AppConfig): string {
  if (config.sessionSecret.length >= 32) return config.sessionSecret;
  const file = path.join(config.dataDir, 'config', 'session.secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* gera abaixo */
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export async function createServices(config: AppConfig): Promise<Services> {
  await ensureDataDirs(config.dataDir);
  initLogger(config.dataDir);

  const tmpDir = path.join(config.dataDir, 'tmp');
  // Restos de uploads interrompidos por encerramento inesperado.
  for (const f of await fsp.readdir(tmpDir)) await fsp.rm(path.join(tmpDir, f), { force: true, recursive: true });

  const settings = new SettingsStore(config.dataDir);
  await settings.init();
  const store = new EventStore(config.dataDir);
  await store.init();
  const engine = new PlaybackEngine(store, settings);
  engine.init();

  const runCleanup = async (reason: string) => {
    const s = settings.get();
    let purged = 0;
    let files = 0;
    for (const ev of store.expiredEvents(s.retentionHours)) {
      try {
        const res = await store.purgeEvent(ev.id, reason);
        purged++;
        files += res.removed;
      } catch (err) {
        log.cleanup(`Falha ao limpar evento ${ev.id}: ${String(err)}`);
      }
    }
    if (purged === 0 && reason !== 'automática') log.cleanup(`Limpeza (${reason}): nenhum evento com prazo expirado.`);
    return { purged, files };
  };

  // Limpeza automática a cada 15 minutos (e logo após iniciar).
  const cleanupTimer = setInterval(() => {
    if (settings.get().autoCleanup) runCleanup('automática').catch(() => undefined);
  }, 15 * 60_000);
  cleanupTimer.unref();
  setTimeout(() => {
    if (settings.get().autoCleanup) runCleanup('automática').catch(() => undefined);
  }, 5_000).unref();

  const qrTarget = () => {
    const s = settings.get();
    const publicUrl = s.publicBaseUrl || config.publicBaseUrl;
    const localUrl = `http://${pickLocalIp(s.preferredLocalIp)}${config.port === 80 ? '' : ':' + config.port}`;
    const mode: 'public' | 'local' = s.qrMode === 'local' ? 'local' : s.qrMode === 'public' ? (publicUrl ? 'public' : 'local') : publicUrl ? 'public' : 'local';
    return { url: (mode === 'public' ? publicUrl : localUrl) + '/', mode, publicUrl, localUrl };
  };

  return {
    config,
    settings,
    store,
    engine,
    sessionSecret: resolveSessionSecret(config),
    tmpDir,
    logoFile: path.join(config.dataDir, 'config', 'logo.png'),
    runCleanup,
    qrTarget,
    shutdown: () => {
      clearInterval(cleanupTimer);
      engine.shutdown();
    },
  };
}
