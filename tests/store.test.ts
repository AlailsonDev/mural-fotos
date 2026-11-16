import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { EventStore, type NewPhotoInput } from '../server/store/events';
import { readJson, writeJsonAtomic } from '../server/lib/jsonStore';
import { newId } from '../server/lib/ids';
import { tmpDataDir } from './helpers';

process.env.LOG_QUIET = '1';

function fakePhoto(overrides: Partial<NewPhotoInput> = {}): NewPhotoInput {
  const id = newId();
  return {
    id,
    clientId: null,
    originalName: 'foto.jpg',
    storedName: `${id}.webp`,
    thumbName: `${id}.webp`,
    originalKeptName: null,
    originalSize: 1000,
    storedSize: 500,
    width: 100,
    height: 100,
    format: 'webp',
    ...overrides,
  };
}

async function newStore(dir = tmpDataDir()) {
  const store = new EventStore(dir);
  await store.init();
  return { store, dir };
}

describe('Gravação JSON atômica', () => {
  it('grava, mantém backup e recupera de arquivo corrompido', async () => {
    const dir = tmpDataDir();
    const file = path.join(dir, 'x.json');
    await writeJsonAtomic(file, { v: 1 }, { backup: true });
    await writeJsonAtomic(file, { v: 2 }, { backup: true });
    expect(await readJson(file, null)).toEqual({ v: 2 });
    fs.writeFileSync(file, '{ corrompido');
    expect(await readJson(file, null)).toEqual({ v: 1 }); // restaurado do .bak
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });

  it('suporta muitas gravações simultâneas sem corromper', async () => {
    const dir = tmpDataDir();
    const file = path.join(dir, 'y.json');
    await Promise.all(Array.from({ length: 30 }, (_, i) => writeJsonAtomic(file, { i }, { backup: true })));
    const data = await readJson<{ i: number } | null>(file, null);
    expect(data).not.toBeNull();
    expect(typeof data!.i).toBe('number');
  });
});

describe('Eventos', () => {
  it('permite apenas um evento ativo por vez', async () => {
    const { store } = await newStore();
    const a = await store.createEvent({ name: 'A' });
    const b = await store.createEvent({ name: 'B' });
    await store.startEvent(a.id);
    await expect(store.startEvent(b.id)).rejects.toMatchObject({ status: 409 });
    await store.startEvent(b.id, { finishCurrent: true });
    expect(store.getEvent(a.id)!.status).toBe('finished');
    expect(store.getCurrentEvent()!.id).toBe(b.id);
  });

  it('bloqueia envios em eventos pausados ou encerrados', async () => {
    const { store } = await newStore();
    const ev = await store.createEvent({ name: 'X' });
    await expect(store.addPhoto(ev.id, fakePhoto())).rejects.toMatchObject({ status: 409 }); // planejado
    await store.startEvent(ev.id);
    await store.pauseEvent(ev.id);
    await expect(store.addPhoto(ev.id, fakePhoto())).rejects.toMatchObject({ code: 'uploads_closed' });
    await store.startEvent(ev.id);
    await store.addPhoto(ev.id, fakePhoto());
    await store.finishEvent(ev.id);
    await expect(store.addPhoto(ev.id, fakePhoto())).rejects.toMatchObject({ status: 409 });
  });

  it('não mistura fotografias de eventos diferentes', async () => {
    const { store } = await newStore();
    const a = await store.createEvent({ name: 'A' });
    await store.startEvent(a.id);
    await store.addPhoto(a.id, fakePhoto());
    await store.addPhoto(a.id, fakePhoto());
    const b = await store.createEvent({ name: 'B' });
    await store.startEvent(b.id, { finishCurrent: true });
    await store.addPhoto(b.id, fakePhoto());
    expect(store.listPhotos(a.id)).toHaveLength(2);
    expect(store.listPhotos(b.id)).toHaveLength(1);
    expect(store.listPhotos(b.id)[0].position).toBe(1); // nova fila começa vazia
    expect(store.listPhotos(b.id).every((p) => p.eventId === b.id)).toBe(true);
  });
});

