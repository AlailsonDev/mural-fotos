import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { EventRecord, EventStats, EventStatus, PhotoFolder, PhotoRecord } from '../../lib/shared/types';
import { readJson, writeJsonAtomic, cleanupTempFiles, retryFs } from '../lib/jsonStore';
import { Mutex } from '../lib/mutex';
import { isUuid, newId } from '../lib/ids';
import { AppError, badRequest, conflict, notFound } from '../lib/errors';
import { log } from '../lib/logger';

export const EVENT_SUBDIRS = ['uploads', 'displayed', 'rejected', 'thumbs', 'originals'] as const;

interface PhotosFile {
  version: 1;
  photos: PhotoRecord[];
}

export type EventAction = 'created' | 'updated' | 'started' | 'paused' | 'resumed' | 'finished' | 'deleted' | 'purged';
export type PhotoAction =
  | 'queued'
  | 'playing'
  | 'displayed'
  | 'rejected'
  | 'requeued'
  | 'deleted'
  | 'interrupted'
  | 'prioritized';

export interface NewPhotoInput {
  id: string;
  clientId: string | null;
  originalName: string;
  storedName: string;
  thumbName: string | null;
  originalKeptName: string | null;
  originalSize: number;
  storedSize: number;
  width: number;
  height: number;
  format: string;
  caption?: string;
}

/**
 * Armazenamento de eventos e fotografias em arquivos JSON.
 * - Cache em memória (leituras rápidas) + escrita imediata em disco (write-through).
 * - Todas as alterações passam por um único Mutex: nunca há duas gravações simultâneas,
 *   portanto posições de fila jamais se repetem e nenhum envio sobrescreve outro.
 */
export class EventStore extends EventEmitter {
  readonly eventsDir: string;
  private events = new Map<string, EventRecord>();
  private photos = new Map<string, PhotoRecord[]>();
  private mutex = new Mutex();

  constructor(private dataDir: string) {
    super();
    this.eventsDir = path.join(dataDir, 'events');
  }

  // ------------------------------------------------------------------ caminhos
  eventDir(eventId: string) {
    if (!isUuid(eventId)) throw badRequest('Identificador de evento inválido.');
    return path.join(this.eventsDir, eventId);
  }
  private eventFile(id: string) {
    return path.join(this.eventDir(id), 'event.json');
  }
  private photosFile(id: string) {
    return path.join(this.eventDir(id), 'photos.json');
  }
  /** Caminho físico (uso interno apenas; nunca é enviado ao navegador). */
  photoFilePath(photo: PhotoRecord) {
    return path.join(this.eventDir(photo.eventId), photo.folder, photo.storedName);
  }
  thumbFilePath(photo: PhotoRecord) {
    return photo.thumbName ? path.join(this.eventDir(photo.eventId), 'thumbs', photo.thumbName) : null;
  }

