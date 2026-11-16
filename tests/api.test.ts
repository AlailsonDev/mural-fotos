import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { io as ioClient } from 'socket.io-client';
import { startTestServer, adminAgent, makeJpeg, makePng, activeEvent, setFastPlayback, waitFor, type TestServer } from './helpers';

let ts: TestServer;
beforeAll(async () => {
  ts = await startTestServer();
});
afterAll(async () => {
  await ts.close();
});

const upload = (files: { buf: Buffer; name: string; type?: string; clientId?: string }[], headers: Record<string, string> = {}) => {
  let req = request(ts.server).post('/api/public/upload');
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  req = req.field('meta', JSON.stringify(files.map((f, i) => ({ clientId: f.clientId || `cliente-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`, name: f.name }))));
  for (const f of files) req = req.attach('photos', f.buf, { filename: f.name, contentType: f.type || 'image/jpeg' });
  return req;
};

describe('Segurança e autenticação', () => {
  it('bloqueia a administração para usuários não autenticados', async () => {
    await request(ts.server).get('/api/admin/overview').expect(401);
    await request(ts.server).get('/api/admin/settings').expect(401);
    await request(ts.server).post('/api/admin/events').send({ name: 'x' }).expect(401);
    await request(ts.server).post('/api/admin/transmission/skip').expect(401);
    await request(ts.server).get('/api/display/status').expect(401);
  });

  it('recusa senha incorreta e exige token CSRF nas alterações', async () => {
    await request(ts.server).post('/api/admin/login').send({ password: 'errada' }).expect(401);
    const { agent, csrf } = await adminAgent(ts.server);
    await agent.get('/api/admin/overview').expect(200);
    await agent.post('/api/admin/events').send({ name: 'Sem CSRF' }).expect(403);
    await agent.post('/api/admin/events').set('X-CSRF-Token', 'falso').send({ name: 'CSRF falso' }).expect(403);
    await agent.post('/api/admin/events').set('X-CSRF-Token', csrf).set('Origin', 'https://site-malicioso.example').send({ name: 'Origem ruim' }).expect(403);
    const ok = await agent.post('/api/admin/events').set('X-CSRF-Token', csrf).send({ name: 'Com CSRF' }).expect(201);
    expect(ok.body.status).toBe('planned');
  });

  it('não expõe arquivos internos nem permite path traversal', async () => {
    await request(ts.server).get('/media/..%2F..%2Fconfig/settings.json').expect(404);
    await request(ts.server).get('/media/nao-e-uuid/outro').expect(404);
    await request(ts.server).get('/data/config/settings.json').expect(404);
    const res = await request(ts.server).get('/api/public/status').expect(200);
    expect(JSON.stringify(res.body)).not.toMatch(/displayKey|passwordHash|sessionVersion|[A-Z]:\\\\/);
  });
});

