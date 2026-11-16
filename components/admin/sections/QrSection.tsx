'use client';

import { useEffect, useState } from 'react';
import { Download, Copy, Printer, Globe, Wifi, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/client/api';
import type { LiveState, SectionId } from '../AdminApp';
import { SectionHeader, copyText, useToast } from '../ui';

interface QrInfo {
  url: string;
  mode: 'public' | 'local';
  publicUrl: string;
  localUrl: string;
}

export default function QrSection({ go }: { live: LiveState; go: (s: SectionId) => void }) {
  const toast = useToast();
  const [qr, setQr] = useState<QrInfo | null>(null);

  useEffect(() => {
    api<{ qr: QrInfo }>('/api/admin/network').then((r) => setQr(r.qr)).catch((e) => toast('error', e.message));
  }, [toast]);

  const v = encodeURIComponent(qr?.url || '');

  return (
    <>
      <SectionHeader title="QR Code permanente" subtitle="Um único QR Code para todos os eventos. Imprima uma vez e reutilize sempre." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="card flex flex-col items-center p-6 lg:col-span-2">
          <div className="rounded-3xl bg-white p-4 shadow-lg ring-1 ring-slate-100">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/qr.svg?size=600&v=${v}`} alt="QR Code" className="h-64 w-64" />
            ) : (
              <div className="h-64 w-64 animate-pulse rounded-2xl bg-slate-100" />
            )}
          </div>
          <div className="mt-5 grid w-full grid-cols-2 gap-2">
            <a className="btn-ghost" href={`/api/qr.png?size=1200&download=1&v=${v}`}>
              <Download className="h-4 w-4" /> PNG
            </a>
            <a className="btn-ghost" href={`/api/qr.svg?size=1200&download=1&v=${v}`}>
              <Download className="h-4 w-4" /> SVG
            </a>
            <a className="btn-primary col-span-2" href="/admin/qr" target="_blank" rel="noopener">
              <Printer className="h-4 w-4" /> Versão para impressão
            </a>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-3">
          <div className="card p-5">
            <h3 className="mb-3 font-semibold">Endereço do QR Code</h3>
            <div className="flex gap-2">
              <input readOnly className="input font-mono" value={qr?.url || ''} onFocus={(e) => e.target.select()} />
              <button className="btn-ghost" onClick={async () => qr && toast('ok', (await copyText(qr.url)) ? 'Endereço copiado.' : 'Copie manualmente.')}>
                <Copy className="h-4 w-4" /> Copiar
              </button>
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm">
              {qr?.mode === 'public' ? <Globe className="mt-0.5 h-5 w-5 shrink-0 text-violet-500" /> : <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-violet-500" />}
              <div className="text-slate-600">
                {qr?.mode === 'public' ? (
                  <>
                    <strong className="text-slate-900">Modo remoto.</strong> O QR Code usa o endereço público permanente. Os participantes podem enviar fotos pela internet móvel, desde que o domínio e o túnel (ex.: Cloudflare Tunnel) estejam configurados e este computador esteja conectado à internet.
                  </>
                ) : (
                  <>
                    <strong className="text-slate-900">Modo local.</strong> O QR Code usa o IP deste computador na rede. Os celulares precisam estar conectados <strong>na mesma rede Wi-Fi</strong>. Se o IP do computador mudar, o QR Code também muda – para um QR Code realmente permanente, configure um endereço público ou reserve o IP no roteador (veja o README).
                  </>
                )}
              </div>
            </div>
            {qr?.mode === 'local' && (
              <p className="mt-3 flex gap-2 text-xs text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Antes de imprimir, teste o QR Code com um celular conectado ao Wi-Fi do evento.
              </p>
            )}
          </div>

          <div className="card p-5 text-sm">
            <h3 className="mb-3 font-semibold">Endereços disponíveis</h3>
            <dl className="space-y-2">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
                <dt className="text-slate-500">Endereço público</dt>
                <dd className="break-all font-mono">{qr?.publicUrl || 'não configurado'}</dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
                <dt className="text-slate-500">Endereço local (Wi-Fi)</dt>
                <dd className="break-all font-mono">{qr?.localUrl}</dd>
              </div>
            </dl>
            <button className="btn-ghost mt-4" onClick={() => go('configuracoes')}>
              Alterar endereço público / modo do QR Code
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
