import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import type { Request, Response } from 'express';
import type { Services } from '../services';
import { RateLimiter } from '../lib/rateLimit';
import { clientIp } from './security';
import { isClientId, newId, sanitizeCaption, sanitizeDisplayName } from '../lib/ids';
import { ACCEPTED_EXT, ACCEPTED_MIME, InvalidImageError, imageSemaphore, processImage } from '../lib/image';
import { AppError } from '../lib/errors';
import { log } from '../lib/logger';

export interface UploadResultItem {
  clientId: string | null;
  name: string;
  photoId?: string;
  position?: number;
  duplicate?: boolean;
  reason?: string;
}

const MAX_CONCURRENT_UPLOADS = 30;

interface IncomingFile {
  index: number;
  clientId: string | null;
  name: string;
  caption: string;
  tmp: string;
  size: number;
  truncated: boolean;
  badType: boolean;
}

export function createUploadHandler(svc: Services, notify: (socketId: string, event: string, payload: unknown) => void) {
  const limiter = new RateLimiter(10 * 60_000, () => svc.settings.get().uploadRateLimitPerIp);
  let activeUploads = 0;

  const handler = async (req: Request, res: Response) => {
    const ip = clientIp(req, svc.config.trustProxy);
    const settings = svc.settings.get();
    const ev = svc.store.getCurrentEvent();

    // Rejeições rápidas, antes de ler o corpo da requisição.
    if (!ev || ev.status === 'finished') throw new AppError(409, 'No momento não há evento recebendo fotografias.', 'no_event');
    if (ev.status === 'paused') throw new AppError(409, 'Os envios estão temporariamente suspensos. Tente novamente em instantes.', 'uploads_paused');
    if (!String(req.headers['content-type'] || '').startsWith('multipart/form-data')) {
      throw new AppError(400, 'Formato de envio inválido.');
    }
    const declared = Number(req.headers['content-length'] || 0);
    const maxBytes = settings.maxFileSizeMB * 1024 * 1024;
    if (declared && declared > maxBytes * settings.maxFilesPerUpload + 1024 * 1024) {
      throw new AppError(413, `As fotografias excedem o limite de ${settings.maxFileSizeMB} MB cada.`, 'too_large');
    }
    const rl = limiter.take(ip);
    if (!rl.ok) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      throw new AppError(429, `Muitos envios em sequência. Aguarde ${Math.ceil(rl.retryAfterSec / 60)} min e tente novamente.`, 'rate_limited');
    }
    if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
      res.setHeader('Retry-After', '5');
      throw new AppError(503, 'Muitas pessoas enviando ao mesmo tempo. Tente novamente em alguns segundos.', 'busy');
    }

    activeUploads++;
    const files: IncomingFile[] = [];
    const results: { accepted: UploadResultItem[]; rejected: UploadResultItem[] } = { accepted: [], rejected: [] };
    let meta: Array<{ clientId?: string; name?: string; caption?: string }> = [];
    let tooMany = 0;

    try {
      await new Promise<void>((resolve, reject) => {
        const bb = busboy({
          headers: req.headers,
          limits: {
            files: settings.maxFilesPerUpload,
            fileSize: maxBytes,
            fields: 5,
            fieldSize: 32 * 1024,
            parts: settings.maxFilesPerUpload + 5,
          },
        });
        const writes: Promise<void>[] = [];
        let index = 0;

        bb.on('field', (name, value) => {
          if (name === 'meta') {
            try {
              const parsed = JSON.parse(value);
              if (Array.isArray(parsed)) meta = parsed.slice(0, 20);
            } catch {
              /* ignora */
            }
          }
        });

        bb.on('file', (_field, stream, info) => {
          const i = index++;
          const m = meta[i] || {};
          const name = sanitizeDisplayName(info.filename || m.name || `foto-${i + 1}`);
          const ext = path.extname(name).toLowerCase();
          const item: IncomingFile = {
            index: i,
            clientId: isClientId(m.clientId) ? m.clientId : null,
            name,
            caption: sanitizeCaption(m.caption),
            tmp: path.join(svc.tmpDir, `${newId()}.upload`),
            size: 0,
            truncated: false,
            // O tipo declarado é apenas um primeiro filtro; o conteúdo real é verificado depois.
            badType: !ACCEPTED_MIME.includes(info.mimeType) && !(ext && ACCEPTED_EXT.includes(ext)),
          };
          files.push(item);
          stream.on('data', (chunk: Buffer) => (item.size += chunk.length));
          stream.on('limit', () => (item.truncated = true));
          writes.push(pipeline(stream, fs.createWriteStream(item.tmp, { flags: 'wx' })));
        });

        bb.on('filesLimit', () => tooMany++);
        bb.on('error', (err) => reject(new AppError(400, 'Envio interrompido ou inválido.', String(err))));
        bb.on('close', () => {
          Promise.all(writes).then(() => resolve(), reject);
        });
        req.on('aborted', () => reject(new AppError(400, 'Envio cancelado.', 'aborted')));
        req.pipe(bb);
      });

      if (files.length === 0) throw new AppError(400, 'Nenhuma fotografia foi recebida.', 'empty');
      if (tooMany) {
        results.rejected.push({ clientId: null, name: '', reason: `Máximo de ${settings.maxFilesPerUpload} fotografias por envio.` });
      }

      const eventDir = svc.store.eventDir(ev.id);
      for (const f of files) {
        const base = { clientId: f.clientId, name: f.name };
        if (f.truncated) {
          results.rejected.push({ ...base, reason: `Maior que ${settings.maxFileSizeMB} MB.` });
          continue;
        }
        if (f.badType || f.size === 0) {
          results.rejected.push({ ...base, reason: 'Formato não aceito (use JPG, PNG ou WebP).' });
          continue;
        }
        // Reenvio após queda de conexão: a foto já está registrada, não duplica.
        if (f.clientId) {
          const existing = svc.store.findByClientId(ev.id, f.clientId);
          if (existing) {
            results.accepted.push({ ...base, photoId: existing.id, position: existing.position, duplicate: true });
            continue;
          }
        }
        const id = newId();
        try {
          const processed = await imageSemaphore.use(() =>
            processImage(f.tmp, eventDir, id, {
              format: settings.imageFormat,
              quality: settings.imageQuality,
              maxDimension: settings.maxImageDimension,
              keepOriginal: settings.keepOriginals,
            }),
          );
          try {
            const { photo, duplicate } = await svc.store.addPhoto(ev.id, {
              id,
              clientId: f.clientId,
              originalName: f.name,
              storedName: processed.storedName,
              thumbName: processed.thumbName,
              originalKeptName: processed.originalKeptName,
              originalSize: f.size,
              storedSize: processed.storedSize,
              width: processed.width,
              height: processed.height,
              format: processed.format,
              caption: f.caption,
            });
            if (duplicate) await removeProcessed(eventDir, processed);
            results.accepted.push({ ...base, photoId: photo.id, position: photo.position, duplicate });
          } catch (err) {
            await removeProcessed(eventDir, processed);
            throw err;
          }
        } catch (err) {
          if (err instanceof InvalidImageError) results.rejected.push({ ...base, reason: err.message });
          else if (err instanceof AppError) results.rejected.push({ ...base, reason: err.message });
          else {
            log.error('Falha ao processar imagem', String(err));
            results.rejected.push({ ...base, reason: 'Não foi possível processar esta imagem.' });
          }
        }
      }

      const newOnes = results.accepted.filter((a) => !a.duplicate).length;
      if (newOnes) log.info(`Upload recebido: ${newOnes} foto(s) no evento "${ev.name}" (IP ${ip})`);
      const socketId = String(req.headers['x-socket-id'] || '');
      if (socketId && results.accepted.length) {
        notify(socketId, 'photo:uploaded', { count: results.accepted.length });
      }
      res.status(results.accepted.length ? 200 : 422).json({
        ok: results.accepted.length > 0,
        ...results,
        message: results.accepted.length
          ? 'Suas fotografias foram recebidas com sucesso! Agora é só aguardar. Em breve elas aparecerão no telão!'
          : 'Nenhuma fotografia pôde ser aceita.',
      });
    } finally {
      activeUploads--;
      await Promise.all(files.map((f) => fsp.rm(f.tmp, { force: true }).catch(() => undefined)));
    }
  };

  return { handler, limiter, stats: () => ({ activeUploads, processing: imageSemaphore.running, waiting: imageSemaphore.pending }) };
}

async function removeProcessed(eventDir: string, p: { storedName: string; thumbName: string; originalKeptName: string | null }) {
  await fsp.rm(path.join(eventDir, 'uploads', p.storedName), { force: true }).catch(() => undefined);
  await fsp.rm(path.join(eventDir, 'thumbs', p.thumbName), { force: true }).catch(() => undefined);
  if (p.originalKeptName) await fsp.rm(path.join(eventDir, 'originals', p.originalKeptName), { force: true }).catch(() => undefined);
}
