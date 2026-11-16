'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Camera, CheckCircle2, CloudUpload, ImagePlus, Loader2, PauseCircle, PartyPopper, RefreshCw, X, AlertCircle, Clock } from 'lucide-react';
import type { PublicStatus } from '@/lib/shared/types';
import { brandStyle, logoUrl, randomId, formatBytes } from '@/lib/client/api';

interface Selected {
  id: string;
  file: File;
  url: string;
  caption: string;
  error?: string;
}

const MAX_CAPTION = 140;

type Phase = 'select' | 'uploading' | 'done';

async function sniffImage(file: File): Promise<boolean> {
  try {
    const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
    const ascii = (a: number, b: number) => String.fromCharCode(...buf.slice(a, b));
    return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'; // WebP
  } catch {
    return false;
  }
}

export default function UploadPage() {
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [files, setFiles] = useState<Selected[]>([]);
  const [phase, setPhase] = useState<Phase>('select');
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accepted: number; rejected: { name: string; reason?: string }[] } | null>(null);
  const [connected, setConnected] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/public/status', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setStatus(await res.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const s = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
    socketRef.current = s;
    s.on('connect', () => {
      setConnected(true);
      loadStatus(); // ao reconectar, busca o estado atual
    });
    s.on('disconnect', () => setConnected(false));
    s.on('system:status', (st: PublicStatus) => setStatus(st));
    return () => {
      s.close();
    };
  }, [loadStatus]);

  // Libera a memória das pré-visualizações
  useEffect(() => () => files.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const maxFiles = status?.limits.maxFiles ?? 3;
  const maxMB = status?.limits.maxFileSizeMB ?? 10;

  const onPick = async (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const incoming = Array.from(list);
    const room = maxFiles - files.length;
    if (incoming.length > room) {
      setError(room > 0 ? `Você pode enviar até ${maxFiles} fotos por vez. Selecionamos as primeiras ${room}.` : `Limite de ${maxFiles} fotos por envio atingido.`);
    }
    const added: Selected[] = [];
    for (const file of incoming.slice(0, Math.max(0, room))) {
      let err: string | undefined;
      if (file.size > maxMB * 1024 * 1024) err = `Maior que ${maxMB} MB`;
      else if (!(await sniffImage(file))) err = 'Formato não aceito';
      added.push({ id: randomId(), file, url: URL.createObjectURL(file), caption: '', error: err });
    }
    setFiles((prev) => [...prev, ...added]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (id: string) => {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      return prev.filter((x) => x.id !== id);
    });
  };

  const setCaption = (id: string, caption: string) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, caption } : f)));

  const valid = files.filter((f) => !f.error);

  const sendOnce = (items: Selected[]) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const fd = new FormData();
      fd.append('meta', JSON.stringify(items.map((f) => ({ clientId: f.id, name: f.file.name, caption: f.caption.trim() }))));
      for (const f of items) fd.append('photos', f.file, f.file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/public/upload');
      if (socketRef.current?.id) xhr.setRequestHeader('X-Socket-Id', socketRef.current.id);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setProgress(pct);
          if (pct >= 100) setProcessing(true);
        }
      };
      xhr.onload = () => {
        let body: any = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* resposta vazia */
        }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new Error('network'));
      xhr.ontimeout = () => reject(new Error('network'));
      xhr.timeout = 5 * 60_000;
      xhr.send(fd);
    });

  const upload = async () => {
    if (!valid.length) return;
    setPhase('uploading');
    setProgress(0);
    setProcessing(false);
    setError(null);
    // Os mesmos identificadores são reenviados em caso de falha de rede:
    // o servidor reconhece e não duplica as fotos.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { status: code, body } = await sendOnce(valid);
        if (code === 503 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          continue;
        }
        if (code >= 200 && code < 300) {
          setResult({ accepted: body.accepted?.length || 0, rejected: body.rejected || [] });
          files.forEach((f) => URL.revokeObjectURL(f.url));
          setFiles([]);
          setPhase('done');
          return;
        }
        setError(body?.error || (body?.rejected?.[0]?.reason ? `Não foi possível enviar: ${body.rejected[0].reason}` : 'Não foi possível enviar as fotos.'));
        setPhase('select');
        if (code === 409) loadStatus();
        return;
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        setError('A conexão falhou durante o envio. Verifique a internet/Wi-Fi e toque em ENVIAR FOTOS novamente.');
        setPhase('select');
      }
    }
  };

  const b = status?.branding;
  const logo = logoUrl(b);

  return (
    <main style={brandStyle(b)} className="relative min-h-dvh overflow-hidden bg-[#0b0b12] text-white">
      <div className="blob -left-24 -top-24 h-80 w-80 brand-gradient" />
      <div className="blob -bottom-24 -right-24 h-80 w-80 bg-[var(--brand2)]" style={{ animationDelay: '-8s' }} />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-8">
        <header className="mb-6 flex flex-col items-center text-center animate-fade-in">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="mb-4 h-20 w-auto max-w-[200px] object-contain drop-shadow-lg" />
          ) : (
            <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl brand-gradient shadow-lg shadow-black/40">
              <Camera className="h-8 w-8" />
            </div>
          )}
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">{b?.systemName || 'Mural de Fotos'}</p>
          {status?.event && <h1 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl">{status.event.name}</h1>}
        </header>

        {!status && !loadError && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/60" />
          </div>
        )}

        {loadError && !status && (
          <StateCard icon={<AlertCircle className="h-10 w-10 text-amber-300" />} title="Sem conexão com o servidor" text="Verifique se você está conectado à internet ou à rede Wi-Fi do evento.">
            <button onClick={loadStatus} className="btn mt-4 bg-white/10 text-white hover:bg-white/20">
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </button>
          </StateCard>
        )}

        {status?.state === 'closed' && (
          <StateCard icon={<Clock className="h-10 w-10 text-white/70" />} title="Nenhum evento recebendo fotos" text="No momento não há evento recebendo fotografias. Assim que o próximo evento começar, este mesmo QR Code funcionará automaticamente." />
        )}

        {status?.state === 'paused' && phase !== 'done' && (
          <StateCard icon={<PauseCircle className="h-10 w-10 text-amber-300" />} title="Envios pausados" text="Os envios de fotografias estão temporariamente suspensos. Aguarde um pouco – esta página será liberada automaticamente." />
        )}

        {status?.state === 'open' && phase !== 'done' && (
          <section className="flex flex-1 flex-col animate-fade-in">
            <p className="mb-5 text-center text-[15px] leading-relaxed text-white/75">{b?.welcomeMessage}</p>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => onPick(e.target.files)}
            />

            {files.length === 0 ? (
              <button
                onClick={() => inputRef.current?.click()}
                disabled={phase === 'uploading'}
                className="group flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-white/20 bg-white/5 px-6 py-12 transition hover:border-white/40 hover:bg-white/10 active:scale-[0.99]"
              >
                <span className="grid h-16 w-16 place-items-center rounded-full brand-gradient shadow-lg shadow-black/30 transition group-hover:scale-105">
                  <ImagePlus className="h-8 w-8" />
                </span>
                <span className="text-lg font-semibold">Selecionar fotos</span>
                <span className="text-sm text-white/55">
                  Até {maxFiles} fotos · JPG, PNG ou WebP · máx. {maxMB} MB
                </span>
              </button>
            ) : (
              <div>
                <div className="mb-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-white/80">
                    {files.length} de {maxFiles} {maxFiles === 1 ? 'foto' : 'fotos'} selecionada{files.length === 1 ? '' : 's'}
                  </span>
                  {files.length < maxFiles && phase !== 'uploading' && (
                    <button onClick={() => inputRef.current?.click()} className="font-semibold text-white underline-offset-4 hover:underline">
                      + Adicionar
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-stretch gap-3 rounded-2xl bg-white/5 p-2.5 animate-pop">
                      <div className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-xl bg-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt="" className={`h-full w-full object-cover ${f.error ? 'opacity-30' : ''}`} />
                        {f.error && (
                          <div className="absolute inset-x-1 bottom-1 rounded-lg bg-rose-600/90 px-1 py-0.5 text-center text-[10px] font-semibold leading-tight">
                            {f.error}
                          </div>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col justify-center">
                        <label className="mb-1 text-xs font-medium text-white/60" htmlFor={`cap-${f.id}`}>
                          Legenda (opcional)
                        </label>
                        <textarea
                          id={`cap-${f.id}`}
                          value={f.caption}
                          onChange={(e) => setCaption(f.id, e.target.value)}
                          disabled={phase === 'uploading' || !!f.error}
                          maxLength={MAX_CAPTION}
                          rows={2}
                          placeholder="Escreva uma frase para esta foto…"
                          className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/40 disabled:opacity-50"
                        />
                        <span className="mt-0.5 text-right text-[10px] text-white/35">
                          {f.caption.length}/{MAX_CAPTION}
                        </span>
                      </div>
                      {phase !== 'uploading' && (
                        <button
                          onClick={() => remove(f.id)}
                          aria-label="Remover foto"
                          className="grid h-8 w-8 shrink-0 place-items-center self-start rounded-full bg-black/40 transition hover:bg-black/70"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-right text-xs text-white/40">{formatBytes(valid.reduce((a, f) => a + f.file.size, 0))}</p>
              </div>
            )}

            {error && (
              <div className="mt-4 flex gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/15 p-3 text-sm text-rose-100 animate-fade-in">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-auto pt-6">
              {phase === 'uploading' ? (
                <div className="rounded-2xl bg-white/10 p-4">
                  <div className="mb-2 flex items-center justify-between text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {processing ? 'Preparando para o telão...' : 'Enviando...'}
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full brand-gradient transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : (
                <button
                  onClick={upload}
                  disabled={!valid.length}
                  className="flex w-full items-center justify-center gap-2.5 rounded-2xl py-4 text-lg font-bold tracking-wide shadow-xl shadow-black/30 brand-gradient transition active:scale-[0.98] disabled:opacity-40"
                >
                  <CloudUpload className="h-6 w-6" /> ENVIAR FOTOS
                </button>
              )}
              {!connected && <p className="mt-3 text-center text-xs text-amber-200/80">Reconectando ao servidor...</p>}
            </div>
          </section>
        )}

        {phase === 'done' && result && (
          <section className="flex flex-1 flex-col items-center justify-center text-center animate-pop">
            <div className="relative mb-6">
              <div className="grid h-24 w-24 place-items-center rounded-full brand-gradient pulse-ring">
                <CheckCircle2 className="h-12 w-12" />
              </div>
              <PartyPopper className="absolute -right-4 -top-2 h-8 w-8 text-amber-300 animate-float" />
            </div>
            <h2 className="mb-3 text-2xl font-bold">Fotos enviadas!</h2>
            <p className="max-w-xs text-[15px] leading-relaxed text-white/80">
              Suas fotografias foram recebidas com sucesso! Agora é só aguardar. Em breve elas aparecerão no telão!
            </p>
            {result.rejected.length > 0 && (
              <div className="mt-5 w-full rounded-2xl bg-amber-500/15 p-3 text-left text-sm text-amber-100">
                <p className="mb-1 font-semibold">{result.rejected.length} foto(s) não puderam ser aceitas:</p>
                <ul className="list-disc pl-5 text-amber-100/80">
                  {result.rejected.map((r, i) => (
                    <li key={i}>
                      {r.name ? `${r.name}: ` : ''}
                      {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={() => {
                setResult(null);
                setPhase('select');
              }}
              className="btn mt-8 bg-white/10 px-6 py-3 text-base text-white hover:bg-white/20"
            >
              <ImagePlus className="h-5 w-5" /> Enviar mais fotos
            </button>
          </section>
        )}

        <footer className="mt-8 text-center text-[11px] text-white/30">Suas fotos serão exibidas no telão do evento.</footer>
      </div>
    </main>
  );
}

function StateCard({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center animate-fade-in">
      <div className="mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-white/10">{icon}</div>
      <h2 className="mb-2 text-xl font-bold">{title}</h2>
      <p className="max-w-xs text-[15px] leading-relaxed text-white/65">{text}</p>
      {children}
    </div>
  );
}
