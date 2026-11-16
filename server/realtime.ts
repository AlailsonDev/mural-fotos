import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { Server as IOServer, type Namespace } from 'socket.io';
import type { Services } from './services';
import type { PhotoRecord, EventRecord } from '../lib/shared/types';
import { adminSession, displayAllowed, isAllowedOrigin } from './http/security';
import { displayStatus, publicStatus } from './http/app';
import { toPublicPhoto } from './store/playback';

/**
 * Comunicação em tempo real (Socket.IO), dividida em três canais isolados:
 *  - "/"        página pública: apenas estado do evento (nunca fotos de outras pessoas);
 *  - "/display" tela de transmissão autorizada;
 *  - "/admin"   painel administrativo autenticado.
 */
export function attachRealtime(server: HttpServer, svc: Services) {
  const io = new IOServer(server, {
    path: '/socket.io',
    serveClient: false,
    // Permite que o HMR do Next.js (modo desenvolvimento) use o mesmo servidor.
    destroyUpgrade: false,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req: IncomingMessage, cb) => {
      const ok = isAllowedOrigin(svc, req.headers.origin, req.headers.host);
      cb(ok ? null : 'Origem não permitida', ok);
    },
  });

  const pub = io.of('/');
  const display: Namespace = io.of('/display');
  const admin: Namespace = io.of('/admin');

  display.use((socket, next) => {
    if (displayAllowed(svc, socket.request)) return next();
    next(new Error('unauthorized'));
  });
  admin.use((socket, next) => {
    if (adminSession(svc, socket.request)) return next();
    next(new Error('unauthorized'));
  });

  pub.on('connection', (socket) => {
    socket.emit('system:status', publicStatus(svc));
  });

  display.on('connection', (socket) => {
    // Cada aba da tela de transmissão conta como "tela conectada".
    // Todas mostram exatamente o que o servidor determina – não há reprodução paralela.
    svc.engine.addDisplay(socket.id);
    socket.emit('system:status', displayStatus(svc));
    socket.on('state:request', () => socket.emit('system:status', displayStatus(svc)));
    socket.on('disconnect', () => svc.engine.removeDisplay(socket.id));
  });

  admin.on('connection', (socket) => {
    socket.emit('system:status', adminStatus());
    socket.on('state:request', () => socket.emit('system:status', adminStatus()));
  });

  const adminStatus = () => {
    const ev = svc.store.getCurrentEvent();
    return {
      playback: svc.engine.snapshot(),
      event: ev ? { ...ev, stats: svc.store.stats(ev.id) } : null,
    };
  };

  // --------------------------------------------------- difusão
  let statusTimer: NodeJS.Timeout | null = null;
  const pushStatus = () => {
    // Agrupa mudanças rápidas em uma única mensagem (eficiência).
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      display.emit('system:status', displayStatus(svc));
      admin.emit('system:status', adminStatus());
    }, 50);
  };

  svc.engine.on('broadcast', (name: string, payload: unknown) => {
    display.emit(name, payload);
    admin.emit(name, payload);
  });
  svc.engine.on('status', pushStatus);

  svc.store.on('photo', (p: PhotoRecord, action: string) => {
    const publicPhoto = toPublicPhoto(p);
    if (action === 'queued') {
      admin.emit('photo:uploaded', { photo: publicPhoto, position: p.position });
      admin.emit('photo:queued', { photo: publicPhoto, position: p.position });
      display.emit('photo:queued', { photoId: p.id, position: p.position });
    } else if (action === 'requeued' || action === 'prioritized') {
      admin.emit('photo:queued', { photo: publicPhoto, position: p.position });
    } else if (action === 'rejected') {
      admin.emit('photo:rejected', { photoId: p.id });
      display.emit('photo:rejected', { photoId: p.id });
    } else if (action === 'deleted') {
      admin.emit('photo:rejected', { photoId: p.id, deleted: true });
      display.emit('photo:rejected', { photoId: p.id, deleted: true });
    }
    pushStatus();
  });

  svc.store.on('event', (ev: EventRecord, action: string) => {
    const map: Record<string, string> = {
      started: 'event:started',
      resumed: 'event:started',
      paused: 'event:paused',
      finished: 'event:finished',
    };
    const name = map[action];
    const payload = { id: ev.id, name: ev.name, status: ev.status, action };
    if (name) {
      pub.emit(name, payload);
      display.emit(name, payload);
      admin.emit(name, payload);
    }
    admin.emit('events:changed', payload);
    pub.emit('system:status', publicStatus(svc));
    pushStatus();
  });

  return {
    io,
    notifySocket: (socketId: string, event: string, payload: unknown) => {
      pub.to(socketId).emit(event, payload);
    },
    settingsChanged: () => {
      pub.emit('system:status', publicStatus(svc));
      pushStatus();
    },
  };
}
