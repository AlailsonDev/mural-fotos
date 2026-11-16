'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import type { EventStatus, PhotoStatus } from '@/lib/shared/types';

// ---------------------------------------------------------------- Toasts
interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3.5 text-sm shadow-lg animate-fade-in ${
              t.kind === 'ok' ? 'border-emerald-200 bg-white text-slate-800' : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {t.kind === 'ok' ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" /> : <XCircle className="h-5 w-5 shrink-0 text-rose-500" />}
            <span className="flex-1">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- Modal / Confirmação
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl animate-pop sm:rounded-3xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmOptions {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Palavra que o administrador precisa digitar (ex.: LIMPAR) */
  typeToConfirm?: string;
}

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<string | false>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: string | false) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const ask = useCallback(
    (o: ConfirmOptions) =>
      new Promise<string | false>((resolve) => {
        setTyped('');
        setState({ ...o, resolve });
      }),
    [],
  );
  const close = (v: string | false) => {
    state?.resolve(v);
    setState(null);
  };
  const ok = !state?.typeToConfirm || typed.trim().toUpperCase() === state.typeToConfirm;
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title || ''}>
        <div className="flex gap-3">
          {state?.danger && (
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-100">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
          )}
          <div className="text-sm leading-relaxed text-slate-600">{state?.message}</div>
        </div>
        {state?.typeToConfirm && (
          <div className="mt-4">
            <label className="label">
              Digite <strong>{state.typeToConfirm}</strong> para confirmar
            </label>
            <input autoFocus className="input" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => close(false)}>
            Cancelar
          </button>
          <button className={state?.danger ? 'btn-danger' : 'btn-primary'} disabled={!ok} onClick={() => close(state?.typeToConfirm || 'ok')}>
            {state?.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ---------------------------------------------------------------- Componentes visuais
export function StatCard({ label, value, icon, tone = 'slate', hint }: { label: string; value: React.ReactNode; icon: React.ReactNode; tone?: 'slate' | 'violet' | 'emerald' | 'amber' | 'rose' | 'sky'; hint?: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    violet: 'bg-violet-100 text-violet-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    rose: 'bg-rose-100 text-rose-600',
    sky: 'bg-sky-100 text-sky-600',
  };
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-500">{label}</span>
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

const EVENT_LABEL: Record<EventStatus, [string, string]> = {
  planned: ['Planejado', 'bg-slate-100 text-slate-700'],
  active: ['Ativo', 'bg-emerald-100 text-emerald-700'],
  paused: ['Pausado', 'bg-amber-100 text-amber-800'],
  finished: ['Encerrado', 'bg-slate-200 text-slate-600'],
};
export function EventBadge({ status }: { status: EventStatus }) {
  const [label, cls] = EVENT_LABEL[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {status === 'active' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
      {label}
    </span>
  );
}

const PHOTO_LABEL: Record<PhotoStatus, [string, string]> = {
  queued: ['Na fila', 'bg-sky-100 text-sky-700'],
  playing: ['No telão', 'bg-violet-100 text-violet-700'],
  displayed: ['Exibida', 'bg-emerald-100 text-emerald-700'],
  rejected: ['Rejeitada', 'bg-rose-100 text-rose-700'],
};
export function PhotoBadge({ status }: { status: PhotoStatus }) {
  const [label, cls] = PHOTO_LABEL[status];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>;
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function SectionHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Copia texto para a área de transferência (com alternativa para páginas sem HTTPS). */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* tenta alternativa */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}
