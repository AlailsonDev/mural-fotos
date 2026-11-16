import { EventEmitter } from 'node:events';
import type { PhotoRecord, PlaybackSnapshot, PublicPhoto, TransmissionMode } from '../../lib/shared/types';
import type { EventStore } from './events';
import type { SettingsStore } from './settings';
import { Mutex } from '../lib/mutex';
import { log } from '../lib/logger';

interface CurrentPlay {
  eventId: string;
  photoId: string;
  photo: PublicPhoto;
  startedAt: number;
  displayMs: number;
  transitionMs: number;
  /** Momento previsto de término quando o relógio está correndo; null quando congelado. */
  endsAt: number | null;
  /** Tempo restante (válido quando congelado). */
  remainingMs: number;
}

export function toPublicPhoto(p: PhotoRecord): PublicPhoto {
  return { id: p.id, eventId: p.eventId, width: p.width, height: p.height, url: `/media/${p.eventId}/${p.id}`, caption: p.caption || '' };
}

/**
 * Máquina de estados da transmissão. O SERVIDOR é a única autoridade sobre qual foto
 * está em exibição e qual será a próxima; as telas apenas mostram o que recebem.
 *
 * Regras:
 *  - nunca há duas fotos em exibição (uma única variável `current`, protegida por mutex);
 *  - uma foto nova nunca interrompe a atual: ela apenas entra no final da fila;
 *  - o relógio só corre quando a transmissão está "running" E há pelo menos uma tela
 *    de transmissão conectada (se a tela cair, a foto atual congela e é retomada ao reconectar);
 *  - ao reiniciar o servidor, a foto que estava em exibição volta para a fila com a mesma
 *    posição (feito pelo EventStore.recover), sendo a primeira a ser exibida novamente.
 */
export class PlaybackEngine extends EventEmitter {
  private current: CurrentPlay | null = null;
  private timer: NodeJS.Timeout | null = null;
  private displays = new Set<string>();
  private lock = new Mutex();
  private reconcileQueued = false;

  constructor(
    private store: EventStore,
    private settings: SettingsStore,
  ) {
    super();
  }

  init() {
    this.store.on('photo', (_p: PhotoRecord, action: string) => {
      if (action !== 'playing' && action !== 'displayed') this.scheduleReconcile();
    });
    this.store.on('event', () => this.scheduleReconcile());
    this.scheduleReconcile();
  }

  get mode(): TransmissionMode {
    return this.settings.internal.transmissionMode;
  }

  get displayCount() {
    return this.displays.size;
  }

  addDisplay(id: string) {
    this.displays.add(id);
    this.scheduleReconcile();
  }

  removeDisplay(id: string) {
    if (this.displays.delete(id)) this.scheduleReconcile();
  }

  // --------------------------------------------------------------- comandos
  start() {
    return this.lock.run(async () => {
      const prev = this.mode;
      await this.settings.setInternal({ transmissionMode: 'running' });
      this.emit('broadcast', prev === 'paused' ? 'transmission:resumed' : 'transmission:started', { mode: 'running' });
      await this.reconcileInner();
    });
  }

  resume() {
    return this.start();
  }

  pause() {
    return this.lock.run(async () => {
      await this.settings.setInternal({ transmissionMode: 'paused' });
      this.emit('broadcast', 'transmission:paused', { mode: 'paused' });
      await this.reconcileInner();
    });
  }

  /** Para a transmissão: a foto atual volta para a fila (mesma posição) e a tela mostra a espera. */
  stop() {
    return this.lock.run(async () => {
      await this.settings.setInternal({ transmissionMode: 'stopped' });
      if (this.current) {
        const cur = this.current;
        this.clearTimer();
        this.current = null;
        await this.store.markInterrupted(cur.eventId, cur.photoId).catch(() => undefined);
      }
      this.emit('broadcast', 'transmission:paused', { mode: 'stopped' });
      await this.reconcileInner();
    });
  }

  /**
   * Avança para a próxima foto. `skipped` marca a atual como pulada.
   * Funciona inclusive com a transmissão pausada (a próxima foto aparece e permanece pausada).
   */
  next(opts: { skipped?: boolean } = {}) {
    return this.lock.run(async () => {
      if (this.current) {
        const cur = this.current;
        this.clearTimer();
        this.current = null;
        try {
          await this.store.markDisplayed(cur.eventId, cur.photoId, { skipped: !!opts.skipped });
          this.emit('broadcast', 'photo:displayed', { photoId: cur.photoId, eventId: cur.eventId, skipped: !!opts.skipped });
        } catch (err) {
          log.warn('Falha ao finalizar foto ao avançar', String(err));
        }
      }
      this.emit('broadcast', 'transmission:next', { skipped: !!opts.skipped });
      await this.reconcileInner({ allowWhilePaused: this.mode === 'paused' });
    });
  }

  // --------------------------------------------------------------- núcleo
  scheduleReconcile() {
    if (this.reconcileQueued) return;
    this.reconcileQueued = true;
    setImmediate(() => {
      this.reconcileQueued = false;
      this.lock.run(() => this.reconcileInner()).catch((err) => log.error('Erro na transmissão', String(err)));
    });
  }