  // ------------------------------------------------------------------ inicialização
  async init() {
    await fs.mkdir(this.eventsDir, { recursive: true });
    const entries = await fs.readdir(this.eventsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !isUuid(entry.name)) continue;
      const ev = await readJson<EventRecord | null>(this.eventFile(entry.name), null);
      if (!ev || ev.id !== entry.name) {
        log.warn(`Pasta de evento ignorada (event.json ausente ou inválido): ${entry.name}`);
        continue;
      }
      const file = await readJson<PhotosFile>(this.photosFile(ev.id), { version: 1, photos: [] });
      this.events.set(ev.id, normalizeEvent(ev));
      this.photos.set(ev.id, Array.isArray(file.photos) ? file.photos : []);
      await cleanupTempFiles(this.eventDir(ev.id));
      for (const sub of EVENT_SUBDIRS) await fs.mkdir(path.join(this.eventDir(ev.id), sub), { recursive: true });
    }
    await this.recover();
  }

  /** Recuperação consistente após reinicialização ou queda de energia. */
  private async recover() {
    await this.mutex.run(async () => {
      // 1) Apenas um evento corrente (ativo/pausado). Se houver mais, mantém o mais recente.
      const current = [...this.events.values()]
        .filter((e) => e.status === 'active' || e.status === 'paused')
        .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
      for (const extra of current.slice(1)) {
        extra.status = 'finished';
        extra.finishedAt = extra.finishedAt || new Date().toISOString();
        log.warn(`Recuperação: evento "${extra.name}" estava corrente junto com outro e foi encerrado.`);
        await this.saveEvent(extra);
      }
      // 2) Foto que estava "playing" volta para a fila mantendo sua posição
      //    (portanto será a primeira a ser exibida novamente). Nenhuma outra foto é afetada.
      for (const [eventId, list] of this.photos) {
        let changed = false;
        let maxPos = 0;
        for (const p of list) {
          maxPos = Math.max(maxPos, p.position);
          if (p.status === 'playing') {
            p.status = 'queued';
            changed = true;
            log.info(`Recuperação: foto ${p.id} recolocada na fila (posição ${p.position}).`);
          }
        }
        const ev = this.events.get(eventId)!;
        if (ev.nextPosition <= maxPos) {
          ev.nextPosition = maxPos + 1;
          await this.saveEvent(ev);
        }
        if (changed) await this.savePhotos(eventId);
      }
    });
  }

  // ------------------------------------------------------------------ persistência
  private async saveEvent(ev: EventRecord) {
    await writeJsonAtomic(this.eventFile(ev.id), ev, { backup: true });
  }
  private async savePhotos(eventId: string) {
    const file: PhotosFile = { version: 1, photos: this.photos.get(eventId) || [] };
    await writeJsonAtomic(this.photosFile(eventId), file, { backup: true });
  }

  // ------------------------------------------------------------------ leitura
  listEvents(): EventRecord[] {
    return [...this.events.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((e) => ({ ...e }));
  }

  getEvent(id: string): EventRecord | null {
    const ev = isUuid(id) ? this.events.get(id) : undefined;
    return ev ? { ...ev } : null;
  }

  /** Evento corrente: ativo ou pausado (no máximo um). */
  getCurrentEvent(): EventRecord | null {
    for (const ev of this.events.values()) if (ev.status === 'active' || ev.status === 'paused') return { ...ev };
    return null;
  }

  listPhotos(eventId: string, status?: PhotoRecord['status']): PhotoRecord[] {
    const list = this.photos.get(eventId) || [];
    const filtered = status ? list.filter((p) => p.status === status) : list;
    return filtered.map((p) => ({ ...p }));
  }

  getPhoto(eventId: string, photoId: string): PhotoRecord | null {
    if (!isUuid(eventId) || !isUuid(photoId)) return null;
    const p = (this.photos.get(eventId) || []).find((x) => x.id === photoId);
    return p ? { ...p } : null;
  }

  findByClientId(eventId: string, clientId: string): PhotoRecord | null {
    const p = (this.photos.get(eventId) || []).find((x) => x.clientId === clientId);
    return p ? { ...p } : null;
  }

  /** Fila em ordem de reprodução (status queued, menor posição primeiro). */
  getQueue(eventId: string): PhotoRecord[] {
    return (this.photos.get(eventId) || [])
      .filter((p) => p.status === 'queued')
      .sort((a, b) => a.position - b.position)
      .map((p) => ({ ...p }));
  }

  nextQueued(eventId: string): PhotoRecord | null {
    let best: PhotoRecord | null = null;
    for (const p of this.photos.get(eventId) || []) {
      if (p.status === 'queued' && (!best || p.position < best.position)) best = p;
    }
    return best ? { ...best } : null;
  }

  stats(eventId: string): EventStats {
    const ev = this.events.get(eventId);
    const list = this.photos.get(eventId) || [];
    if (ev?.purgedAt && ev.archivedStats && list.length === 0) return { ...ev.archivedStats, queued: 0, playing: 0 };
    const s: EventStats = { received: list.length, queued: 0, playing: 0, displayed: 0, rejected: 0 };
    for (const p of list) s[p.status]++;
    return s;
  }

  // ------------------------------------------------------------------ eventos
  createEvent(input: { name: string; description?: string; scheduledStart?: string | null; scheduledEnd?: string | null }) {
    return this.mutex.run(async () => {
      const name = String(input.name || '').trim().slice(0, 100);
      if (!name) throw badRequest('Informe o nome do evento.');
      const ev: EventRecord = {
        id: newId(),
        name,
        description: String(input.description || '').trim().slice(0, 500),
        status: 'planned',
        createdAt: new Date().toISOString(),
        scheduledStart: parseDate(input.scheduledStart),
        scheduledEnd: parseDate(input.scheduledEnd),
        startedAt: null,
        pausedAt: null,
        finishedAt: null,
        purgedAt: null,
        nextPosition: 1,
        archivedStats: null,
      };
      const dir = this.eventDir(ev.id);
      for (const sub of EVENT_SUBDIRS) await fs.mkdir(path.join(dir, sub), { recursive: true });
      this.photos.set(ev.id, []);
      await this.savePhotos(ev.id);
      await this.saveEvent(ev);
      this.events.set(ev.id, ev);
      this.emit('event', { ...ev }, 'created' satisfies EventAction);
      return { ...ev };
    });
  }

  updateEvent(id: string, patch: { name?: string; description?: string; scheduledStart?: string | null; scheduledEnd?: string | null }) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(id);
      if (patch.name !== undefined) {
        const name = String(patch.name).trim().slice(0, 100);
        if (!name) throw badRequest('Informe o nome do evento.');
        ev.name = name;
      }
      if (patch.description !== undefined) ev.description = String(patch.description).trim().slice(0, 500);
      if (patch.scheduledStart !== undefined) ev.scheduledStart = parseDate(patch.scheduledStart);
      if (patch.scheduledEnd !== undefined) ev.scheduledEnd = parseDate(patch.scheduledEnd);
      await this.saveEvent(ev);
      this.emit('event', { ...ev }, 'updated' satisfies EventAction);
      return { ...ev };
    });
  }

  startEvent(id: string, opts: { finishCurrent?: boolean } = {}) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(id);
      if (ev.purgedAt) throw conflict('Este evento já teve as fotografias apagadas e não pode ser reaberto.');
      if (ev.status === 'active') return { ...ev };
      const current = [...this.events.values()].find(
        (e) => e.id !== id && (e.status === 'active' || e.status === 'paused'),
      );
      if (current) {
        if (!opts.finishCurrent) {
          throw conflict(`O evento "${current.name}" ainda está em andamento. Encerre-o antes de iniciar outro.`, 'event_in_progress');
        }
        await this.finishLocked(current);
      }
      const wasPaused = ev.status === 'paused';
      ev.status = 'active';
      ev.startedAt = ev.startedAt || new Date().toISOString();
      ev.pausedAt = null;
      ev.finishedAt = null;
      await this.saveEvent(ev);
      this.emit('event', { ...ev }, (wasPaused ? 'resumed' : 'started') satisfies EventAction);
      return { ...ev };
    });
  }

  pauseEvent(id: string) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(id);
      if (ev.status !== 'active') throw conflict('Somente um evento ativo pode ser pausado.');
      ev.status = 'paused';
      ev.pausedAt = new Date().toISOString();
      await this.saveEvent(ev);
      this.emit('event', { ...ev }, 'paused' satisfies EventAction);
      return { ...ev };
    });
  }

  finishEvent(id: string) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(id);
      if (ev.status === 'finished') return { ...ev };
      await this.finishLocked(ev);
      return { ...ev };
    });
  }

  private async finishLocked(ev: EventRecord) {
    // A foto em exibição volta para a fila (não é perdida nem marcada como exibida indevidamente).
    const list = this.photos.get(ev.id) || [];
    if (list.some((p) => p.status === 'playing')) {
      for (const p of list) if (p.status === 'playing') p.status = 'queued';
      await this.savePhotos(ev.id);
    }
    ev.status = 'finished';
    ev.finishedAt = new Date().toISOString();
    await this.saveEvent(ev);
    this.emit('event', { ...ev }, 'finished' satisfies EventAction);
  }

  /** Exclui o evento e todos os seus arquivos (somente eventos que não estão em andamento). */
  deleteEvent(id: string) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(id);
      if (ev.status === 'active' || ev.status === 'paused') {
        throw conflict('Não é possível excluir um evento em andamento. Encerre-o primeiro.');
      }
      await retryFs(() => fs.rm(this.eventDir(id), { recursive: true, force: true }));
      this.events.delete(id);
      this.photos.delete(id);
      log.cleanup(`Evento excluído: "${ev.name}" (${id})`);
      this.emit('event', { ...ev }, 'deleted' satisfies EventAction);
      return { ...ev };
    });
  }

  /**
   * Apaga fotografias (arquivos e metadados) de um evento encerrado, preservando
   * o registro do evento e as estatísticas no histórico.
   */
  purgeEvent(id: string, reason: string) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(id);
      if (ev.status === 'active' || ev.status === 'paused') {
        throw conflict('Fotografias de eventos em andamento não podem ser apagadas.');
      }
      const stats = this.stats(id);
      const count = (this.photos.get(id) || []).length;
      const dir = this.eventDir(id);
      for (const sub of EVENT_SUBDIRS) {
        await retryFs(() => fs.rm(path.join(dir, sub), { recursive: true, force: true }));
        await fs.mkdir(path.join(dir, sub), { recursive: true });
      }
      this.photos.set(id, []);
      await this.savePhotos(id);
      ev.archivedStats = { ...stats, queued: 0, playing: 0 };
      ev.purgedAt = new Date().toISOString();
      await this.saveEvent(ev);
      log.cleanup(`Fotografias apagadas do evento "${ev.name}" (${id}): ${count} arquivo(s). Motivo: ${reason}`);
      this.emit('event', { ...ev }, 'purged' satisfies EventAction);
      return { ...ev, removed: count };
    });
  }

  // ------------------------------------------------------------------ fotografias
  /**
   * Adiciona uma foto já processada ao final da fila. A posição é atribuída aqui,
   * dentro do mutex, garantindo ordem de chegada definida pelo servidor e sem duplicidade.
   */
  addPhoto(eventId: string, input: NewPhotoInput) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(eventId);
      if (ev.status !== 'active') {
        throw new AppError(409, ev.status === 'paused' ? 'Os envios estão temporariamente suspensos.' : 'Este evento não está recebendo fotografias.', 'uploads_closed');
      }
      const list = this.photos.get(eventId)!;
      if (input.clientId) {
        const dup = list.find((p) => p.clientId === input.clientId);
        if (dup) return { photo: { ...dup }, duplicate: true };
      }
      if (list.some((p) => p.id === input.id)) throw conflict('Identificador de foto duplicado.');
      const photo: PhotoRecord = {
        id: input.id,
        eventId,
        originalName: input.originalName,
        storedName: input.storedName,
        folder: 'uploads',
        path: `uploads/${input.storedName}`,
        thumbName: input.thumbName,
        originalKeptName: input.originalKeptName,
        receivedAt: new Date().toISOString(),
        position: ev.nextPosition++,
        originalSize: input.originalSize,
        storedSize: input.storedSize,
        width: input.width,
        height: input.height,
        format: input.format,
        status: 'queued',
        playedAt: null,
        displayedAt: null,
        rejectedAt: null,
        skipped: false,
        timesDisplayed: 0,
        clientId: input.clientId,
        caption: input.caption || '',
      };
      list.push(photo);
      // A ordem importa: a posição é reservada no event.json antes de registrar a foto.
      await this.saveEvent(ev);
      await this.savePhotos(eventId);
      this.emit('photo', { ...photo }, 'queued' satisfies PhotoAction);
      return { photo: { ...photo }, duplicate: false };
    });
  }

  markPlaying(eventId: string, photoId: string) {
    return this.mutatePhoto(eventId, photoId, async (p) => {
      if (p.status !== 'queued') throw conflict('A foto não está aguardando na fila.');
      p.status = 'playing';
      p.playedAt = new Date().toISOString();
      return 'playing';
    });
  }

  markDisplayed(eventId: string, photoId: string, opts: { skipped?: boolean } = {}) {
    return this.mutatePhoto(eventId, photoId, async (p) => {
      if (p.status !== 'playing') throw conflict('A foto não está em exibição.');
      p.status = 'displayed';
      p.displayedAt = new Date().toISOString();
      p.skipped = !!opts.skipped;
      p.timesDisplayed = (p.timesDisplayed || 0) + 1;
      await this.moveFile(p, 'displayed');
      return 'displayed';
    });
  }

  /** Foto em exibição interrompida (ex.: evento encerrado): volta para a fila na mesma posição. */
  markInterrupted(eventId: string, photoId: string) {
    return this.mutatePhoto(eventId, photoId, async (p) => {
      if (p.status !== 'playing') throw conflict('A foto não está em exibição.');
      p.status = 'queued';
      return 'interrupted';
    });
  }

  rejectPhoto(eventId: string, photoId: string) {
    return this.mutatePhoto(eventId, photoId, async (p) => {
      if (p.status === 'rejected') return null;
      p.status = 'rejected';
      p.rejectedAt = new Date().toISOString();
      await this.moveFile(p, 'rejected');
      return 'rejected';
    });
  }

  /** Recoloca uma foto exibida/rejeitada no final da fila. */
  requeuePhoto(eventId: string, photoId: string) {
    return this.mutatePhoto(eventId, photoId, async (p, ev) => {
      if (p.status === 'queued' || p.status === 'playing') throw conflict('A foto já está na fila.');
      p.status = 'queued';
      p.position = ev.nextPosition++;
      p.rejectedAt = null;
      await this.saveEvent(ev);
      await this.moveFile(p, 'uploads');
      return 'requeued';
    });
  }

  /** Coloca a foto como a próxima a ser exibida (sem interromper a atual). */
  prioritizePhoto(eventId: string, photoId: string) {
    return this.mutatePhoto(eventId, photoId, async (p, ev) => {
      if (p.status === 'playing') throw conflict('A foto já está em exibição.');
      const queue = (this.photos.get(eventId) || []).filter((x) => x.status === 'queued' && x.id !== p.id);
      const min = queue.length ? Math.min(...queue.map((x) => x.position)) : ev.nextPosition++;
      p.position = queue.length ? min - 1 : min;
      if (p.status !== 'queued') {
        p.status = 'queued';
        p.rejectedAt = null;
        await this.moveFile(p, 'uploads');
      }
      await this.saveEvent(ev);
      return 'prioritized';
    });
  }

  deletePhoto(eventId: string, photoId: string) {
    return this.mutex.run(async () => {
      this.mustEvent(eventId);
      const list = this.photos.get(eventId)!;
      const idx = list.findIndex((p) => p.id === photoId);
      if (idx < 0) throw notFound('Fotografia');
      const [photo] = list.splice(idx, 1);
      await this.savePhotos(eventId);
      const dir = this.eventDir(eventId);
      const files = [
        path.join(dir, photo.folder, photo.storedName),
        photo.thumbName ? path.join(dir, 'thumbs', photo.thumbName) : null,
        photo.originalKeptName ? path.join(dir, 'originals', photo.originalKeptName) : null,
      ].filter(Boolean) as string[];
      for (const f of files) await retryFs(() => fs.rm(f, { force: true })).catch((e) => log.warn('Falha ao remover arquivo', String(e)));
      log.info(`Foto excluída pelo administrador: ${photoId} (evento ${eventId})`);
      this.emit('photo', { ...photo }, 'deleted' satisfies PhotoAction);
      return { ...photo };
    });
  }

  private mutatePhoto(
    eventId: string,
    photoId: string,
    fn: (p: PhotoRecord, ev: EventRecord) => Promise<PhotoAction | null>,
  ) {
    return this.mutex.run(async () => {
      const ev = this.mustEvent(eventId);
      const p = (this.photos.get(eventId) || []).find((x) => x.id === photoId);
      if (!p) throw notFound('Fotografia');
      const action = await fn(p, ev);
      if (action) {
        await this.savePhotos(eventId);
        this.emit('photo', { ...p }, action);
      }
      return { ...p };
    });
  }

  /**
   * Move o arquivo entre uploads/displayed/rejected. O conteúdo nunca é alterado.
   * Se o Windows bloquear a operação, o arquivo permanece onde está e os metadados
   * continuam apontando para o local real – nada é perdido.
   */
  private async moveFile(p: PhotoRecord, target: PhotoFolder) {
    if (p.folder === target) return;
    const dir = this.eventDir(p.eventId);
    const from = path.join(dir, p.folder, p.storedName);
    const to = path.join(dir, target, p.storedName);
    try {
      if (!fsSync.existsSync(from)) return;
      await fs.mkdir(path.dirname(to), { recursive: true });
      await retryFs(() => fs.rename(from, to), 4);
      p.folder = target;
      p.path = `${target}/${p.storedName}`;
    } catch (err) {
      log.warn(`Não foi possível mover a foto ${p.id} para ${target}; ela permanece em ${p.folder}.`, String(err));
    }
  }

  private mustEvent(id: string): EventRecord {
    const ev = isUuid(id) ? this.events.get(id) : undefined;
    if (!ev) throw notFound('Evento');
    return ev;
  }

  /** Eventos encerrados cujo prazo de retenção expirou. */
  expiredEvents(retentionHours: number, now = Date.now()): EventRecord[] {
    return [...this.events.values()].filter(
      (e) =>
        e.status === 'finished' &&
        !e.purgedAt &&
        e.finishedAt &&
        now - Date.parse(e.finishedAt) >= retentionHours * 3600_000 &&
        (this.photos.get(e.id) || []).length > 0,
    );
  }
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function normalizeEvent(ev: EventRecord): EventRecord {
  const statuses: EventStatus[] = ['planned', 'active', 'paused', 'finished'];
  return {
    id: ev.id,
    name: ev.name || 'Evento',
    description: ev.description || '',
    status: statuses.includes(ev.status) ? ev.status : 'planned',
    createdAt: ev.createdAt || new Date().toISOString(),
    scheduledStart: ev.scheduledStart ?? null,
    scheduledEnd: ev.scheduledEnd ?? null,
    startedAt: ev.startedAt ?? null,
    pausedAt: ev.pausedAt ?? null,
    finishedAt: ev.finishedAt ?? null,
    purgedAt: ev.purgedAt ?? null,
    nextPosition: Number(ev.nextPosition) || 1,
    archivedStats: ev.archivedStats ?? null,
  };
}
