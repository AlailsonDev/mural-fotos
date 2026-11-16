'use client';

import { useEffect, useState } from 'react';
import { Images, Clock, CheckCircle2, Ban, MonitorPlay, Inbox, CalendarPlus, AlertTriangle, Globe, Wifi } from 'lucide-react';
import { api } from '@/lib/client/api';
import type { LiveState, SectionId } from '../AdminApp';
import { StatCard, EventBadge, SectionHeader, EmptyState } from '../ui';
import TransmissionControls, { TransmissionBadge } from './TransmissionControls';

interface Overview {
  qr: { url: string; mode: 'public' | 'local'; publicUrl: string; localUrl: string };
  config: { passwordConfigured: boolean; publicUrlConfigured: boolean; port: number };
  uploads: { activeUploads: number; processing: number; waiting: number };
}

export default function Dashboard({ live, go }: { live: LiveState; go: (s: SectionId) => void }) {
  const [ov, setOv] = useState<Overview | null>(null);

  useEffect(() => {
    api<Overview>('/api/admin/overview').then(setOv).catch(() => undefined);
  }, [live.version]);

  const ev = live.event;
  const pb = live.playback;
  const st = ev?.stats;

  return (
    <>
      <SectionHeader title="Dashboard" subtitle="Resumo do evento em andamento e da transmissão." />

      {!ev ? (
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          title="Nenhum evento ativo"
          text="Crie ou inicie um evento para começar a receber fotografias. O QR Code permanente passará a funcionar automaticamente."
          action={
            <button className="btn-primary" onClick={() => go('eventos')}>
              <CalendarPlus className="h-4 w-4" /> Gerenciar eventos
            </button>
          }
        />
      ) : (
        <div className="card mb-6 overflow-hidden">
          <div className="brand-gradient h-1.5" />
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <EventBadge status={ev.status} />
                {ev.status === 'paused' && <span className="text-xs text-amber-700">Envios suspensos</span>}
              </div>
              <h2 className="text-xl font-bold">{ev.name}</h2>
              {ev.description && <p className="mt-0.5 text-sm text-slate-500">{ev.description}</p>}
            </div>
            <button className="btn-ghost" onClick={() => go('eventos')}>
              Gerenciar evento
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Recebidas" value={st?.received ?? 0} icon={<Images className="h-5 w-5" />} tone="violet" />
        <StatCard label="Aguardando" value={(st?.queued ?? 0) + (st?.playing ?? 0)} icon={<Clock className="h-5 w-5" />} tone="sky" hint={st?.playing ? '1 no telão agora' : undefined} />
        <StatCard label="Exibidas" value={st?.displayed ?? 0} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
        <StatCard label="Rejeitadas" value={st?.rejected ?? 0} icon={<Ban className="h-5 w-5" />} tone="rose" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card p-5 lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <MonitorPlay className="h-5 w-5 text-slate-400" /> Transmissão
            </h3>
            <TransmissionBadge pb={pb} />
          </div>
          <div className="mb-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xl font-bold">{pb?.queueCount ?? 0}</div>
              <div className="text-xs text-slate-500">na fila</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xl font-bold">{pb?.displays ?? 0}</div>
              <div className="text-xs text-slate-500">tela(s) conectada(s)</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xl font-bold">{ov ? ov.uploads.activeUploads + ov.uploads.waiting : 0}</div>
              <div className="text-xs text-slate-500">envios em andamento</div>
            </div>
          </div>
          {pb?.effective === 'waiting-display' && (
            <p className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
              Nenhuma tela de transmissão está aberta. Abra a tela de transmissão no computador do projetor para que as fotos comecem a ser exibidas.
            </p>
          )}
          <TransmissionControls pb={pb} compact />
        </div>

        <div className="card p-5 lg:col-span-2">
          <h3 className="mb-4 font-semibold">Acesso dos participantes</h3>
          {ov ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                {ov.qr.mode === 'public' ? <Globe className="mt-0.5 h-4 w-4 text-violet-500" /> : <Wifi className="mt-0.5 h-4 w-4 text-violet-500" />}
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">QR Code aponta para ({ov.qr.mode === 'public' ? 'modo remoto' : 'modo local'})</div>
                  <div className="break-all font-mono text-[13px] font-medium">{ov.qr.url}</div>
                </div>
              </div>
              {!ov.config.publicUrlConfigured && (
                <p className="rounded-xl bg-sky-50 p-3 text-xs text-sky-900">
                  Modo local: os celulares precisam estar na mesma rede Wi-Fi deste computador. Para acesso pela internet móvel, configure um endereço público (veja o README).
                </p>
              )}
              {!ov.config.passwordConfigured && (
                <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> Senha administrativa não configurada.
                </p>
              )}
              <button className="btn-ghost w-full" onClick={() => go('qrcode')}>
                Ver QR Code
              </button>
            </div>
          ) : (
            <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
          )}
        </div>
      </div>
    </>
  );
}
