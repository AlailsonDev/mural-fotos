'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck, Images, CheckCircle2, Ban, ScrollText } from 'lucide-react';
import { api, formatDateTime } from '@/lib/client/api';
import type { EventWithStats, LiveState } from '../AdminApp';
import { EventBadge, SectionHeader, StatCard, EmptyState } from '../ui';

export default function HistorySection({ live }: { live: LiveState }) {
  const [events, setEvents] = useState<EventWithStats[] | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    api<EventWithStats[]>('/api/admin/events').then(setEvents).catch(() => setEvents([]));
    api<{ lines: string[] }>('/api/admin/logs/cleanup').then((r) => setLog(r.lines.slice(-30).reverse())).catch(() => undefined);
  }, [live.version]);

  const past = (events || []).filter((e) => e.status === 'finished');
  const totals = (events || []).reduce(
    (acc, e) => ({ received: acc.received + e.stats.received, displayed: acc.displayed + e.stats.displayed, rejected: acc.rejected + e.stats.rejected }),
    { received: 0, displayed: 0, rejected: 0 },
  );

  return (
    <>
      <SectionHeader title="Histórico" subtitle="Eventos anteriores e estatísticas gerais." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Eventos realizados" value={past.length} icon={<CalendarCheck className="h-5 w-5" />} tone="violet" />
        <StatCard label="Total de fotografias" value={totals.received} icon={<Images className="h-5 w-5" />} tone="sky" />
        <StatCard label="Fotografias exibidas" value={totals.displayed} icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" />
        <StatCard label="Rejeitadas" value={totals.rejected} icon={<Ban className="h-5 w-5" />} tone="rose" />
      </div>

      {events && past.length === 0 ? (
        <EmptyState icon={<CalendarCheck className="h-7 w-7" />} title="Nenhum evento encerrado ainda" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Evento</th>
                <th className="px-5 py-3 font-medium">Realização</th>
                <th className="px-5 py-3 text-right font-medium">Recebidas</th>
                <th className="px-5 py-3 text-right font-medium">Exibidas</th>
                <th className="px-5 py-3 text-right font-medium">Rejeitadas</th>
                <th className="px-5 py-3 font-medium">Arquivos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {past.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{e.name}</div>
                    <EventBadge status={e.status} />
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {formatDateTime(e.startedAt)}
                    <div className="text-xs text-slate-400">até {formatDateTime(e.finishedAt)}</div>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold">{e.stats.received}</td>
                  <td className="px-5 py-3 text-right">{e.stats.displayed}</td>
                  <td className="px-5 py-3 text-right">{e.stats.rejected}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">{e.purgedAt ? `apagados em ${formatDateTime(e.purgedAt)}` : 'guardados'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card mt-6 p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <ScrollText className="h-5 w-5 text-slate-400" /> Registro de limpezas
        </h3>
        {log.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma operação de limpeza registrada.</p>
        ) : (
          <pre className="max-h-64 overflow-auto rounded-xl bg-[#07070c] p-4 text-xs leading-relaxed text-[#cbd5e1]">{log.join('\n')}</pre>
        )}
      </div>
    </>
  );
}