describe('Envio de fotografias', () => {
  it('informa quando não há evento recebendo fotos', async () => {
    const { agent, csrf } = await adminAgent(ts.server);
    const cur = ts.svc.store.getCurrentEvent();
    if (cur) await agent.post(`/api/admin/events/${cur.id}/finish`).set('X-CSRF-Token', csrf).expect(200);
    const st = await request(ts.server).get('/api/public/status').expect(200);
    expect(st.body.state).toBe('closed');
    const res = await upload([{ buf: await makeJpeg(), name: 'a.jpg' }]);
    expect(res.status).toBe(409);
  });

  it('aceita uma foto, processa com Sharp e remove metadados EXIF', async () => {
    const ev = await activeEvent(ts.svc, 'Upload simples');
    const res = await upload([{ buf: await makeJpeg(4000, 3000, undefined, true), name: 'IMG_0001.JPG' }]).expect(200);
    expect(res.body.accepted).toHaveLength(1);
    expect(res.body.message).toContain('recebidas com sucesso');
    const photo = ts.svc.store.getPhoto(ev.id, res.body.accepted[0].photoId)!;
    expect(photo.status).toBe('queued');
    expect(photo.position).toBe(1);
    // orientação EXIF 6 aplicada (rotacionada 90°) e redimensionada para no máx. 2560 px
    expect(photo.width).toBeLessThan(photo.height);
    expect(Math.max(photo.width, photo.height)).toBeLessThanOrEqual(2560);
    const file = ts.svc.store.photoFilePath(photo);
    expect(fs.existsSync(file)).toBe(true);
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(photo.storedName).toMatch(/^[0-9a-f-]{36}\.webp$/); // nome UUID, nunca o nome original
  });

  it('aceita três fotos de uma vez e respeita o limite por envio', async () => {
    const ev = await activeEvent(ts.svc, 'Três fotos');
    const three = await upload([
      { buf: await makeJpeg(), name: '1.jpg' },
      { buf: await makePng(), name: '2.png', type: 'image/png' },
      { buf: await sharp({ create: { width: 500, height: 500, channels: 3, background: '#0f0' } }).webp().toBuffer(), name: '3.webp', type: 'image/webp' },
    ]).expect(200);
    expect(three.body.accepted).toHaveLength(3);
    const jpeg = await makeJpeg(300, 300);
    const res = await upload([1, 2, 3, 4].map((i) => ({ buf: jpeg, name: `${i}.jpg` })));
    expect(res.body.accepted).toHaveLength(3);
    expect(res.body.rejected.some((r: { reason: string }) => /Máximo de 3/.test(r.reason))).toBe(true);
    expect(ts.svc.store.listPhotos(ev.id)).toHaveLength(6);
  });

  it('rejeita arquivos inválidos (conteúdo real verificado, não a extensão)', async () => {
    await activeEvent(ts.svc, 'Inválidos');
    const fake = Buffer.from('isto não é uma imagem, apenas texto com extensão .jpg'.repeat(10));
    const res = await upload([{ buf: fake, name: 'falsa.jpg' }]);
    expect(res.status).toBe(422);
    expect(res.body.rejected[0].reason).toMatch(/não é uma imagem|Formato/);
    const gif = Buffer.from('GIF89a' + 'x'.repeat(100));
    const res2 = await upload([{ buf: gif, name: 'animado.gif', type: 'image/gif' }]);
    expect(res2.status).toBe(422);
    // JPEG truncado/corrompido
    const jpeg = await makeJpeg();
    const res3 = await upload([{ buf: jpeg.subarray(0, 200), name: 'cortada.jpg' }]);
    expect(res3.status).toBe(422);
  });

  it('respeita o tamanho máximo configurado', async () => {
    await activeEvent(ts.svc, 'Tamanho');
    await ts.svc.settings.update({ maxFileSizeMB: 1 });
    const noisy = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
      .jpeg({ quality: 100 })
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(1024 * 1024);
    const res = await upload([{ buf: noisy, name: 'grande.jpg' }, { buf: await makeJpeg(200, 200), name: 'pequena.jpg' }]);
    expect(res.body.accepted).toHaveLength(1);
    expect(res.body.rejected[0].reason).toMatch(/Maior que 1 MB/);
    // envio muito acima do limite é recusado antes de ser lido, com mensagem amigável
    const huge = await upload([{ buf: Buffer.concat([noisy, noisy, noisy]), name: 'enorme.jpg' }]);
    expect(huge.status).toBe(413);
    expect(huge.body.error).toMatch(/limite/);
    await ts.svc.settings.update({ maxFileSizeMB: 10 });
  });

  it('não duplica fotos reenviadas após falha de conexão', async () => {
    const ev = await activeEvent(ts.svc, 'Reenvio');
    const jpeg = await makeJpeg(400, 400);
    const files = [{ buf: jpeg, name: 'x.jpg', clientId: 'reenvio-cliente-0001' }];
    const r1 = await upload(files).expect(200);
    const r2 = await upload(files).expect(200);
    expect(r2.body.accepted[0].duplicate).toBe(true);
    expect(r2.body.accepted[0].photoId).toBe(r1.body.accepted[0].photoId);
    expect(ts.svc.store.listPhotos(ev.id)).toHaveLength(1);
  });

  it('mantém a ordem e posições únicas com vários celulares enviando ao mesmo tempo', async () => {
    const ev = await activeEvent(ts.svc, 'Simultâneo');
    const jpeg = await makeJpeg(800, 600);
    const results = await Promise.all(Array.from({ length: 12 }, () => upload([{ buf: jpeg, name: 'a.jpg' }, { buf: jpeg, name: 'b.jpg' }])));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const photos = ts.svc.store.listPhotos(ev.id);
    expect(photos).toHaveLength(24);
    const positions = photos.map((p) => p.position).sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(new Set(photos.map((p) => p.storedName)).size).toBe(24); // nenhum arquivo sobrescrito
    for (const p of photos) expect(fs.existsSync(ts.svc.store.photoFilePath(p))).toBe(true);
  });

  it('aplica rate limiting por IP', async () => {
    await activeEvent(ts.svc, 'Rate limit');
    await ts.svc.settings.update({ uploadRateLimitPerIp: 3 });
    const jpeg = await makeJpeg(100, 100);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await upload([{ buf: jpeg, name: 'r.jpg' }])).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    await ts.svc.settings.update({ uploadRateLimitPerIp: 1000 });
  });
});

