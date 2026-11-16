'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, RotateCcw, Trash2, ChevronsUp, ImageOff, Maximize2, Download } from 'lucide-react';
import { api, ApiError, formatBytes, formatDateTime } from '@/lib/client/api';
import type { PhotoRecord, EventStats, PhotoStatus } from '@/lib/shared/types';
import type { EventWithStats, LiveState } from '../AdminApp';
import { Modal, PhotoBadge, SectionHeader, EmptyState, Spinner, useConfirm, useToast } from '../ui';

type AdminPhoto = PhotoRecord & { url: string; thumbUrl: string };
type Tab = 'all' | PhotoStatus;

const TABS: { id: Tab; label: string; key?: keyof EventStats }[] = [
  { id: 'all', label: 'Recebidas', key: 'received' },
  { id: 'queued', label: 'Aguardando', key: 'queued' },
  { id: 'playing', label: 'No telão', key: 'playing' },
  { id: 'displayed', label: 'Exibidas', key: 'displayed' },
  { id: 'rejected', label: 'Rejeitadas', key: 'rejected' },
];

export default function PhotosSection({ live }: { live: LiveState }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [events, setEvents] = useState<EventWithStats[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('all');
  const [photos, setPhotos] = useState<AdminPhoto[] | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [preview, setPreview] = useState<AdminPhoto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<EventWithStats[]>('/api/admin/events')
      .then((list) => {
        setEvents(list);
        setEventId((prev) => {
          if (prev && list.some((e) => e.id === prev)) return prev;
          let wanted: string | null = null;
          try {
            wanted = sessionStorage.getItem('mf_photos_event');
            sessionStorage.removeItem('mf_photos_event');
          } catch {
            /* ignora */
          }
          const cur = list.find((e) => e.status === 'active' || e.status === 'paused');
          return (wanted && list.some((e) => e.id === wanted) ? wanted : cur?.id || list[0]?.id) || '';
        });
      })
      .catch((e) => toast('error', e.message));
  }, [toast]);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      const qs = tab === 'all' ? '' : `?status=${tab}`;
      const r = await api<{ photos: AdminPhoto[]; stats: EventStats }>(`/api/admin/events/${eventId}/photos${qs}`);
      setPhotos(r.photos);
      setStats(r.stats);
    } catch (err) {
      toast('error', (err as ApiError).message);
    }
  }, [eventId, tab, toast]);

  useEffect(() => {
    load();
  }, [load, live.version]);

  const act = async (p: AdminPhoto, action: 'reject' | 'requeue' | 'play-next' | 'delete', okText: string) => {
    if (action === 'delete') {
      const ok = await confirm({ title: 'Excluir fotografia?', danger: true, message: 'O arquivo será apagado definitivamente deste computador.', confirmLabel: 'Excluir' });
      if (!ok) return;
    }
    if (action === 'reject' && p.status === 'playing') {
      const ok = await confirm({ title: 'Rejeitar foto em exibição?', message: 'A foto sairá do telão imediatamente e a próxima será exibida.', confirmLabel: 'Rejeitar' });
      if (!ok) return;
    }
    setBusy(p.id + action);
    try {
      await api(`/api/admin/photos/${p.eventId}/${p.id}${action === 'delete' ? '' : '/' + action}`, { method: action === 'delete' ? 'DELETE' : 'POST' });
      toast('ok', okText);
      if (preview?.id === p.id) setPreview(null);
      await load();
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const ev = events.find((e) => e.id === eventId);
  const B = (key: string, I: React.ComponentType<{ className?: string }>) => (busy === key ? <Spinner className="h-3.5 w-3.5" /> : <I className="h-3.5 w-3.5" />);

  const actions = (p: AdminPhoto, full = false) => (
    <div className={`flex flex-wrap gap-1.5 ${full ? '' : 'justify-center'}`}>
      {p.status !== 'rejected' && (
        <button className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!!busy} onClick={() => act(p, 'reject', 'Foto rejeitada.')} title="Rejeitar">
          {B(p.id + 'reject', Ban)} {full && 'Rejeitar'}
        </button>
      )}
      {(p.status === 'displayed' || p.status === 'rejected') && (
        <button className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!!busy} onClick={() => act(p, 'requeue', 'Foto recolocada no final da fila.')} title="Recolocar na fila">
          {B(p.id + 'requeue', RotateCcw)} {full && 'Recolocar na fila'}
        </button>
      )}
      {p.status !== 'playing' && ev && (ev.status === 'active' || ev.status === 'paused') && (
        <button className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!!busy} onClick={() => act(p, 'play-next', 'Será a próxima foto exibida.')} title="Exibir em seguida">
          {B(p.id + 'play-next', ChevronsUp)} {full && 'Exibir em seguida'}
        </button>
      )}
      <button className="btn-ghost px-2.5 py-1.5 text-xs text-rose-600" disabled={!!busy} onClick={() => act(p, 'delete', 'Foto excluída.')} title="Excluir">
        {B(p.id + 'delete', Trash2)} {full && 'Excluir'}
      </button>
    </div>
  );

  return (
    <>
      <SectionHeader
        title="Fotografias"
        subtitle="Todas as fotos ficam guardadas no computador até serem excluídas pelo administrador ou pela limpeza automática."
        actions={
          events.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
            {eventId && (
              <a
                className={`btn-ghost ${!stats || stats.received - stats.rejected <= 0 ? 'pointer-events-none opacity-50' : ''}`}
                href={`/api/admin/events/${eventId}/photos.zip`}
                download
                title="Baixa todas as fotos do evento (exceto rejeitadas) em um arquivo .zip"
              >
                <Download className="h-4 w-4" /> Baixar todas (.zip)
              </a>
            )}
            <select className="input w-auto min-w-56" value={eventId} onChange={(e) => { setEventId(e.target.value); setPhotos(null); }}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} {e.status === 'active' ? '(ativo)' : e.status === 'paused' ? '(pausado)' : e.status === 'finished' ? '(encerrado)' : '(planejado)'}
                </option>
              ))}
            </select>
            </div>
          )
        }
      />

      {!events.length ? (
        <EmptyState icon={<ImageOff className="h-7 w-7" />} title="Nenhum evento" text="Crie um evento para receber fotografias." />
      ) : (
        <>
          <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setPhotos(null); }}
                className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === t.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
              >
                {t.label}
                {stats && t.key && <span className={`ml-2 rounded-md px-1.5 text-xs ${tab === t.id ? 'bg-white/20' : 'bg-slate-100'}`}>{stats[t.key]}</span>}
              </button>
            ))}
          </div>

          {!photos ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-2xl bg-slate-200" />
              ))}
            </div>
          ) : photos.length === 0 ? (
            <EmptyState icon={<ImageOff className="h-7 w-7" />} title="Nenhuma fotografia aqui" text={ev?.purgedAt ? 'As fotografias deste evento foram apagadas pela limpeza.' : 'Assim que os participantes enviarem fotos, elas aparecerão aqui em tempo real.'} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {photos.map((p) => (
                <div key={p.id} className="card group overflow-hidden">
                  <button className="relative block aspect-square w-full overflow-hidden bg-slate-100" onClick={() => setPreview(p)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                    <span className="absolute left-2 top-2"><PhotoBadge status={p.status} /></span>
                    {p.status === 'queued' && <span className="absolute right-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">#{p.position}</span>}
                    <span className="absolute bottom-2 right-2 rounded-lg bg-black/50 p-1 text-white opacity-0 transition group-hover:opacity-100"><Maximize2 className="h-3.5 w-3.5" /></span>
                  </button>
                  <div className="p-2.5">
                    <div className="mb-2 text-center text-[11px] text-slate-500">{formatDateTime(p.receivedAt)}</div>
                    {actions(p)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Fotografia" wide>
        {preview && (
          <div>
            <div className="mb-4 flex max-h-[60dvh] justify-center overflow-hidden rounded-2xl bg-slate-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt="" className="max-h-[60dvh] w-auto object-contain" />
            </div>
            <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-slate-500">Status</dt><dd><PhotoBadge status={preview.status} /></dd></div>
              <div><dt className="text-xs text-slate-500">Recebida em</dt><dd>{formatDateTime(preview.receivedAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Posição na fila</dt><dd>#{preview.position}</dd></div>
              <div><dt className="text-xs text-slate-500">Arquivo original</dt><dd className="truncate" title={preview.originalName}>{preview.originalName}</dd></div>
              <div><dt className="text-xs text-slate-500">Tamanho original</dt><dd>{formatBytes(preview.originalSize)}</dd></div>
              <div><dt className="text-xs text-slate-500">Dimensões</dt><dd>{preview.width} × {preview.height}</dd></div>
              {preview.displayedAt && <div><dt className="text-xs text-slate-500">Exibida em</dt><dd>{formatDateTime(preview.displayedAt)}{preview.skipped ? ' (pulada)' : ''}</dd></div>}
              {preview.rejectedAt && <div><dt className="text-xs text-slate-500">Rejeitada em</dt><dd>{formatDateTime(preview.rejectedAt)}</dd></div>}
            </dl>
            {actions(preview, true)}
          </div>
        )}
      </Modal>
    </>
  );
}
