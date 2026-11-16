'use client';

import { useState } from 'react';
import { Play, Pause, SkipForward, StepForward, Square, ExternalLink } from 'lucide-react';
import { api, ApiError } from '@/lib/client/api';
import type { PlaybackSnapshot } from '@/lib/shared/types';
import { useToast, Spinner } from '../ui';

export const EFFECTIVE_LABEL: Record<PlaybackSnapshot['effective'], { label: string; cls: string; dot: string }> = {
  playing: { label: 'Exibindo fotos', cls: 'text-emerald-700 bg-emerald-50', dot: 'bg-emerald-500 animate-pulse' },
  idle: { label: 'Aguardando fotos', cls: 'text-sky-700 bg-sky-50', dot: 'bg-sky-500' },
  paused: { label: 'Pausada', cls: 'text-amber-800 bg-amber-50', dot: 'bg-amber-500' },
  stopped: { label: 'Parada', cls: 'text-slate-700 bg-slate-100', dot: 'bg-slate-400' },
  'waiting-display': { label: 'Nenhuma tela conectada', cls: 'text-rose-700 bg-rose-50', dot: 'bg-rose-500' },
  'no-event': { label: 'Sem evento ativo', cls: 'text-slate-600 bg-slate-100', dot: 'bg-slate-300' },
};

export function TransmissionBadge({ pb }: { pb: PlaybackSnapshot | null }) {
  if (!pb) return null;
  const e = EFFECTIVE_LABEL[pb.effective];
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${e.cls}`}>
      <span className={`h-2 w-2 rounded-full ${e.dot}`} /> {e.label}
    </span>
  );
}

export default function TransmissionControls({ pb, compact }: { pb: PlaybackSnapshot | null; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (action: string, okText: string) => {
    setBusy(action);
    try {
      await api(`/api/admin/transmission/${action}`, { method: 'POST' });
      toast('ok', okText);
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const mode = pb?.mode;
  const icon = (name: string, I: React.ComponentType<{ className?: string }>) => (busy === name ? <Spinner className="h-4 w-4" /> : <I className="h-4 w-4" />);

  return (
    <div className="flex flex-wrap gap-2">
      {mode === 'stopped' && (
        <button className="btn-primary" disabled={!!busy} onClick={() => run('start', 'Transmissão iniciada.')}>
          {icon('start', Play)} Iniciar transmissão
        </button>
      )}
      {mode === 'running' && (
        <button className="btn-dark" disabled={!!busy} onClick={() => run('pause', 'Transmissão pausada.')}>
          {icon('pause', Pause)} Pausar
        </button>
      )}
      {mode === 'paused' && (
        <button className="btn-primary" disabled={!!busy} onClick={() => run('resume', 'Transmissão retomada.')}>
          {icon('resume', Play)} Retomar
        </button>
      )}
      <button className="btn-ghost" disabled={!!busy || !pb?.current} onClick={() => run('skip', 'Foto atual pulada.')} title="Pula a foto atual (marcada como pulada)">
        {icon('skip', SkipForward)} Pular atual
      </button>
      {!compact && (
        <>
          <button className="btn-ghost" disabled={!!busy || (!pb?.current && !pb?.queueCount)} onClick={() => run('next', 'Exibindo a próxima fotografia.')} title="Encerra a foto atual e exibe a próxima da fila">
            {icon('next', StepForward)} Exibir próxima
          </button>
          {mode !== 'stopped' && (
            <button className="btn-ghost" disabled={!!busy} onClick={() => run('stop', 'Transmissão parada. A foto atual voltou para a fila.')}>
              {icon('stop', Square)} Parar
            </button>
          )}
        </>
      )}
      <a className="btn-ghost" href="/transmissao" target="_blank" rel="noopener">
        <ExternalLink className="h-4 w-4" /> Abrir tela de transmissão
      </a>
    </div>
  );
}
