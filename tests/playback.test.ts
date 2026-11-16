import { describe, it, expect, afterEach } from 'vitest';
import { newId } from '../server/lib/ids';
import { readConfig } from '../server/config';
import { createServices, type Services } from '../server/services';
import { activeEvent, setFastPlayback, sleep, tmpDataDir, waitFor } from './helpers';

process.env.LOG_QUIET = '1';

const open: Services[] = [];
afterEach(() => {
  open.splice(0).forEach((s) => s.shutdown());
});

async function services(dir = tmpDataDir()) {
  const svc = await createServices(readConfig({ dataDir: dir, port: 0, sessionSecret: 'y'.repeat(48) }));
  open.push(svc);
  return svc;
}

async function addFake(svc: Services, eventId: string) {
  const id = newId();
  const { photo } = await svc.store.addPhoto(eventId, {
    id,
    clientId: null,
    originalName: 'f.jpg',
    storedName: `${id}.webp`,
    thumbName: null,
    originalKeptName: null,
    originalSize: 1,
    storedSize: 1,
    width: 10,
    height: 10,
    format: 'webp',
  });
  return photo;
}

/** Registra a sequência de fotos exibidas e verifica que nunca há duas simultâneas. */
function track(svc: Services) {
  const played: string[] = [];
  const displayed: string[] = [];
  let maxPlaying = 0;
  svc.engine.on('broadcast', (name: string, payload: { photo?: { id: string }; photoId?: string }) => {
    if (name === 'photo:playing') played.push(payload.photo!.id);
    if (name === 'photo:displayed') displayed.push(payload.photoId!);
    const ev = svc.store.getCurrentEvent();
    if (ev) maxPlaying = Math.max(maxPlaying, svc.store.listPhotos(ev.id, 'playing').length);
  });
  return { played, displayed, maxPlaying: () => maxPlaying };
}

