import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import request from 'supertest';
import { buildServer } from '../server/index';
import { readConfig } from '../server/config';
import { hashPassword } from '../server/lib/auth';
import type { Services } from '../server/services';

process.env.LOG_QUIET = '1';

export const TEST_PASSWORD = 'senha-de-teste-123';
const PASSWORD_HASH = hashPassword(TEST_PASSWORD);

export function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mural-test-'));
}

export async function startTestServer(dataDir = tmpDataDir()) {
  const config = readConfig({
    dataDir,
    port: 0,
    dev: false,
    adminPasswordHash: PASSWORD_HASH,
    sessionSecret: 'x'.repeat(48),
    publicBaseUrl: '',
    trustProxy: false,
    allowedOrigins: [],
  });
  const built = await buildServer(config, { withNext: false });
  await new Promise<void>((r) => built.server.listen(0, '127.0.0.1', () => r()));
  const port = (built.server.address() as AddressInfo).port;
  // Em testes, limites de taxa folgados (exceto quando o teste altera explicitamente).
  await built.svc.settings.update({ uploadRateLimitPerIp: 1000 });
  return { ...built, dataDir, port, baseUrl: `http://127.0.0.1:${port}` };
}

export type TestServer = Awaited<ReturnType<typeof startTestServer>>;

/** Faz login e devolve um agente com cookie de sessão + token CSRF. */
export async function adminAgent(server: TestServer['server']) {
  const agent = request.agent(server);
  const res = await agent.post('/api/admin/login').send({ password: TEST_PASSWORD }).expect(200);
  const csrf = res.body.csrfToken as string;
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('mf_admin='))!.split(';')[0];
  return { agent, csrf, cookie };
}

export async function makeJpeg(width = 1200, height = 800, color = { r: 200, g: 50, b: 80 }, withExif = false) {
  let img = sharp({ create: { width, height, channels: 3, background: color } }).jpeg({ quality: 80 });
  if (withExif) img = img.withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'teste', Artist: 'Fulano' } } });
  return img.toBuffer();
}

export async function makePng(width = 600, height = 900) {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();
}

/** Cria e inicia um evento diretamente pelo store. */
export async function activeEvent(svc: Services, name = 'Evento de teste') {
  const ev = await svc.store.createEvent({ name });
  await svc.store.startEvent(ev.id, { finishCurrent: true });
  return ev;
}

export function setFastPlayback(svc: Services, displaySeconds = 0.15, transitionMs = 0) {
  // Os limites da interface (mín. 2 s) são contornados apenas nos testes para acelerar a execução.
  const s = svc.settings as unknown as { data: { settings: { displaySeconds: number; transitionMs: number } } };
  s.data.settings.displaySeconds = displaySeconds;
  s.data.settings.transitionMs = transitionMs;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn: () => boolean, timeout = 5000, step = 20) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('Tempo esgotado aguardando condição');
    await sleep(step);
  }
}
