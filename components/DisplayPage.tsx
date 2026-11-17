'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Maximize, Minimize, Pause, Wifi, WifiOff, Images, KeyRound, Loader2, Camera } from 'lucide-react';
import type { DisplayStatus } from '@/lib/shared/types';
import { eventFontCss } from '@/lib/shared/fonts';
import { getFrame, type FrameDef } from '@/lib/shared/frames';
import { brandStyle, logoUrl } from '@/lib/client/api';

type Auth = 'checking' | 'ok' | 'need-key';
interface Slot {
  photoId: string | null;
  url: string | null;
  caption?: string;
}

export default function DisplayPage() {
  const [auth, setAuth] = useState<Auth>('checking');
  const [status, setStatus] = useState<DisplayStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [slots, setSlots] = useState<[Slot, Slot]>([
    { photoId: null, url: null },
    { photoId: null, url: null },
  ]);
  const [front, setFront] = useState(0);
  const [showingPhoto, setShowingPhoto] = useState(false);
  const [hideIndicators, setHideIndicators] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mouseActive, setMouseActive] = useState(true);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const offsetRef = useRef(0); // relógio do servidor - relógio local
  const socketRef = useRef<Socket | null>(null);
  const preloadRef = useRef<HTMLImageElement | null>(null);
  const pendingRef = useRef<string | null>(null);
  const frontRef = useRef(0);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  frontRef.current = front;

  // ------------------------------------------------ autenticação da tela
  const checkAuth = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('chave');
    if (key) {
      window.history.replaceState(null, '', window.location.pathname);
      const r = await fetch('/api/display/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      }).catch(() => null);
      if (r?.ok) return setAuth('ok');
    }
    const res = await fetch('/api/display/status', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) {
      setStatus(await res.json());
      setAuth('ok');
    } else if (res?.status === 401) setAuth('need-key');
    else setTimeout(checkAuth, 3000); // servidor indisponível: tenta de novo
  }, []);

  useEffect(() => {
    checkAuth();
    try {
      setHideIndicators(localStorage.getItem('mf_hide_indicators') === '1');
    } catch {
      /* armazenamento indisponível */
    }
  }, [checkAuth]);

  const submitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setKeyError(null);
    const r = await fetch('/api/display/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: keyInput.trim() }),
    }).catch(() => null);
    if (r?.ok) setAuth('ok');
    else setKeyError((await r?.json().catch(() => null))?.error || 'Não foi possível validar a chave.');
  };

  // ------------------------------------------------ tempo real
  useEffect(() => {
    if (auth !== 'ok') return;
    const s = io('/display', { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    socketRef.current = s;
    s.on('connect', () => {
      setConnected(true);
      s.emit('state:request'); // ao reconectar, sincroniza com o servidor (sem duplicar nada)
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (err) => {
      setConnected(false);
      if (err.message === 'unauthorized') {
        s.close();
        setAuth('need-key');
      }
    });
    s.on('system:status', (st: DisplayStatus) => {
      offsetRef.current = st.playback.serverNow - Date.now();
      setStatus(st);
    });
    return () => {
      s.close();
    };
  }, [auth]);

  // ------------------------------------------------ troca de fotos com transição
  const current = status?.playback.current ?? null;
  const currentId = current?.photo.id ?? null;
  const currentUrl = current?.photo.url ?? null;
  const currentCaption = current?.photo.caption ?? '';

  useEffect(() => {
    if (!currentId || !currentUrl) {
      setShowingPhoto(false);
      pendingRef.current = null;
      // Depois do fade-out, libera as imagens da memória.
      const t = setTimeout(() => {
        if (!pendingRef.current) setSlots([{ photoId: null, url: null }, { photoId: null, url: null }]);
      }, 2000);
      return () => clearTimeout(t);
    }
    const s = slotsRef.current;
    if (s[frontRef.current].photoId === currentId) {
      setShowingPhoto(true);
      return;
    }
    const back = frontRef.current === 0 ? 1 : 0;
    // Carrossel: a foto pode já estar carregada no outro slot (ex.: 2 fotos em loop). Nesse caso o
    // navegador não dispara "onLoad" de novo; então apenas trazemos esse slot para a frente.
    if (s[back].photoId === currentId && s[back].url === currentUrl) {
      pendingRef.current = null;
      setSlots((prev) => {
        const next: [Slot, Slot] = [{ ...prev[0] }, { ...prev[1] }];
        next[back] = { photoId: currentId, url: currentUrl, caption: currentCaption };
        return next;
      });
      setFront(back);
      setShowingPhoto(true);
      return;
    }
    pendingRef.current = currentId;
    setSlots((prev) => {
      const next: [Slot, Slot] = [{ ...prev[0] }, { ...prev[1] }];
      next[back] = { photoId: currentId, url: currentUrl, caption: currentCaption };
      return next;
    });
    // Proteção: se a imagem não sinalizar o carregamento, não deixa a tela travada na foto anterior.
    const guard = setTimeout(() => {
      if (pendingRef.current === currentId) {
        pendingRef.current = null;
        setFront(back);
        setShowingPhoto(true);
      }
    }, 6000);
    return () => clearTimeout(guard);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, currentUrl]);

  const onSlotLoaded = (idx: number) => {
    const slot = slotsRef.current[idx];
    if (slot.photoId && slot.photoId === pendingRef.current) {
      pendingRef.current = null;
      setFront(idx);
      setShowingPhoto(true);
    }
  };

  // Pré-carrega a próxima foto da fila (troca instantânea quando chegar a vez).
  const upcomingUrl = status?.playback.upcoming?.url;
  useEffect(() => {
    if (!upcomingUrl) {
      preloadRef.current = null;
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = upcomingUrl;
    preloadRef.current = img; // apenas uma referência: imagens antigas são descartadas
  }, [upcomingUrl]);

  // Barra de progresso
  useEffect(() => {
    if (!current?.endsAt) return;
    const t = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [current?.endsAt]);

  // ------------------------------------------------ tela cheia, teclado, cursor, tela sempre ligada
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'i' || e.key === 'I') {
        setHideIndicators((h) => {
          try {
            localStorage.setItem('mf_hide_indicators', h ? '0' : '1');
          } catch {
            /* ignora */
          }
          return !h;
        });
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setMouseActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setMouseActive(false), 2500);
    };
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousemove', onMove);
    onMove();
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousemove', onMove);
      clearTimeout(timer);
    };
  }, [toggleFullscreen]);

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        lock = (await nav.wakeLock?.request('screen')) ?? null;
      } catch {
        /* não suportado */
      }
    };
    request();
    const onVis = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => undefined);
    };
  }, []);

  // ------------------------------------------------ renderização
  if (auth === 'checking') {
    return (
      <div className="grid h-dvh place-items-center bg-black text-white/60">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (auth === 'need-key') {
    return (
      <div className="grid h-dvh place-items-center bg-[#07070c] p-6 text-white">
        <form onSubmit={submitKey} className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
          <KeyRound className="mx-auto mb-4 h-10 w-10 text-violet-300" />
          <h1 className="mb-2 text-xl font-bold">Tela de transmissão</h1>
          <p className="mb-6 text-sm text-white/60">
            Abra esta tela pelo painel administrativo (botão “Abrir tela de transmissão”) ou informe a chave de transmissão exibida no painel.
          </p>
          <input
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Chave de transmissão"
            className="mb-3 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-center outline-none focus:border-violet-400"
          />
          {keyError && <p className="mb-3 text-sm text-rose-300">{keyError}</p>}
          <button className="w-full rounded-xl bg-violet-600 py-3 font-semibold hover:bg-violet-500">Entrar</button>
          <a href="/admin" className="mt-4 block text-sm text-white/50 underline-offset-4 hover:underline">
            Ir para o painel administrativo
          </a>
        </form>
      </div>
    );
  }

  const pb = status?.playback;
  const transitionMs = status?.transitionMs ?? 1200;
  const showIndicators = !!status?.showIndicators && !hideIndicators;
  const now = Date.now() + offsetRef.current;
  const progress =
    current && current.endsAt
      ? Math.min(1, Math.max(0, 1 - (current.endsAt - now) / (current.displayMs + current.transitionMs)))
      : current
        ? Math.min(1, Math.max(0, 1 - current.remainingMs / (current.displayMs + current.transitionMs)))
        : 0;
  const waiting = !showingPhoto;
  const logo = logoUrl(status?.branding);
  const frame = getFrame(status?.branding?.frame);

  return (
    <div
      style={brandStyle(status?.branding)}
      className={`relative h-dvh w-screen select-none overflow-hidden bg-[#050507] text-white ${!mouseActive ? 'no-cursor' : ''}`}
      onDoubleClick={toggleFullscreen}
    >
      {/* Painel lateral: QR Code sempre visível ao lado da foto em destaque */}
      <aside className="absolute inset-y-0 right-0 z-[5] flex w-[28%] flex-col items-center justify-center gap-[3vmin] border-l border-white/10 bg-[#07070c] px-[2.5vmin] text-center">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="relative h-[16vmin] w-auto max-w-full object-contain" />
        )}
        {status?.event && <h2 className="relative text-[4.4vmin] font-extrabold leading-tight" style={{ fontFamily: eventFontCss(status.event.nameFont) }}>{status.event.name}</h2>}
        {status?.qrUrl && (
          <div className="relative flex flex-col items-center">
            <div className="rounded-[2.4vmin] bg-white p-[1.8vmin] shadow-2xl shadow-black/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/qr.svg?size=800&v=${encodeURIComponent(status.qrUrl)}`} alt="QR Code" className="aspect-square w-[min(24vw,60vmin)]" />
            </div>
            <p className="mt-[2vmin] text-[2.4vmin] font-semibold leading-snug text-white/90">Escaneie e envie sua foto!</p>
            <p className="mt-[1vmin] max-w-full break-all text-[1.6vmin] text-white/40">{status.qrUrl.replace(/\/$/, '')}</p>
          </div>
        )}
      </aside>

      {/* Camadas de fotos (duas, alternadas, para transição cruzada suave) */}
      <div className="absolute inset-y-0 left-0 w-[72%] overflow-hidden">
      <div className="absolute overflow-hidden" style={{ inset: `${frame.inset}vmin` }}>
      {slots.map((slot, idx) => {
        const visible = showingPhoto && idx === front && !!slot.url;
        return (
          <div
            key={idx}
            className="stage-layer"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'scale(1)' : 'scale(1.015)',
              transitionDuration: `${transitionMs}ms`,
              zIndex: idx === front ? 2 : 1,
            }}
          >
            {slot.url && (
              <>
                {status?.blurBackground && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-3xl" />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slot.url}
                  alt=""
                  decoding="async"
                  onLoad={() => onSlotLoaded(idx)}
                  onError={() => onSlotLoaded(idx)}
                  className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_20px_60px_rgba(0,0,0,0.6)]"
                />
                {slot.caption && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-[3vmin] pb-[4vmin] pt-[14vmin] bg-gradient-to-t from-black/75 via-black/40 to-transparent">
                    <p
                      className="caption-script max-w-[92%] text-center text-white"
                      style={{ fontSize: slot.caption.length > 90 ? '4.6vmin' : slot.caption.length > 45 ? '5.6vmin' : '7vmin' }}
                    >
                      {slot.caption}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      </div>
      <FrameOverlay frame={frame} />
      </div>

      {/* Tela de espera */}
      <div
        className="stage-layer z-10 flex items-center justify-center"
        style={{ opacity: waiting ? 1 : 0, transitionDuration: '900ms', pointerEvents: waiting ? 'auto' : 'none' }}
      >
        <WaitingScreen status={status} connected={connected} logo={logo} />
        <FrameOverlay frame={frame} />
      </div>

      {/* Indicadores discretos */}
      {showIndicators && (
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-md">
          <span className="flex items-center gap-1.5" title="Fotos aguardando">
            <Images className="h-3.5 w-3.5" /> {pb?.queueCount ?? 0}
          </span>
          <span className="h-3 w-px bg-white/20" />
          {pb?.effective === 'paused' && (
            <>
              <span className="flex items-center gap-1 text-amber-300">
                <Pause className="h-3.5 w-3.5" /> Pausado
              </span>
              <span className="h-3 w-px bg-white/20" />
            </>
          )}
          {pb?.effective === 'stopped' && (
            <>
              <span className="text-amber-300">Parada</span>
              <span className="h-3 w-px bg-white/20" />
            </>
          )}
          <span className={`flex items-center gap-1 ${connected ? 'text-emerald-300' : 'text-rose-300'}`}>
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {connected ? 'Online' : 'Reconectando'}
          </span>
        </div>
      )}
      {showIndicators && showingPhoto && current && (
        <div className="absolute inset-x-0 bottom-0 z-20 h-[3px] bg-white/5">
          <div className="h-full bg-white/40 transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {!connected && !showIndicators && (
        <div className="absolute right-4 top-4 z-20 h-2.5 w-2.5 rounded-full bg-rose-500" title="Reconectando" />
      )}

      {/* Botão de tela cheia (aparece ao mover o mouse) */}
      <button
        onClick={toggleFullscreen}
        className="absolute right-4 top-4 z-30 flex items-center gap-2 rounded-full bg-black/50 px-4 py-2 text-sm font-medium backdrop-blur transition-opacity duration-500 hover:bg-black/70"
        style={{ opacity: mouseActive ? 1 : 0, pointerEvents: mouseActive ? 'auto' : 'none' }}
      >
        {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        {isFullscreen ? 'Sair da tela cheia' : 'Tela cheia (F)'}
      </button>
      <div
        className="absolute left-4 top-4 z-30 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/60 backdrop-blur transition-opacity duration-500"
        style={{ opacity: mouseActive ? 1 : 0 }}
      >
        F: tela cheia · I: indicadores · duplo clique: tela cheia
      </div>
    </div>
  );
}

function FrameOverlay({ frame }: { frame: FrameDef }) {
  if (!frame.inset) return null;
  return <div aria-hidden className="pointer-events-none absolute inset-0 z-[6] box-border" style={frame.css(`${frame.inset}vmin`) as React.CSSProperties} />;
}

const INVITE = 'Escaneie o QR Code e envie sua foto para aparecer no telão!';

function WaitingScreen({ status, connected, logo }: { status: DisplayStatus | null; connected: boolean; logo: string | null }) {
  const b = status?.branding;
  const ev = status?.event;
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#07070c]">
      <div className="relative z-10 flex w-full max-w-[1500px] flex-col items-center gap-[5vmin] px-[6vmin] lg:flex-row lg:justify-between">
        <div className="max-w-[55vw] text-center lg:text-left">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="mx-auto mb-[3vmin] h-[22vmin] w-auto max-w-[50vw] object-contain lg:mx-0" />
          ) : (
            <div className="mx-auto mb-[3vmin] grid h-[10vmin] w-[10vmin] place-items-center rounded-[2.5vmin] bg-white/10 ring-1 ring-white/15 lg:mx-0">
              <Camera className="h-[5vmin] w-[5vmin]" />
            </div>
          )}
          <p className="mb-[1.5vmin] text-[2.2vmin] font-semibold uppercase tracking-[0.3em] text-white/50">{b?.systemName || 'Mural de Fotos'}</p>
          <h1 className="mb-[3vmin] text-[7vmin] font-extrabold leading-[1.05]">
            {ev ? <span style={{ fontFamily: eventFontCss(ev.nameFont) }}>{ev.name}</span> : 'Em breve'}
          </h1>
          <p className="text-[3.4vmin] font-medium leading-snug text-white/85">
            {ev ? b?.waitingMessage || INVITE : 'Nenhum evento recebendo fotografias no momento.'}
          </p>
          {ev && b?.waitingMessage?.trim() !== INVITE && (
            <p className="mt-[2vmin] text-[2.6vmin] text-white/60">{INVITE}</p>
          )}
        </div>
        {status?.qrUrl && (
          <div className="flex flex-col items-center animate-float">
            <div className="rounded-[3vmin] bg-white p-[2.2vmin] shadow-2xl shadow-black/60 pulse-ring">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/qr.svg?size=800&v=${encodeURIComponent(status.qrUrl)}`} alt="QR Code" className="h-[40vmin] w-[40vmin]" />
            </div>
            <p className="mt-[2.5vmin] max-w-[45vmin] break-all text-center text-[2vmin] text-white/50">{status.qrUrl.replace(/\/$/, '')}</p>
          </div>
        )}
      </div>
      <div className="absolute bottom-[3vmin] left-1/2 flex -translate-x-1/2 items-center gap-2 text-[1.8vmin] text-white/45">
        <span className={`h-[1.2vmin] w-[1.2vmin] rounded-full ${connected ? 'bg-emerald-400' : 'animate-pulse bg-rose-500'}`} />
        {connected ? 'Conectado – aguardando fotos' : 'Reconectando ao servidor...'}
      </div>
    </div>
  );
}
