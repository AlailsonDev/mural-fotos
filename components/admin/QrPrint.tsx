'use client';

import { useEffect, useState } from 'react';
import { Printer, Camera } from 'lucide-react';
import type { PublicStatus } from '@/lib/shared/types';
import { api, brandStyle, logoUrl } from '@/lib/client/api';

/** Cartão de mesa pronto para impressão (A4 com 1 ou 4 cartões). */
export default function QrPrint() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [layout, setLayout] = useState<1 | 4>(1);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    fetch('/api/public/status').then((r) => r.json()).then(setStatus).catch(() => undefined);
    api<{ qr: { url: string } }>('/api/admin/network')
      .then((r) => setQrUrl(r.qr.url))
      .catch(() => setAuthError(true));
  }, []);

  if (authError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center text-slate-600">
        <div>
          Faça login no <a className="text-violet-600 underline" href="/admin">painel administrativo</a> para gerar a versão de impressão.
        </div>
      </div>
    );
  }

  const b = status?.branding;
  const logo = logoUrl(b);
  const v = encodeURIComponent(qrUrl);

  const CardView = ({ small }: { small?: boolean }) => (
    <div className={`relative flex flex-col items-center justify-between overflow-hidden rounded-[28px] border border-slate-200 bg-white text-center ${small ? 'p-6' : 'p-12'}`} style={{ breakInside: 'avoid' }}>
      <div className="brand-gradient absolute inset-x-0 top-0 h-3" />
      <div className="flex flex-col items-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className={small ? 'mb-2 h-12' : 'mb-4 h-24'} />
        ) : (
          <div className={`brand-gradient mb-3 grid place-items-center rounded-2xl text-white ${small ? 'h-10 w-10' : 'h-16 w-16'}`}>
            <Camera className={small ? 'h-5 w-5' : 'h-8 w-8'} />
          </div>
        )}
        <div className={`font-extrabold leading-tight text-slate-900 ${small ? 'text-xl' : 'text-4xl'}`}>Apareça no telão!</div>
        <div className={`mt-1 text-slate-500 ${small ? 'text-xs' : 'text-lg'}`}>{b?.systemName || 'Mural de Fotos'}</div>
      </div>
      {qrUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/qr.svg?size=900&v=${v}`} alt="QR Code" className={small ? 'my-3 h-40 w-40' : 'my-8 h-80 w-80'} />
      )}
      <div>
        <ol className={`mx-auto flex justify-center gap-3 font-semibold text-slate-700 ${small ? 'text-[11px]' : 'text-lg'}`}>
          <li><span className="brand-text">1.</span> Escaneie</li>
          <li><span className="brand-text">2.</span> Escolha a foto</li>
          <li><span className="brand-text">3.</span> Envie</li>
        </ol>
        <p className={`mt-2 break-all text-slate-400 ${small ? 'text-[9px]' : 'text-sm'}`}>{qrUrl.replace(/\/$/, '')}</p>
      </div>
    </div>
  );

  return (
    <div style={brandStyle(b)} className="min-h-dvh bg-slate-100 print:bg-white">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-center gap-3 border-b border-slate-200 bg-white/90 p-3 backdrop-blur">
        <span className="text-sm text-slate-600">Layout:</span>
        <button className={layout === 1 ? 'btn-dark' : 'btn-ghost'} onClick={() => setLayout(1)}>1 por página</button>
        <button className={layout === 4 ? 'btn-dark' : 'btn-ghost'} onClick={() => setLayout(4)}>4 por página (mesas)</button>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimir
        </button>
      </div>
      <div className="mx-auto max-w-[210mm] p-6 print:p-0">
        {layout === 1 ? (
          <div className="aspect-[210/297] print:aspect-auto print:h-[277mm]">
            <CardView />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 print:h-[277mm]">
            {[0, 1, 2, 3].map((i) => (
              <CardView key={i} small />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