describe('Fila', () => {
  it('atribui posições únicas e sequenciais em envios simultâneos', async () => {
    const { store } = await newStore();
    const ev = await store.createEvent({ name: 'Simultâneo' });
    await store.startEvent(ev.id);
    await Promise.all(Array.from({ length: 60 }, () => store.addPhoto(ev.id, fakePhoto())));
    const positions = store.listPhotos(ev.id).map((p) => p.position).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    // persistido em disco
    const { store: reopened } = await newStore((store as unknown as { dataDir: string }).dataDir);
    expect(reopened.listPhotos(ev.id)).toHaveLength(60);
  });

  it('ignora reenvio com o mesmo identificador do cliente (sem duplicar)', async () => {
    const { store } = await newStore();
    const ev = await store.createEvent({ name: 'Dup' });
    await store.startEvent(ev.id);
    const r1 = await store.addPhoto(ev.id, fakePhoto({ clientId: 'cliente-abc-123' }));
    const r2 = await store.addPhoto(ev.id, fakePhoto({ clientId: 'cliente-abc-123' }));
    expect(r2.duplicate).toBe(true);
    expect(r2.photo.id).toBe(r1.photo.id);
    expect(store.listPhotos(ev.id)).toHaveLength(1);
  });

  it('recupera estado após reinicialização: foto em exibição volta para a fila na mesma posição', async () => {
    const { store, dir } = await newStore();
    const ev = await store.createEvent({ name: 'Restart' });
    await store.startEvent(ev.id);
    const p1 = (await store.addPhoto(ev.id, fakePhoto())).photo;
    const p2 = (await store.addPhoto(ev.id, fakePhoto())).photo;
    const p3 = (await store.addPhoto(ev.id, fakePhoto())).photo;
    await store.markPlaying(ev.id, p1.id);
    await store.markDisplayed(ev.id, p1.id);
    await store.markPlaying(ev.id, p2.id); // "queda de energia" aqui

    const { store: after } = await newStore(dir);
    expect(after.getCurrentEvent()!.id).toBe(ev.id);
    expect(after.getPhoto(ev.id, p1.id)!.status).toBe('displayed');
    expect(after.getPhoto(ev.id, p2.id)!.status).toBe('queued');
    expect(after.nextQueued(ev.id)!.id).toBe(p2.id); // a interrompida é a próxima
    expect(after.getQueue(ev.id).map((p) => p.id)).toEqual([p2.id, p3.id]);
    // nova foto continua no final da fila
    const p4 = (await after.addPhoto(ev.id, fakePhoto())).photo;
    expect(p4.position).toBe(4);
  });

  it('recolocar na fila e priorizar mantêm posições únicas', async () => {
    const { store } = await newStore();
    const ev = await store.createEvent({ name: 'Ops' });
    await store.startEvent(ev.id);
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => store.addPhoto(ev.id, fakePhoto()).then((r) => r.photo)));
    await store.rejectPhoto(ev.id, a.id);
    await store.requeuePhoto(ev.id, a.id);
    expect(store.getQueue(ev.id).map((p) => p.id)).toEqual([b.id, c.id, a.id]);
    await store.prioritizePhoto(ev.id, c.id);
    expect(store.getQueue(ev.id).map((p) => p.id)).toEqual([c.id, b.id, a.id]);
    const positions = store.listPhotos(ev.id).map((p) => p.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('mudar o status move o arquivo sem alterar seu conteúdo', async () => {
    const { store } = await newStore();
    const ev = await store.createEvent({ name: 'Arquivos' });
    await store.startEvent(ev.id);
    const input = fakePhoto();
    const dir = store.eventDir(ev.id);
    fs.writeFileSync(path.join(dir, 'uploads', input.storedName), 'conteudo-original');
    const { photo } = await store.addPhoto(ev.id, input);
    await store.markPlaying(ev.id, photo.id);
    const displayed = await store.markDisplayed(ev.id, photo.id);
    expect(displayed.folder).toBe('displayed');
    expect(fs.readFileSync(store.photoFilePath(displayed), 'utf8')).toBe('conteudo-original');
    expect(fs.existsSync(path.join(dir, 'uploads', input.storedName))).toBe(false);
  });
});

describe('Limpeza', () => {
  it('nunca apaga eventos ativos e preserva estatísticas dos encerrados', async () => {
    const { store } = await newStore();
    const old = await store.createEvent({ name: 'Antigo' });
    await store.startEvent(old.id);
    await store.addPhoto(old.id, fakePhoto());
    await store.addPhoto(old.id, fakePhoto());
    const active = await store.createEvent({ name: 'Ativo' });
    await store.startEvent(active.id, { finishCurrent: true });
    await store.addPhoto(active.id, fakePhoto());

    const future = Date.now() + 49 * 3600_000;
    const expired = store.expiredEvents(48, future);
    expect(expired.map((e) => e.id)).toEqual([old.id]);
    expect(store.expiredEvents(48, Date.now())).toHaveLength(0); // ainda dentro do prazo

    await expect(store.purgeEvent(active.id, 'teste')).rejects.toMatchObject({ status: 409 });
    await store.purgeEvent(old.id, 'teste');
    expect(store.listPhotos(old.id)).toHaveLength(0);
    expect(store.stats(old.id).received).toBe(2);
    expect(store.listPhotos(active.id)).toHaveLength(1);
  });
});
