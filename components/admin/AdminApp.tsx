'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  LayoutDashboard,
  CalendarDays,
  Images,
  MonitorPlay,
  QrCode,
  Settings as SettingsIcon,
  History,
  LogOut,
  Menu,
  X,
  Lock,
  Camera,
  Wifi,
  WifiOff,
  Eye,
  EyeOff,
  Palette,
  Check,
} from 'lucide-react';
import { api, setCsrfToken, ApiError, brandStyle } from '@/lib/client/api';
import type { EventRecord, EventStats, PlaybackSnapshot } from '@/lib/shared/types';
import { ADMIN_THEMES, applyTheme, getTheme, loadThemeId, saveThemeId } from '@/lib/client/themes';
import { ConfirmProvider, ToastProvider, Spinner, Modal } from './ui';
import Dashboard from './sections/Dashboard';
import EventsSection from './sections/Events';
import PhotosSection from './sections/Photos';
import TransmissionSection from './sections/Transmission';
import QrSection from './sections/QrSection';
import SettingsSection from './sections/SettingsSection';
import HistorySection from './sections/History';

export type EventWithStats = EventRecord & { stats: EventStats };
export interface LiveState {
  playback: PlaybackSnapshot | null;
  event: EventWithStats | null;
  connected: boolean;
  /** Incrementado a cada mudança relevante recebida em tempo real (para recarregar listas). */
  version: number;
}
export type SectionId = 'dashboard' | 'eventos' | 'fotos' | 'transmissao' | 'qrcode' | 'configuracoes' | 'historico';

const NAV: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'eventos', label: 'Eventos', icon: CalendarDays },
  { id: 'fotos', label: 'Fotografias', icon: Images },
  { id: 'transmissao', label: 'Transmissão', icon: MonitorPlay },
  { id: 'qrcode', label: 'QR Code', icon: QrCode },
  { id: 'configuracoes', label: 'Configurações', icon: SettingsIcon },
  { id: 'historico', label: 'Histórico', icon: History },
];

export default function AdminApp() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AdminGate />
      </ConfirmProvider>
    </ToastProvider>
  );
}

