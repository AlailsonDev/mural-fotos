import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import busboy from 'busboy';
import { pipeline } from 'node:stream/promises';
import type { Services } from '../services';
import type { PhotoRecord, PublicStatus, DisplayStatus } from '../../lib/shared/types';
import { AppError, badRequest } from '../lib/errors';
import { isUuid, newId } from '../lib/ids';
import { verifyPassword, csrfFor, safeEqual } from '../lib/auth';
import { RateLimiter } from '../lib/rateLimit';
import { getLocalAddresses } from '../lib/network';
import { readLogTail, log } from '../lib/logger';
import { processLogo, InvalidImageError } from '../lib/image';
import { createUploadHandler } from './upload';
import {
  ADMIN_COOKIE,
  DISPLAY_COOKIE,
  adminSession,
  clearCookie,
  clientIp,
  displayAllowed,
  isAllowedOrigin,
  issueSession,
  requireAdmin,
  securityHeaders,
} from './security';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;
const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export interface AppHooks {
  notifySocket: (socketId: string, event: string, payload: unknown) => void;
}

export function publicStatus(svc: Services): PublicStatus {
  const s = svc.settings.get();
  const ev = svc.store.getCurrentEvent();
  return {
    systemName: s.branding.systemName,
    branding: s.branding,
    event: ev ? { name: ev.name, description: ev.description } : null,
    state: !ev ? 'closed' : ev.status === 'active' ? 'open' : 'paused',
    limits: { maxFiles: s.maxFilesPerUpload, maxFileSizeMB: s.maxFileSizeMB, accept: ['image/jpeg', 'image/png', 'image/webp'] },
  };
}

export function displayStatus(svc: Services): DisplayStatus {
  const s = svc.settings.get();
  const ev = svc.store.getCurrentEvent();
  return {
    playback: svc.engine.snapshot(),
    event: ev ? { id: ev.id, name: ev.name, status: ev.status } : null,
    branding: s.branding,
    showIndicators: s.showIndicators,
    blurBackground: s.blurBackground,
    transitionMs: s.transitionMs,
    qrUrl: svc.qrTarget().url,
  };
}

function adminPhoto(p: PhotoRecord) {
  return {
    ...p,
    url: `/media/${p.eventId}/${p.id}`,
    thumbUrl: p.thumbName ? `/media/${p.eventId}/${p.id}/thumb` : `/media/${p.eventId}/${p.id}`,
  };
}