describe('Máquina de estados da transmissão', () => {
  it('exibe as fotos sequencialmente, na ordem da fila, uma por vez', async () => {
    const svc = await services();
    setFastPlayback(svc, 0.12);
    const ev = await activeEvent(svc);
    const t = track(svc);
    const photos = [];
    for (let i = 0; i < 5; i++) photos.push(await addFake(svc, ev.id));
    svc.engine.addDisplay('tela-1');
    await waitFor(() => t.displayed.length >= 5, 8000);
    const ids = photos.map((p) => p.id);
    expect(t.played.slice(0, 5)).toEqual(ids);
    expect(t.displayed.slice(0, 5)).toEqual(ids);
    expect(t.maxPlaying()).toBeLessThanOrEqual(1);
  });

  it('carrossel contínuo: ao esgotar a fila, repete as fotos na ordem de upload, sem parar', async () => {
    const svc = await services();
    setFastPlayback(svc, 0.1);
    const ev = await activeEvent(svc);
    const t = track(svc);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await addFake(svc, ev.id)).id);
    svc.engine.addDisplay('tela-1');
    await waitFor(() => t.played.length >= 9, 8000);
    expect(t.played.slice(0, 9)).toEqual([...ids, ...ids, ...ids]);
    expect(t.maxPlaying()).toBeLessThanOrEqual(1);
    expect(svc.engine.snapshot().effective).toBe('playing');
  });

  it('foto nova não interrompe a atual e entra no final da fila', async () => {
    const svc = await services();
    setFastPlayback(svc, 0.5);
    const ev = await activeEvent(svc);
    const t = track(svc);
    const a = await addFake(svc, ev.id);
    svc.engine.addDisplay('tela');
    await waitFor(() => t.played.length === 1);
    const startedAt = svc.engine.snapshot().current!.startedAt;
    const b = await addFake(svc, ev.id);
    await sleep(100);
    const snap = svc.engine.snapshot();
    expect(snap.current!.photo.id).toBe(a.id);
    expect(snap.current!.startedAt).toBe(startedAt);
    expect(snap.upcoming!.id).toBe(b.id);
    await waitFor(() => t.played.length === 2, 3000);
    expect(t.played).toEqual([a.id, b.id]);
  });

  it('não avança sem tela de transmissão conectada e retoma ao reconectar', async () => {
    const svc = await services();
    setFastPlayback(svc, 0.15);
    const ev = await activeEvent(svc);
    await addFake(svc, ev.id);
    await addFake(svc, ev.id);
    await sleep(300);
    expect(svc.store.stats(ev.id).displayed).toBe(0);
    expect(svc.engine.snapshot().effective).toBe('waiting-display');
    svc.engine.addDisplay('tela');
    await waitFor(() => svc.engine.snapshot().current !== null);
    svc.engine.removeDisplay('tela'); // queda de conexão
    await svc.engine.idle();
    const frozen = svc.engine.snapshot().current!;
    expect(frozen.endsAt).toBeNull();
    await sleep(400);
    expect(svc.store.stats(ev.id).displayed).toBe(0); // congelada, nada perdido
    svc.engine.addDisplay('tela-reconectada');
    await waitFor(() => svc.store.stats(ev.id).displayed === 2, 4000);
  });

  it('pausa, retoma, pula e exibe a próxima', async () => {
    const svc = await services();
    setFastPlayback(svc, 0.3);
    const ev = await activeEvent(svc);
    const a = await addFake(svc, ev.id);
    const b = await addFake(svc, ev.id);
    const c = await addFake(svc, ev.id);
    svc.engine.addDisplay('tela');
    await waitFor(() => svc.engine.snapshot().current?.photo.id === a.id);
    await svc.engine.pause();
    expect(svc.engine.snapshot().effective).toBe('paused');
    await sleep(500);
    expect(svc.engine.snapshot().current!.photo.id).toBe(a.id); // continua parada na mesma foto
    await svc.engine.next({ skipped: true }); // pular enquanto pausado
    expect(svc.store.getPhoto(ev.id, a.id)!.skipped).toBe(true);
    expect(svc.engine.snapshot().current!.photo.id).toBe(b.id);
    expect(svc.engine.snapshot().mode).toBe('paused');
    await svc.engine.resume();
    await waitFor(() => svc.engine.snapshot().current?.photo.id === c.id, 3000);
    await svc.engine.next();
    // c foi exibida; o carrossel recomeça por b (a foi pulada e não volta ao ciclo)
    expect(svc.engine.snapshot().current!.photo.id).toBe(b.id);
    expect(svc.store.getPhoto(ev.id, a.id)!.status).toBe('displayed');
  });

  it('parar devolve a foto atual para a fila', async () => {
    const svc = await services();
    setFastPlayback(svc, 5);
    const ev = await activeEvent(svc);
    const a = await addFake(svc, ev.id);
    svc.engine.addDisplay('tela');
    await waitFor(() => svc.engine.snapshot().current?.photo.id === a.id);
    await svc.engine.stop();
    expect(svc.store.getPhoto(ev.id, a.id)!.status).toBe('queued');
    expect(svc.engine.snapshot().effective).toBe('stopped');
    await svc.engine.start();
    await waitFor(() => svc.engine.snapshot().current?.photo.id === a.id);
  });

  it('rejeitar a foto em exibição avança imediatamente', async () => {
    const svc = await services();
    setFastPlayback(svc, 5);
    const ev = await activeEvent(svc);
    const a = await addFake(svc, ev.id);
    const b = await addFake(svc, ev.id);
    svc.engine.addDisplay('tela');
    await waitFor(() => svc.engine.snapshot().current?.photo.id === a.id);
    await svc.store.rejectPhoto(ev.id, a.id);
    await waitFor(() => svc.engine.snapshot().current?.photo.id === b.id);
  });

  it('recupera após reiniciar o servidor no meio da reprodução', async () => {
    const dir = tmpDataDir();
    const svc1 = await services(dir);
    setFastPlayback(svc1, 10);
    const ev = await activeEvent(svc1);
    const a = await addFake(svc1, ev.id);
    const b = await addFake(svc1, ev.id);
    svc1.engine.addDisplay('tela');
    await waitFor(() => svc1.engine.snapshot().current?.photo.id === a.id);
    svc1.shutdown(); // "computador reiniciou"

    const svc2 = await services(dir);
    setFastPlayback(svc2, 0.1);
    expect(svc2.store.getPhoto(ev.id, a.id)!.status).toBe('queued');
    svc2.engine.addDisplay('tela');
    const t = track(svc2);
    await waitFor(() => svc2.store.stats(ev.id).displayed === 2, 4000);
    expect(t.played.slice(0, 2)).toEqual([a.id, b.id]);
  });
});