describe('Administração de fotografias e eventos', () => {
  it('rejeita, recoloca na fila e exclui fotografias', async () => {
    const ev = await activeEvent(ts.svc, 'Admin fotos');
    const { agent, csrf } = await adminAgent(ts.server);
    const resUp = await upload([{ buf: await makeJpeg(300, 300), name: 'a.jpg' }]).expect(200);
    const photoId = resUp.body.accepted[0].photoId as string;
    await agent.post(`/api/admin/photos/${ev.id}/${photoId}/reject`).set('X-CSRF-Token', csrf).expect(200);
    expect(ts.svc.store.getPhoto(ev.id, photoId)!.status).toBe('rejected');
    await agent.post(`/api/admin/photos/${ev.id}/${photoId}/requeue`).set('X-CSRF-Token', csrf).expect(200);
    expect(ts.svc.store.getPhoto(ev.id, photoId)!.status).toBe('queued');
    const file = ts.svc.store.photoFilePath(ts.svc.store.getPhoto(ev.id, photoId)!);
    await agent.delete(`/api/admin/photos/${ev.id}/${photoId}`).set('X-CSRF-Token', csrf).expect(200);
    expect(ts.svc.store.getPhoto(ev.id, photoId)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('exige confirmação para limpar e mantém estatísticas', async () => {
    const ev = await activeEvent(ts.svc, 'Encerrar e limpar');
    const { agent, csrf } = await adminAgent(ts.server);
    await agent.post(`/api/admin/events/${ev.id}/finish-and-purge`).set('X-CSRF-Token', csrf).send({}).expect(400);
    const r = await agent.post(`/api/admin/events/${ev.id}/finish-and-purge`).set('X-CSRF-Token', csrf).send({ confirm: 'LIMPAR' }).expect(200);
    expect(r.body.status).toBe('finished');
    expect(r.body.purgedAt).toBeTruthy();
  });

  it('o QR Code é o mesmo em eventos diferentes', async () => {
    const { agent, csrf } = await adminAgent(ts.server);
    const q1 = (await agent.get('/api/admin/network').expect(200)).body.qr.url;
    const png1 = (await request(ts.server).get('/api/qr.png').expect(200).expect('Content-Type', /png/)).body as Buffer;
    const created = await agent.post('/api/admin/events').set('X-CSRF-Token', csrf).send({ name: 'Outro evento', startNow: true, finishCurrent: true }).expect(201);
    expect(created.body.status).toBe('active');
    const q2 = (await agent.get('/api/admin/network').expect(200)).body.qr.url;
    const png2 = (await request(ts.server).get('/api/qr.png').expect(200)).body as Buffer;
    expect(q2).toBe(q1);
    expect(Buffer.compare(png1, png2)).toBe(0);
    const svg = await request(ts.server).get('/api/qr.svg').expect(200).expect('Content-Type', /svg/);
    expect(String(svg.text || svg.body)).toContain('<svg');
  });
});

describe('Download de todas as fotos (.zip)', () => {
  it('exige administrador e entrega um zip com todas as fotos do evento', async () => {
    const ev = await activeEvent(ts.svc, 'Evento do zip');
    await request(ts.server).get(`/api/admin/events/${ev.id}/photos.zip`).expect(401);
    const { agent } = await adminAgent(ts.server);
    await agent.get(`/api/admin/events/${ev.id}/photos.zip`).expect(404); // ainda sem fotos
    const jpeg = await makeJpeg(200, 200);
    await upload([{ buf: jpeg, name: 'um.jpg' }, { buf: jpeg, name: 'dois.jpg' }, { buf: jpeg, name: 'tres.jpg' }]).expect(200);
    const res = await agent
      .get(`/api/admin/events/${ev.id}/photos.zip`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200)
      .expect('Content-Type', /zip/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="fotos-.*\.zip"/);
    const buf = res.body as Buffer;
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    // 3 entradas no diretório central do zip
    let entries = 0;
    for (let i = 0; i < buf.length - 4; i++) if (buf.readUInt32LE(i) === 0x02014b50) entries++;
    expect(entries).toBe(3);
  });
});

describe('Tempo real (Socket.IO) e tela de transmissão', () => {
  it('a tela autorizada recebe as fotos em tempo real e reconecta sem duplicar', async () => {
    setFastPlayback(ts.svc, 0.3);
    const ev = await activeEvent(ts.svc, 'Tempo real');
    // autoriza a tela pela chave de transmissão
    const key = ts.svc.settings.internal.displayKey;
    await request(ts.server).post('/api/display/session').send({ key: 'errada' }).expect(401);
    const auth = await request(ts.server).post('/api/display/session').send({ key }).expect(200);
    const cookie = ([] as string[]).concat(auth.headers['set-cookie']).find((c) => c.startsWith('mf_display='))!.split(';')[0];

    // socket sem autorização é recusado
    const intruder = ioClient(`${ts.baseUrl}/display`, { transports: ['websocket'], reconnection: false });
    const refused = await new Promise<string>((resolve) => intruder.on('connect_error', (e) => resolve(e.message)));
    expect(refused).toBe('unauthorized');
    intruder.close();

    const playing: string[] = [];
    const sock = ioClient(`${ts.baseUrl}/display`, { transports: ['websocket'], extraHeaders: { Cookie: cookie } });
    sock.on('photo:playing', (p: { photo: { id: string } }) => playing.push(p.photo.id));
    await new Promise<void>((r) => sock.on('connect', () => r()));

    const jpeg = await makeJpeg(300, 300);
    await upload([{ buf: jpeg, name: 'a.jpg' }, { buf: jpeg, name: 'b.jpg' }]).expect(200);
    await waitFor(() => playing.length >= 1, 5000);

    // queda de conexão e retorno
    sock.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    sock.connect();
    await waitFor(() => playing.length >= 4, 8000);
    // carrossel: as fotos se repetem em ciclos, mas a reconexão nunca duplica a mesma foto em sequência
    for (let i = 1; i < playing.length; i++) expect(playing[i]).not.toBe(playing[i - 1]);
    expect(ts.svc.store.stats(ev.id).received).toBe(2);

    // a mídia exige autorização
    const p = ts.svc.store.listPhotos(ev.id)[0];
    await request(ts.server).get(`/media/${ev.id}/${p.id}`).expect(401);
    await request(ts.server).get(`/media/${ev.id}/${p.id}`).set('Cookie', cookie).expect(200);
    sock.close();
  });
});