function AdminGate() {
  const [state, setState] = useState<'loading' | 'login' | 'ok'>('loading');
  const [passwordConfigured, setPasswordConfigured] = useState(true);

  const check = useCallback(async () => {
    try {
      const s = await api<{ authenticated: boolean; csrfToken: string | null; passwordConfigured: boolean }>('/api/admin/session');
      setPasswordConfigured(s.passwordConfigured);
      setCsrfToken(s.csrfToken);
      setState(s.authenticated ? 'ok' : 'login');
    } catch {
      setState('login');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (state === 'loading')
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 text-slate-400">
        <Spinner className="h-8 w-8" />
      </div>
    );
  if (state === 'login') return <Login passwordConfigured={passwordConfigured} onDone={() => setState('ok')} />;
  return <AdminShell onLogout={() => setState('login')} />;
}

function Login({ passwordConfigured, onDone }: { passwordConfigured: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrfToken: string }>('/api/admin/login', { method: 'POST', json: { password } });
      setCsrfToken(r.csrfToken);
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={brandStyle(null)} className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#0b0b12] p-4">
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-8 text-white shadow-2xl animate-pop">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-white ring-1 ring-white/15 shadow-lg">
            <Lock className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold text-white">Painel administrativo</h1>
          <p className="mt-1 text-sm text-white/50">Mural de Fotos</p>
        </div>
        {!passwordConfigured ? (
          <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            A senha administrativa ainda não foi configurada. No computador do servidor, abra o terminal na pasta do projeto e execute:
            <code className="mt-2 block rounded-lg bg-amber-100 px-2 py-1.5 font-mono text-xs">npm run set-password</code>
            Depois reinicie o servidor (start.bat).
          </div>
        ) : (
          <>
            <label className="mb-1.5 block text-sm font-medium text-white/70" htmlFor="pw">
              Senha
            </label>
            <div className="relative">
              <input
                id="pw"
                type={show ? 'text' : 'password'}
                autoFocus
                autoComplete="current-password"
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 pr-10 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/40 focus:ring-4 focus:ring-white/10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-white/40 hover:text-white" aria-label="Mostrar senha">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
            <button className="btn mt-5 w-full bg-white py-3 text-slate-900 hover:bg-white/90" disabled={busy || !password}>
              {busy ? <Spinner className="h-4 w-4" /> : null} Entrar
            </button>
          </>
        )}
      </form>
    </main>
  );
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<SectionId>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [live, setLive] = useState<LiveState>({ playback: null, event: null, connected: false, version: 0 });
  const socketRef = useRef<Socket | null>(null);
  const [themeId, setThemeId] = useState<string>(() => loadThemeId());
  const [themeOpen, setThemeOpen] = useState(false);

  useEffect(() => applyTheme(getTheme(themeId)), [themeId]);

  const chooseTheme = (id: string) => {
    setThemeId(id);
    saveThemeId(id);
  };

  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '') as SectionId;
    if (NAV.some((n) => n.id === fromHash)) setSection(fromHash);
    const onHash = () => {
      const h = window.location.hash.replace('#', '') as SectionId;
      if (NAV.some((n) => n.id === h)) setSection(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const s = io('/admin', { transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    socketRef.current = s;
    const bump = () => setLive((l) => ({ ...l, version: l.version + 1 }));
    s.on('connect', () => {
      setLive((l) => ({ ...l, connected: true }));
      s.emit('state:request');
      bump();
    });
    s.on('disconnect', () => setLive((l) => ({ ...l, connected: false })));
    s.on('connect_error', (err) => {
      setLive((l) => ({ ...l, connected: false }));
      if (err.message === 'unauthorized') {
        s.close();
        onLogout();
      }
    });
    s.on('system:status', (st: { playback: PlaybackSnapshot; event: EventWithStats | null }) =>
      setLive((l) => ({ ...l, playback: st.playback, event: st.event })),
    );
    for (const ev of ['photo:uploaded', 'photo:rejected', 'photo:queued', 'photo:displayed', 'photo:playing', 'events:changed']) s.on(ev, bump);
    return () => {
      s.close();
    };
  }, [onLogout]);

  const go = (id: SectionId) => {
    setSection(id);
    setMenuOpen(false);
    window.history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: 0 });
  };

  const logout = async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => undefined);
    setCsrfToken(null);
    onLogout();
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = section === n.id;
        return (
          <button
            key={n.id}
            onClick={() => go(n.id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active ? 'bg-white/10 text-white' : 'text-[#94a3b8] hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            {n.label}
            {n.id === 'transmissao' && live.playback?.effective === 'playing' && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />}
          </button>
        );
      })}
    </nav>
  );

  const sidebarFooter = (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
      <div className="flex items-center gap-2 px-3 text-xs text-[#94a3b8]">
        {live.connected ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-rose-400" />}
        {live.connected ? 'Tempo real conectado' : 'Reconectando...'}
      </div>
      <button onClick={() => setThemeOpen(true)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#94a3b8] hover:bg-white/5 hover:text-white">
        <Palette className="h-[18px] w-[18px]" /> Tema
        <span className="ml-auto h-3.5 w-3.5 rounded-full ring-2 ring-white/30 brand-gradient" />
      </button>
      <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#94a3b8] hover:bg-white/5 hover:text-white">
        <LogOut className="h-[18px] w-[18px]" /> Sair
      </button>
    </div>
  );

  const brand = (
    <div className="mb-8 flex items-center gap-3 px-2">
      <div className="grid h-10 w-10 place-items-center rounded-xl brand-gradient text-white shadow-lg">
        <Camera className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm font-bold text-white">Mural de Fotos</div>
        <div className="text-xs text-[#94a3b8]">Administração</div>
      </div>
    </div>
  );

  const props = { live, go };

  return (
    <div className="min-h-dvh bg-[var(--page,#f8fafc)] text-slate-900">
      {/* Barra lateral (desktop) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-[var(--side,#0f0f1a)] p-4 lg:flex">
        {brand}
        {nav}
        {sidebarFooter}
      </aside>

      {/* Barra superior (celular) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 font-bold">
          <div className="grid h-8 w-8 place-items-center rounded-lg brand-gradient text-white">
            <Camera className="h-4 w-4" />
          </div>
          {NAV.find((n) => n.id === section)?.label}
        </div>
        <button onClick={() => setMenuOpen(true)} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Abrir menu">
          <Menu className="h-5 w-5" />
        </button>
      </header>
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-[var(--side,#0f0f1a)] p-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setMenuOpen(false)} className="absolute right-3 top-3 rounded-lg p-2 text-[#94a3b8] hover:text-white" aria-label="Fechar menu">
              <X className="h-5 w-5" />
            </button>
            {brand}
            {nav}
            {sidebarFooter}
          </aside>
        </div>
      )}

      <Modal open={themeOpen} onClose={() => setThemeOpen(false)} title="Tema do sistema" wide>
        <p className="mb-4 text-sm text-slate-500">Escolha as cores do painel. A escolha fica salva neste navegador e é lembrada nas próximas vezes.</p>
        {(['light', 'dark'] as const).map((mode) => (
          <div key={mode} className="mb-5 last:mb-0">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{mode === 'light' ? 'Claros' : 'Escuros'}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ADMIN_THEMES.filter((t) => t.mode === mode).map((t) => {
                const on = t.id === themeId;
                return (
                  <button
                    key={t.id}
                    onClick={() => chooseTheme(t.id)}
                    aria-pressed={on}
                    className={`group rounded-2xl border p-2 text-left transition ${on ? 'border-violet-500 ring-2 ring-violet-200' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <div className="flex h-16 overflow-hidden rounded-xl" style={{ background: t.page }}>
                      <div className="w-1/4" style={{ background: t.side }} />
                      <div className="flex flex-1 flex-col justify-center gap-1.5 p-2">
                        <div className="h-2 w-3/4 rounded-full" style={{ background: t.surface, boxShadow: '0 0 0 1px rgba(128,128,128,.25)' }} />
                        <div className="h-2.5 w-1/2 rounded-full" style={{ backgroundImage: `linear-gradient(90deg, ${t.brand}, ${t.brand2})` }} />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between px-1 text-sm font-medium text-slate-700">
                      {t.label}
                      {on && <Check className="h-4 w-4 text-violet-600" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </Modal>

      <main className="px-4 py-6 sm:px-6 lg:ml-64 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl animate-fade-in" key={section}>
          {section === 'dashboard' && <Dashboard {...props} />}
          {section === 'eventos' && <EventsSection {...props} />}
          {section === 'fotos' && <PhotosSection {...props} />}
          {section === 'transmissao' && <TransmissionSection {...props} />}
          {section === 'qrcode' && <QrSection {...props} />}
          {section === 'configuracoes' && <SettingsSection {...props} />}
          {section === 'historico' && <HistorySection {...props} />}
        </div>
      </main>
    </div>
  );
}
