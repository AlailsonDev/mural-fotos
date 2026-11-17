'use client';

import { useEffect, useState } from 'react';
import { Timer, MonitorPlay, Copy, KeyRound, RefreshCw, ImageOff } from 'lucide-react';
import { api, ApiError } from '@/lib/client/api';
import type { PhotoRecord, Settings } from '@/lib/shared/types';
import type { LiveState } from '../AdminApp';
import { SectionHeader, Spinner, copyText, useConfirm, useToast } from '../ui';
import TransmissionControls, { TransmissionBadge } from './TransmissionControls';

const PRESETS = [5, 8, 10, 15, 20];
type AdminPhoto = PhotoRecord & { thumbUrl: string };

export default function TransmissionSection({ live }: { live: LiveState }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [displayKey, setDisplayKey] = useState('');
  const [custom, setCustom] = useState('');
  const [transition, setTransition] = useState('');
  const [saving, setSaving] = useState(false);
  const [queue, setQueue] = useState<AdminPhoto[]>([]);
  const [, tick] = useState(0);
  const pb = live.playback;

  useEffect(() => {
    api<{ settings: Settings; displayKey: string }>('/api/admin/settings')
      .then((r) => {
        setSettings(r.settings);
        setDisplayKey(r.displayKey);
        setTransition(String(r.settings.transitionMs / 1000));
        if (!PRESETS.includes(r.settings.displaySeconds)) setCustom(String(r.settings.displaySeconds));
      })
      .catch((e) => toast('error', e.message));
  }, [toast]);

  useEffect(() => {
    const id = live.event?.id;
    if (!id) return setQueue([]);
    api<{ photos: AdminPhoto[] }>(`/api/admin/events/${id}/photos?status=queued`)
      .then((r) => setQueue(r.photos.slice(0, 12)))
      .catch(() => undefined);
  }, [live.event?.id, live.version]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const save = async (patch: Partial<Settings>, okText: string) => {
    setSaving(true);
    try {
      const r = await api<{ settings: Settings }>('/api/admin/settings', { method: 'PATCH', json: patch });
      setSettings(r.settings);
      toast('ok', okText);
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    const ok = await confirm({ title: 'Gerar nova chave?', message: 'Telas abertas em outros computadores com a chave antiga continuarão conectadas até serem reabertas. Links antigos deixarão de funcionar.', confirmLabel: 'Gerar nova chave' });
    if (!ok) return;
    const r = await api<{ displayKey: string }>('/api/admin/display-key/regenerate', { method: 'POST' });
    setDisplayKey(r.displayKey);
    toast('ok', 'Nova chave gerada.');
  };

  const cur = pb?.current;
  const total = cur ? cur.displayMs + cur.transitionMs : 1;
  const remaining = cur ? (cur.endsAt ? Math.min(total, Math.max(0, cur.endsAt - Date.now())) : cur.remainingMs) : 0;
  const displayLink = typeof window !== 'undefined' && displayKey ? `${window.location.origin}/transmissao?chave=${displayKey}` : '';

  return (
    <>
      <SectionHeader title="Transmissão" subtitle="O servidor controla a fila: as fotos são exibidas uma por vez, na ordem de chegada." />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card overflow-hidden lg:col-span-3">
          <div className="relative aspect-video bg-[#07070c]">
            {cur ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={cur.photo.id} src={cur.photo.url} alt="Foto em exibição" className="h-full w-full object-contain animate-fade-in" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-white/50">
                <MonitorPlay className="mb-2 h-10 w-10" />
                <span className="text-sm">{pb?.effective === 'no-event' ? 'Nenhum evento ativo' : 'Tela de espera (sem fotos na fila)'}</span>
              </div>
            )}
            <div className="absolute left-3 top-3"><TransmissionBadge pb={pb} /></div>
            {cur && (
              <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/10">
                <div className="h-full bg-white/70 transition-[width] duration-500 ease-linear" style={{ width: `${(1 - remaining / total) * 100}%` }} />
              </div>
            )}
          </div>
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <span><strong className="text-slate-900">{pb?.queueCount ?? 0}</strong> foto(s) na fila</span>
              <span><strong className="text-slate-900">{pb?.displays ?? 0}</strong> tela(s) conectada(s)</span>
              {cur && <span>Restam <strong className="text-slate-900">{Math.ceil(remaining / 1000)}s</strong> nesta foto</span>}
            </div>
            <TransmissionControls pb={pb} />
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><Timer className="h-5 w-5 text-slate-400" /> Tempo de exibição</h3>
            {settings ? (
              <>
                <div className="mb-3 grid grid-cols-5 gap-1.5">
                  {PRESETS.map((s) => (
                    <button
                      key={s}
                      disabled={saving}
                      onClick={() => { setCustom(''); save({ displaySeconds: s }, `Tempo de exibição: ${s} segundos.`); }}
                      className={`rounded-xl py-2.5 text-sm font-semibold transition ${settings.displaySeconds === s ? 'brand-gradient text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(custom); if (v >= 2) save({ displaySeconds: v }, `Tempo de exibição: ${v} segundos.`); }}>
                  <input type="number" min={2} max={300} step={1} className="input" placeholder="Personalizado (segundos)" value={custom} onChange={(e) => setCustom(e.target.value)} />
                  <button className="btn-ghost" disabled={saving || !custom}>Aplicar</button>
                </form>
                <label className="label mt-4">Transição entre fotos (segundos)</label>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save({ transitionMs: Math.round(Number(transition) * 1000) }, 'Tempo de transição atualizado.'); }}>
                  <input type="number" min={0} max={5} step={0.1} className="input" value={transition} onChange={(e) => setTransition(e.target.value)} />
                  <button className="btn-ghost" disabled={saving}>Aplicar</button>
                </form>
                <p className="mt-2 text-xs text-slate-500">A alteração vale a partir da próxima foto.</p>
              </>
            ) : (
              <Spinner />
            )}
          </div>

          <div className="card p-5">
            <h3 className="mb-2 flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5 text-slate-400" /> Tela em outro computador</h3>
            <p className="mb-3 text-xs text-slate-500">Neste navegador a tela abre direto. Em outro computador, use este link (contém a chave de transmissão – não o divulgue):</p>
            <div className="flex gap-2">
              <input readOnly className="input font-mono text-xs" value={displayLink} onFocus={(e) => e.target.select()} />
              <button className="btn-ghost" onClick={async () => toast('ok', (await copyText(displayLink)) ? 'Link copiado.' : 'Copie manualmente.')} title="Copiar"><Copy className="h-4 w-4" /></button>
            </div>
            <button className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800" onClick={regenerate}><RefreshCw className="h-3.5 w-3.5" /> Gerar nova chave</button>
          </div>
        </div>
      </div>

      <div className="card mt-6 p-5">
        <h3 className="mb-4 font-semibold">Próximas na fila</h3>
        {queue.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-500"><ImageOff className="h-4 w-4" /> A fila está vazia.</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {queue.map((p, i) => (
              <div key={p.id} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 text-[11px] font-semibold text-white">{i + 1}º</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