export function createApp(svc: Services, hooks: AppHooks) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', svc.config.trustProxy);
  app.use(securityHeaders);

  const upload = createUploadHandler(svc, hooks.notifySocket);
  const loginLimiter = new RateLimiter(15 * 60_000, () => 10);
  const apiLimiter = new RateLimiter(60_000, () => 600);

  // Limite geral por IP para a API.
  app.use('/api', (req, res, next) => {
    const r = apiLimiter.take(clientIp(req, svc.config.trustProxy));
    if (!r.ok) {
      res.setHeader('Retry-After', String(r.retryAfterSec));
      return next(new AppError(429, 'Muitas requisições. Aguarde um instante.', 'rate_limited'));
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ============================================================ PÚBLICO
  app.get('/api/public/status', (_req, res) => res.json(publicStatus(svc)));
  app.post('/api/public/upload', wrap(upload.handler));

  app.get('/api/public/logo', (req, res, next) => {
    if (!fs.existsSync(svc.logoFile)) return next(new AppError(404, 'Sem logotipo.'));
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(svc.logoFile);
  });

  const qrOptions = (req: Request) => {
    const size = Math.min(2048, Math.max(128, Number(req.query.size) || 600));
    const dark = /^[0-9a-f]{6}$/i.test(String(req.query.dark || '')) ? `#${req.query.dark}` : '#000000';
    return { width: size, margin: 2, errorCorrectionLevel: 'M' as const, color: { dark, light: '#ffffff' } };
  };
  app.get(
    '/api/qr.png',
    wrap(async (req, res) => {
      const buf = await QRCode.toBuffer(svc.qrTarget().url, { ...qrOptions(req), type: 'png' });
      res.setHeader('Content-Type', 'image/png');
      if (req.query.download) res.setHeader('Content-Disposition', 'attachment; filename="qrcode-mural-de-fotos.png"');
      res.send(buf);
    }),
  );
  app.get(
    '/api/qr.svg',
    wrap(async (req, res) => {
      const svg = await QRCode.toString(svc.qrTarget().url, { ...qrOptions(req), type: 'svg' });
      res.setHeader('Content-Type', 'image/svg+xml');
      if (req.query.download) res.setHeader('Content-Disposition', 'attachment; filename="qrcode-mural-de-fotos.svg"');
      res.send(svg);
    }),
  );

  // ============================================================ TELA DE TRANSMISSÃO
  app.post(
    '/api/display/session',
    express.json({ limit: '4kb' }),
    wrap(async (req, res) => {
      if (displayAllowed(svc, req)) return res.json({ ok: true });
      const key = String(req.body?.key || '');
      const rl = loginLimiter.take('display:' + clientIp(req, svc.config.trustProxy));
      if (!rl.ok) throw new AppError(429, 'Muitas tentativas. Aguarde alguns minutos.');
      if (!key || !safeEqual(key, svc.settings.internal.displayKey)) {
        throw new AppError(401, 'Chave de transmissão inválida.', 'unauthorized');
      }
      issueSession(svc, req, res, 'display');
      res.json({ ok: true });
    }),
  );
  app.get('/api/display/status', (req, res, next) => {
    if (!displayAllowed(svc, req)) return next(new AppError(401, 'Tela de transmissão não autorizada.', 'unauthorized'));
    res.json(displayStatus(svc));
  });

  // Arquivos de imagem: somente para administrador ou tela de transmissão autorizada.
  // O caminho físico nunca é exposto; o arquivo é localizado pelos IDs (UUID validados).
  const sendPhoto = (thumb: boolean) => (req: Request, res: Response, next: NextFunction) => {
    const { eventId, photoId } = req.params as { eventId: string; photoId: string };
    if (!isUuid(eventId) || !isUuid(photoId)) return next(new AppError(404, 'Não encontrado.'));
    if (thumb ? !adminSession(svc, req) : !displayAllowed(svc, req)) return next(new AppError(401, 'Não autorizado.'));
    const photo = svc.store.getPhoto(eventId, photoId);
    if (!photo) return next(new AppError(404, 'Não encontrado.'));
    const file = thumb ? svc.store.thumbFilePath(photo) : svc.store.photoFilePath(photo);
    if (!file || !fs.existsSync(file)) return next(new AppError(404, 'Arquivo não encontrado.'));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.basename(file), { root: path.dirname(file), dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) next(new AppError(404, 'Arquivo não encontrado.'));
    });
  };
  app.get('/media/:eventId/:photoId', sendPhoto(false));
  app.get('/media/:eventId/:photoId/thumb', sendPhoto(true));

  // ============================================================ AUTENTICAÇÃO
  app.post(
    '/api/admin/login',
    express.json({ limit: '4kb' }),
    wrap(async (req, res) => {
      const ip = clientIp(req, svc.config.trustProxy);
      if (!isAllowedOrigin(svc, req.headers.origin, req.headers.host)) throw new AppError(403, 'Origem não permitida.');
      if (!svc.config.adminPasswordHash) {
        throw new AppError(503, 'A senha administrativa ainda não foi configurada. Execute "npm run set-password" no computador do servidor.', 'no_password');
      }
      const rl = loginLimiter.take('login:' + ip);
      if (!rl.ok) throw new AppError(429, `Muitas tentativas. Aguarde ${Math.ceil(rl.retryAfterSec / 60)} minuto(s).`, 'rate_limited');
      const ok = await verifyPassword(String(req.body?.password || ''), svc.config.adminPasswordHash);
      if (!ok) {
        log.warn(`Tentativa de login inválida (IP ${ip})`);
        throw new AppError(401, 'Senha incorreta.', 'invalid_password');
      }
      loginLimiter.reset('login:' + ip);
      const session = issueSession(svc, req, res, 'admin');
      log.info(`Login administrativo (IP ${ip})`);
      res.json({ ok: true, csrfToken: csrfFor(svc.sessionSecret, session.sid) });
    }),
  );

  app.get('/api/admin/session', (req, res) => {
    const s = adminSession(svc, req);
    res.json({
      authenticated: !!s,
      csrfToken: s ? csrfFor(svc.sessionSecret, s.sid) : null,
      passwordConfigured: !!svc.config.adminPasswordHash,
    });
  });

  app.post('/api/admin/logout', (req, res) => {
    clearCookie(res, ADMIN_COOKIE);
    res.json({ ok: true });
  });

  // ============================================================ ADMINISTRAÇÃO (protegido)
  const admin = express.Router();
  admin.use(requireAdmin(svc));
  admin.use(express.json({ limit: '64kb' }));

  const eventView = (id: string) => {
    const ev = svc.store.getEvent(id);
    if (!ev) throw new AppError(404, 'Evento não encontrado.');
    return { ...ev, stats: svc.store.stats(id) };
  };

  admin.post('/logout-all', wrap(async (_req, res) => {
    await svc.settings.setInternal({ sessionVersion: svc.settings.internal.sessionVersion + 1 });
    clearCookie(res, ADMIN_COOKIE);
    clearCookie(res, DISPLAY_COOKIE);
    res.json({ ok: true });
  }));

  admin.get('/overview', (_req, res) => {
    const current = svc.store.getCurrentEvent();
    const qr = svc.qrTarget();
    res.json({
      event: current ? { ...current, stats: svc.store.stats(current.id) } : null,
      playback: svc.engine.snapshot(),
      uploads: upload.stats(),
      qr,
      config: {
        passwordConfigured: !!svc.config.adminPasswordHash,
        publicUrlConfigured: !!qr.publicUrl,
        port: svc.config.port,
      },
      totals: {
        events: svc.store.listEvents().length,
      },
    });
  });

  // ---------- eventos
  admin.get('/events', (_req, res) => {
    res.json(svc.store.listEvents().map((e) => ({ ...e, stats: svc.store.stats(e.id) })));
  });
  admin.post('/events', wrap(async (req, res) => {
    const ev = await svc.store.createEvent(req.body || {});
    if (req.body?.startNow) await svc.store.startEvent(ev.id, { finishCurrent: !!req.body?.finishCurrent });
    res.status(201).json(eventView(ev.id));
  }));
  admin.get('/events/:id', (req, res) => res.json(eventView(String(req.params.id))));
  admin.patch('/events/:id', wrap(async (req, res) => {
    await svc.store.updateEvent(String(req.params.id), req.body || {});
    res.json(eventView(String(req.params.id)));
  }));
  admin.post('/events/:id/start', wrap(async (req, res) => {
    await svc.store.startEvent(String(req.params.id), { finishCurrent: !!req.body?.finishCurrent });
    log.info(`Evento iniciado: ${req.params.id}`);
    res.json(eventView(String(req.params.id)));
  }));
  admin.post('/events/:id/pause', wrap(async (req, res) => {
    await svc.store.pauseEvent(String(req.params.id));
    res.json(eventView(String(req.params.id)));
  }));
  admin.post('/events/:id/resume', wrap(async (req, res) => {
    await svc.store.startEvent(String(req.params.id));
    res.json(eventView(String(req.params.id)));
  }));
  admin.post('/events/:id/finish', wrap(async (req, res) => {
    await svc.store.finishEvent(String(req.params.id));
    log.info(`Evento encerrado: ${req.params.id}`);
    res.json(eventView(String(req.params.id)));
  }));
  const requireConfirm = (req: Request, word: string) => {
    if (String(req.body?.confirm || '').trim().toUpperCase() !== word) {
      throw badRequest(`Confirmação necessária: digite ${word}.`, 'confirmation_required');
    }
  };
  admin.post('/events/:id/purge', wrap(async (req, res) => {
    requireConfirm(req, 'LIMPAR');
    const r = await svc.store.purgeEvent(String(req.params.id), 'limpeza manual pelo administrador');
    res.json({ ...eventView(String(req.params.id)), removed: r.removed });
  }));
  admin.post('/events/:id/finish-and-purge', wrap(async (req, res) => {
    requireConfirm(req, 'LIMPAR');
    await svc.store.finishEvent(String(req.params.id));
    await svc.engine.idle();
    const r = await svc.store.purgeEvent(String(req.params.id), 'ENCERRAR E LIMPAR EVENTO');
    res.json({ ...eventView(String(req.params.id)), removed: r.removed });
  }));
  admin.delete('/events/:id', wrap(async (req, res) => {
    requireConfirm(req, 'EXCLUIR');
    await svc.store.deleteEvent(String(req.params.id));
    res.json({ ok: true });
  }));

  // ---------- fotografias
  admin.get('/events/:id/photos', (req, res) => {
    const id = String(req.params.id);
    if (!svc.store.getEvent(id)) throw new AppError(404, 'Evento não encontrado.');
    const status = String(req.query.status || '');
    const valid = ['queued', 'playing', 'displayed', 'rejected'];
    let list = svc.store.listPhotos(id, valid.includes(status) ? (status as PhotoRecord['status']) : undefined);
    if (status === 'queued') list = list.sort((a, b) => a.position - b.position);
    else list = list.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    res.json({ photos: list.map(adminPhoto), stats: svc.store.stats(id) });
  });

  const photoAction = (fn: (eventId: string, photoId: string) => Promise<unknown>) =>
    wrap(async (req, res) => {
      const { eventId, photoId } = req.params as { eventId: string; photoId: string };
      if (!isUuid(eventId) || !isUuid(photoId)) throw new AppError(404, 'Fotografia não encontrada.');
      await fn(eventId, photoId);
      const p = svc.store.getPhoto(eventId, photoId);
      res.json({ ok: true, photo: p ? adminPhoto(p) : null });
    });
  admin.post('/photos/:eventId/:photoId/reject', photoAction((e, p) => svc.store.rejectPhoto(e, p)));
  admin.post('/photos/:eventId/:photoId/requeue', photoAction((e, p) => svc.store.requeuePhoto(e, p)));
  admin.post('/photos/:eventId/:photoId/play-next', photoAction((e, p) => svc.store.prioritizePhoto(e, p)));
  admin.delete('/photos/:eventId/:photoId', photoAction((e, p) => svc.store.deletePhoto(e, p)));

  // ---------- transmissão
  const tx = (fn: () => Promise<unknown>) =>
    wrap(async (_req, res) => {
      await fn();
      res.json(svc.engine.snapshot());
    });
  admin.get('/transmission', (_req, res) => res.json(svc.engine.snapshot()));
  admin.post('/transmission/start', tx(() => svc.engine.start()));
  admin.post('/transmission/pause', tx(() => svc.engine.pause()));
  admin.post('/transmission/resume', tx(() => svc.engine.resume()));
  admin.post('/transmission/stop', tx(() => svc.engine.stop()));
  admin.post('/transmission/skip', tx(() => svc.engine.next({ skipped: true })));
  admin.post('/transmission/next', tx(() => svc.engine.next({ skipped: false })));

  // ---------- configurações
  admin.get('/settings', (_req, res) => {
    res.json({
      settings: svc.settings.get(),
      envPublicBaseUrl: svc.config.publicBaseUrl,
      displayKey: svc.settings.internal.displayKey,
    });
  });
  admin.patch('/settings', wrap(async (req, res) => {
    const settings = await svc.settings.update(req.body || {});
    log.info('Configurações atualizadas pelo administrador');
    hooksAfterSettings();
    res.json({ settings, envPublicBaseUrl: svc.config.publicBaseUrl, displayKey: svc.settings.internal.displayKey });
  }));
  admin.post('/display-key/regenerate', wrap(async (_req, res) => {
    await svc.settings.regenerateDisplayKey();
    res.json({ displayKey: svc.settings.internal.displayKey });
  }));

  admin.post('/branding/logo', wrap(async (req, res) => {
    const tmp = path.join(svc.tmpDir, `${newId()}.logo`);
    let truncated = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: 3 * 1024 * 1024, fields: 0 } });
        let wrote: Promise<void> | null = null;
        bb.on('file', (_n, stream) => {
          stream.on('limit', () => (truncated = true));
          wrote = pipeline(stream, fs.createWriteStream(tmp));
        });
        bb.on('error', reject);
        bb.on('close', () => (wrote ? wrote.then(resolve, reject) : reject(badRequest('Nenhum arquivo enviado.'))));
        req.pipe(bb);
      });
      if (truncated) throw badRequest('O logotipo deve ter no máximo 3 MB.');
      await processLogo(tmp, svc.logoFile);
      const settings = await svc.settings.setLogo(true);
      hooksAfterSettings();
      res.json({ settings });
    } catch (err) {
      if (err instanceof InvalidImageError) throw badRequest(err.message);
      throw err;
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
    }
  }));
  admin.delete('/branding/logo', wrap(async (_req, res) => {
    await fsp.rm(svc.logoFile, { force: true });
    const settings = await svc.settings.setLogo(false);
    hooksAfterSettings();
    res.json({ settings });
  }));

  admin.get('/network', (_req, res) => {
    res.json({ addresses: getLocalAddresses(), port: svc.config.port, qr: svc.qrTarget() });
  });

  admin.post('/cleanup/run', wrap(async (req, res) => {
    requireConfirm(req, 'LIMPAR');
    const r = await svc.runCleanup('manual');
    res.json(r);
  }));
  admin.get('/logs/:name', (req, res) => {
    const name = req.params.name === 'cleanup' ? 'cleanup.log' : 'app.log';
    res.json({ lines: readLogTail(name, 300) });
  });

  app.use('/api/admin', admin);

  // Hooks preenchidos pelo módulo de tempo real.
  let afterSettings: () => void = () => undefined;
  function hooksAfterSettings() {
    afterSettings();
  }

  // Qualquer outra rota /api inexistente
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Rota não encontrada.')));

  const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const e = err instanceof AppError ? err : null;
    if (!e) log.error(`Erro em ${req.method} ${req.path}`, err instanceof Error ? err.stack || err.message : String(err));
    if (res.headersSent) return;
    const status = e?.status || (typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500);
    const send = () => {
      if (res.headersSent) return;
      res.status(status).json({
        ok: false,
        error: e?.message || (status === 400 ? 'Requisição inválida.' : 'Erro interno. Tente novamente.'),
        code: e?.code || 'internal',
      });
    };
    if (!req.complete && !req.destroyed) {
      // Erro antes de ler todo o corpo (ex.: envio grande demais): descarta o restante e só
      // então responde, para o celular receber a mensagem em vez de "conexão interrompida".
      res.setHeader('Connection', 'close');
      req.unpipe();
      req.resume();
      req.once('end', send);
      req.once('close', send);
      setTimeout(send, 15_000).unref();
      return;
    }
    send();
  };

  return {
    app,
    errorHandler,
    upload,
    onSettingsChanged: (fn: () => void) => {
      afterSettings = fn;
    },
  };
}
