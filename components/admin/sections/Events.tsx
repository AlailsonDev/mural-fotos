'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Play, Pause, Square, Pencil, Trash2, Eraser, CalendarDays, Images } from 'lucide-react';
import { api, ApiError, formatDateTime } from '@/lib/client/api';
import type { EventWithStats, LiveState, SectionId } from '../AdminApp';
import { EventBadge, Modal, SectionHeader, EmptyState, Spinner, useConfirm, useToast } from '../ui';

interface FormState {
  id?: string;
  name: string;
  description: string;
  scheduledStart: string;
  scheduledEnd: string;
  startNow: boolean;
}
const emptyForm: FormState = { name: '', description: '', scheduledStart: '', scheduledEnd: '', startNow: false };

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function EventsSection({ live, go }: { live: LiveState; go: (s: SectionId) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [events, setEvents] = useState<EventWithStats[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<EventWithStats[]>('/api/admin/events').then(setEvents).catch((e) => toast('error', e.message)), [toast]);
  useEffect(() => {
    load();
  }, [load, live.version]);

  const act = async (key: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(key);
    try {
      await fn();
      toast('ok', okText);
      await load();
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const current = events?.find((e) => e.status === 'active' || e.status === 'paused');

  const start = async (ev: EventWithStats) => {
    let finishCurrent = false;
    if (current && current.id !== ev.id) {
      const ok = await confirm({
        title: 'Iniciar novo evento?',
        message: (
          <>
            O evento <strong>{current.name}</strong> está em andamento. Ao iniciar <strong>{ev.name}</strong>, o evento atual será <strong>encerrado</strong> (as fotos dele continuam guardadas no histórico).
          </>
        ),
        confirmLabel: 'Encerrar atual e iniciar',
      });
      if (!ok) return;
      finishCurrent = true;
    }
    await act(ev.id + 'start', () => api(`/api/admin/events/${ev.id}/start`, { method: 'POST', json: { finishCurrent } }), `Evento "${ev.name}" iniciado. O QR Code já está recebendo fotos.`);
  };

  const finish = async (ev: EventWithStats) => {
    const ok = await confirm({
      title: 'Encerrar evento?',
      message: 'Novos envios serão bloqueados. As fotografias continuam guardadas e o evento ficará disponível no histórico.',
      confirmLabel: 'Encerrar evento',
    });
    if (ok) await act(ev.id + 'finish', () => api(`/api/admin/events/${ev.id}/finish`, { method: 'POST' }), 'Evento encerrado.');
  };

  const finishAndPurge = async (ev: EventWithStats) => {
    const word = await confirm({
      title: 'ENCERRAR E LIMPAR EVENTO',
      danger: true,
      typeToConfirm: 'LIMPAR',
      message: (
        <>
          O evento <strong>{ev.name}</strong> será encerrado e <strong>todas as {ev.stats.received} fotografias serão apagadas definitivamente</strong> deste computador. As estatísticas permanecem no histórico. Esta ação não pode ser desfeita.
        </>
      ),
      confirmLabel: 'Encerrar e apagar fotos',
    });
    if (word) await act(ev.id + 'purge', () => api(`/api/admin/events/${ev.id}/finish-and-purge`, { method: 'POST', json: { confirm: word } }), 'Evento encerrado e fotografias apagadas.');
  };

  const purge = async (ev: EventWithStats) => {
    const word = await confirm({
      title: 'Apagar fotografias do evento?',
      danger: true,
      typeToConfirm: 'LIMPAR',
      message: `Todas as ${ev.stats.received} fotografias de "${ev.name}" serão apagadas definitivamente. As estatísticas permanecem no histórico.`,
      confirmLabel: 'Apagar fotografias',
    });
    if (word) await act(ev.id + 'purge', () => api(`/api/admin/events/${ev.id}/purge`, { method: 'POST', json: { confirm: word } }), 'Fotografias apagadas.');
  };

  const remove = async (ev: EventWithStats) => {
    const word = await confirm({
      title: 'Excluir evento?',
      danger: true,
      typeToConfirm: 'EXCLUIR',
      message: `O evento "${ev.name}", suas fotografias e estatísticas serão excluídos definitivamente.`,
      confirmLabel: 'Excluir evento',
    });
    if (word) await act(ev.id + 'del', () => api(`/api/admin/events/${ev.id}`, { method: 'DELETE', json: { confirm: word } }), 'Evento excluído.');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : null,
        scheduledEnd: form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : null,
      };
      if (form.id) {
        await api(`/api/admin/events/${form.id}`, { method: 'PATCH', json: body });
        toast('ok', 'Evento atualizado.');
      } else {
        let finishCurrent = false;
        if (form.startNow && current) {
          const ok = await confirm({
            title: 'Encerrar o evento atual?',
            message: `"${current.name}" está em andamento e será encerrado para que o novo evento comece.`,
            confirmLabel: 'Encerrar e iniciar novo',
          });
          if (!ok) {
            setSaving(false);
            return;
          }
          finishCurrent = true;
        }
        await api('/api/admin/events', { method: 'POST', json: { ...body, startNow: form.startNow, finishCurrent } });
        toast('ok', form.startNow ? 'Evento criado e iniciado!' : 'Evento criado.');
      }
      setForm(null);
      await load();
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const B = (key: string, I: React.ComponentType<{ className?: string }>) => (busy === key ? <Spinner className="h-4 w-4" /> : <I className="h-4 w-4" />);

  return (
    <>
      <SectionHeader
        title="Eventos"
        subtitle="Somente um evento pode estar ativo por vez. O QR Code é o mesmo para todos os eventos."
        actions={
          <button className="btn-primary" onClick={() => setForm({ ...emptyForm, startNow: !current })}>
            <CalendarPlus className="h-4 w-4" /> Novo evento
          </button>
        }
      />

      {!events ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="card h-28 animate-pulse bg-slate-100" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-7 w-7" />}
          title="Nenhum evento criado"
          text="Crie o primeiro evento (ex.: Confraternização, Casamento, Aniversário)."
          action={
            <button className="btn-primary" onClick={() => setForm({ ...emptyForm, startNow: true })}>
              <CalendarPlus className="h-4 w-4" /> Criar evento
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {events.map((ev) => {
            const inProgress = ev.status === 'active' || ev.status === 'paused';
            return (
              <div key={ev.id} className={`card p-5 ${inProgress ? 'ring-2 ring-violet-200' : ''}`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <EventBadge status={ev.status} />
                      {ev.purgedAt && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">fotos apagadas</span>}
                    </div>
                    <h3 className="truncate text-lg font-semibold">{ev.name}</h3>
                    {ev.description && <p className="line-clamp-2 text-sm text-slate-500">{ev.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Criado: {formatDateTime(ev.createdAt)}</span>
                      {ev.scheduledStart && <span>Previsto: {formatDateTime(ev.scheduledStart)}{ev.scheduledEnd ? ` – ${formatDateTime(ev.scheduledEnd)}` : ''}</span>}
                      {ev.startedAt && <span>Início: {formatDateTime(ev.startedAt)}</span>}
                      {ev.finishedAt && <span>Encerramento: {formatDateTime(ev.finishedAt)}</span>}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-lg bg-violet-50 px-2 py-1 font-medium text-violet-700">{ev.stats.received} recebidas</span>
                      <span className="rounded-lg bg-emerald-50 px-2 py-1 font-medium text-emerald-700">{ev.stats.displayed} exibidas</span>
                      <span className="rounded-lg bg-sky-50 px-2 py-1 font-medium text-sky-700">{ev.stats.queued + ev.stats.playing} aguardando</span>
                      {ev.stats.rejected > 0 && <span className="rounded-lg bg-rose-50 px-2 py-1 font-medium text-rose-700">{ev.stats.rejected} rejeitadas</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {(ev.status === 'planned' || (ev.status === 'finished' && !ev.purgedAt)) && (
                      <button className="btn-primary" disabled={!!busy} onClick={() => start(ev)}>
                        {B(ev.id + 'start', Play)} {ev.status === 'finished' ? 'Reabrir' : 'Iniciar'}
                      </button>
                    )}
                    {ev.status === 'active' && (
                      <button className="btn-ghost" disabled={!!busy} onClick={() => act(ev.id + 'pause', () => api(`/api/admin/events/${ev.id}/pause`, { method: 'POST' }), 'Envios pausados.')}>
                        {B(ev.id + 'pause', Pause)} Pausar envios
                      </button>
                    )}
                    {ev.status === 'paused' && (
                      <button className="btn-primary" disabled={!!busy} onClick={() => act(ev.id + 'resume', () => api(`/api/admin/events/${ev.id}/resume`, { method: 'POST' }), 'Envios retomados.')}>
                        {B(ev.id + 'resume', Play)} Retomar envios
                      </button>
                    )}
                    {inProgress && (
                      <button className="btn-ghost" disabled={!!busy} onClick={() => finish(ev)}>
                        {B(ev.id + 'finish', Square)} Encerrar
                      </button>
                    )}
                    {ev.stats.received > 0 && !ev.purgedAt && (
                      <button className="btn-ghost" onClick={() => { try { sessionStorage.setItem('mf_photos_event', ev.id); } catch { /* ignora */ } go('fotos'); }}>
                        <Images className="h-4 w-4" /> Fotos
                      </button>
                    )}
                    <button className="btn-ghost" onClick={() => setForm({ id: ev.id, name: ev.name, description: ev.description, scheduledStart: toLocalInput(ev.scheduledStart), scheduledEnd: toLocalInput(ev.scheduledEnd), startNow: false })} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    {inProgress && (
                      <button className="btn-danger" disabled={!!busy} onClick={() => finishAndPurge(ev)}>
                        {B(ev.id + 'purge', Eraser)} ENCERRAR E LIMPAR EVENTO
                      </button>
                    )}
                    {ev.status === 'finished' && !ev.purgedAt && ev.stats.received > 0 && (
                      <button className="btn-ghost text-rose-600" disabled={!!busy} onClick={() => purge(ev)} title="Apagar fotografias">
                        {B(ev.id + 'purge', Eraser)} Limpar fotos
                      </button>
                    )}
                    {!inProgress && (
                      <button className="btn-ghost text-rose-600" disabled={!!busy} onClick={() => remove(ev)} title="Excluir evento">
                        {B(ev.id + 'del', Trash2)}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar evento' : 'Novo evento'}>
        {form && (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="label">Nome do evento *</label>
              <input className="input" autoFocus maxLength={100} required placeholder="Ex.: Festa de final de ano" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Descrição (opcional)</label>
              <textarea className="input min-h-20" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Data de início prevista</label>
                <input type="datetime-local" className="input" value={form.scheduledStart} onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })} />
              </div>
              <div>
                <label className="label">Data de encerramento prevista</label>
                <input type="datetime-local" className="input" value={form.scheduledEnd} onChange={(e) => setForm({ ...form, scheduledEnd: e.target.value })} />
              </div>
            </div>
            {!form.id && (
              <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-violet-600" checked={form.startNow} onChange={(e) => setForm({ ...form, startNow: e.target.checked })} />
                Iniciar o evento agora (começar a receber fotos)
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button className="btn-primary" disabled={saving || !form.name.trim()}>
                {saving && <Spinner className="h-4 w-4" />} Salvar
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