  private async reconcileInner(opts: { allowWhilePaused?: boolean } = {}) {
    const ev = this.store.getCurrentEvent();

    // Foto atual deixou de ser válida (evento encerrado, foto rejeitada/excluída pelo administrador).
    if (this.current) {
      const p = ev && ev.id === this.current.eventId ? this.store.getPhoto(ev.id, this.current.photoId) : null;
      if (!p || p.status !== 'playing') {
        this.clearTimer();
        this.current = null;
      }
    }

    const hasScreen = this.displays.size > 0;
    const running = this.mode === 'running';
    const clockRuns = !!ev && running && hasScreen;
    const canPick = !!ev && hasScreen && (running || (opts.allowWhilePaused && this.mode === 'paused'));

    if (!this.current && canPick && ev) {
      let next = this.store.nextQueued(ev.id);
      if (!next) next = await this.recycleForLoop(ev.id);
      if (next) {
        const s = this.settings.get();
        const photo = await this.store.markPlaying(ev.id, next.id);
        const displayMs = Math.round(s.displaySeconds * 1000);
        this.current = {
          eventId: ev.id,
          photoId: photo.id,
          photo: toPublicPhoto(photo),
          startedAt: Date.now(),
          displayMs,
          transitionMs: s.transitionMs,
          endsAt: null,
          remainingMs: s.transitionMs + displayMs,
        };
        this.emit('broadcast', 'photo:playing', {
          photo: this.current.photo,
          position: photo.position,
          displayMs,
          transitionMs: s.transitionMs,
        });
      }
    }

    if (this.current) {
      if (clockRuns && !this.timer) {
        const cur = this.current;
        cur.endsAt = Date.now() + cur.remainingMs;
        this.timer = setTimeout(() => this.onTimer(cur.photoId), cur.remainingMs);
      } else if (!clockRuns && this.timer) {
        this.current.remainingMs = Math.max(0, (this.current.endsAt || Date.now()) - Date.now());
        this.current.endsAt = null;
        this.clearTimer();
      }
    }

    this.emit('broadcast', 'queue:updated', this.queueInfo());
    this.emit('status', this.snapshot());
  }

  /**
   * Carrossel contínuo: quando a fila esgota, todas as fotos já exibidas (exceto puladas/rejeitadas)
   * voltam para a fila na ORDEM ORIGINAL DE UPLOAD. Fotos novas que chegarem durante o ciclo
   * entram no fim da fila e passam a fazer parte dos ciclos seguintes, também por ordem de envio.
   */
  private async recycleForLoop(eventId: string) {
    const shown = this.store
      .listPhotos(eventId, 'displayed')
      .filter((p) => !p.skipped)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    for (const p of shown) {
      try {
        await this.store.requeuePhoto(eventId, p.id);
      } catch (err) {
        log.warn('Falha ao reciclar foto no carrossel', String(err));
      }
    }
    return this.store.nextQueued(eventId);
  }

  private onTimer(photoId: string) {
    this.lock
      .run(async () => {
        this.timer = null;
        const cur = this.current;
        if (!cur || cur.photoId !== photoId) return;
        this.current = null;
        try {
          await this.store.markDisplayed(cur.eventId, cur.photoId);
          this.emit('broadcast', 'photo:displayed', { photoId: cur.photoId, eventId: cur.eventId, skipped: false });
        } catch (err) {
          log.warn('Falha ao marcar foto como exibida', String(err));
        }
        await this.reconcileInner();
      })
      .catch((err) => log.error('Erro no avanço da fila', String(err)));
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  queueInfo() {
    const ev = this.store.getCurrentEvent();
    if (!ev) return { eventId: null, queueCount: 0, upcoming: null, stats: null };
    const next = this.store.nextQueued(ev.id);
    return {
      eventId: ev.id,
      queueCount: this.store.getQueue(ev.id).length,
      upcoming: next ? toPublicPhoto(next) : null,
      stats: this.store.stats(ev.id),
    };
  }

  snapshot(): PlaybackSnapshot {
    const ev = this.store.getCurrentEvent();
    const q = this.queueInfo();
    const now = Date.now();
    let effective: PlaybackSnapshot['effective'];
    if (!ev) effective = 'no-event';
    else if (this.mode === 'stopped') effective = 'stopped';
    else if (this.mode === 'paused') effective = 'paused';
    else if (this.displays.size === 0) effective = 'waiting-display';
    else effective = this.current ? 'playing' : 'idle';
    const cur = this.current;
    return {
      mode: this.mode,
      effective,
      current: cur
        ? {
            photo: cur.photo,
            startedAt: cur.startedAt,
            endsAt: cur.endsAt,
            remainingMs: cur.endsAt ? Math.max(0, cur.endsAt - now) : cur.remainingMs,
            displayMs: cur.displayMs,
            transitionMs: cur.transitionMs,
          }
        : null,
      upcoming: q.upcoming,
      queueCount: q.queueCount,
      displays: this.displays.size,
      serverNow: now,
    };
  }

  /** Aguarda todas as operações pendentes (útil em testes e no desligamento). */
  async idle() {
    await new Promise((r) => setImmediate(r));
    await this.lock.run(async () => undefined);
  }

  shutdown() {
    this.clearTimer();
  }
}
