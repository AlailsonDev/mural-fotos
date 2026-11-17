'use client';

import { useEffect, useRef, useState } from 'react';
import { Save, Upload, Trash2, Eraser, LogOut } from 'lucide-react';
import { api, ApiError, logoUrl } from '@/lib/client/api';
import type { Settings } from '@/lib/shared/types';
import type { LiveState } from '../AdminApp';
import { SectionHeader, Spinner, useConfirm, useToast } from '../ui';

interface NetAddr {
  address: string;
  interface: string;
  preferred: boolean;
}

export default function SettingsSection(_: { live: LiveState }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [s, setS] = useState<Settings | null>(null);
  const [envUrl, setEnvUrl] = useState('');
  const [addrs, setAddrs] = useState<NetAddr[]>([]);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ settings: Settings; envPublicBaseUrl: string }>('/api/admin/settings')
      .then((r) => {
        setS(r.settings);
        setEnvUrl(r.envPublicBaseUrl);
      })
      .catch((e) => toast('error', e.message));
    api<{ addresses: NetAddr[] }>('/api/admin/network').then((r) => setAddrs(r.addresses)).catch(() => undefined);
  }, [toast]);

  if (!s) return <Spinner className="h-6 w-6 text-slate-400" />;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setB = <K extends keyof Settings['branding']>(k: K, v: Settings['branding'][K]) => setS({ ...s, branding: { ...s.branding, [k]: v } });

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const r = await api<{ settings: Settings }>('/api/admin/settings', { method: 'PATCH', json: s });
      setS(r.settings);
      toast('ok', 'Configurações salvas.');
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const r = await api<{ settings: Settings }>('/api/admin/branding/logo', { method: 'POST', body: fd });
      setS({ ...s, branding: { ...s.branding, hasLogo: r.settings.branding.hasLogo, logoVersion: r.settings.branding.logoVersion } });
      toast('ok', 'Logotipo atualizado.');
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      const r = await api<{ settings: Settings }>('/api/admin/branding/logo', { method: 'DELETE' });
      setS({ ...s, branding: { ...s.branding, hasLogo: r.settings.branding.hasLogo, logoVersion: r.settings.branding.logoVersion } });
      toast('ok', 'Logotipo removido.');
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setLogoBusy(false);
    }
  };

  const runCleanup = async () => {
    const word = await confirm({
      title: 'Executar limpeza agora?',
      danger: true,
      typeToConfirm: 'LIMPAR',
      message: `Serão apagadas as fotografias de eventos ENCERRADOS há mais de ${s.retentionHours} horas. Eventos ativos nunca são afetados. As estatísticas permanecem no histórico.`,
      confirmLabel: 'Executar limpeza',
    });
    if (!word) return;
    try {
      const r = await api<{ purged: number; files: number }>('/api/admin/cleanup/run', { method: 'POST', json: { confirm: word } });
      toast('ok', r.purged ? `Limpeza concluída: ${r.purged} evento(s), ${r.files} foto(s) apagadas.` : 'Nenhum evento com prazo expirado.');
    } catch (err) {
      toast('error', (err as ApiError).message);
    }
  };

  const logoutAll = async () => {
    const ok = await confirm({ title: 'Encerrar todas as sessões?', message: 'Todos os administradores e telas de transmissão autorizadas por chave precisarão entrar novamente.', confirmLabel: 'Encerrar sessões' });
    if (!ok) return;
    await api('/api/admin/logout-all', { method: 'POST' }).catch(() => undefined);
    window.location.reload();
  };

  const Card = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
    <section className="card p-5 sm:p-6">
      <h3 className="font-semibold">{title}</h3>
      {desc && <p className="mt-0.5 text-sm text-slate-500">{desc}</p>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
  const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 sm:col-span-2">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );

  const logo = logoUrl(s.branding);

  return (
    <form onSubmit={save}>
      <SectionHeader
        title="Configurações"
        subtitle="As alterações são salvas no computador (data/config/settings.json) e aplicadas imediatamente."
        actions={
          <button className="btn-primary" disabled={saving}>
            {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Salvar alterações
          </button>
        }
      />
      <div className="space-y-6">
        {Card({
          title: 'Envio de fotografias',
          desc: 'Limites aplicados no celular e verificados novamente no servidor.',
          children: (
            <>
              <div>
                <label className="label">Fotos por envio (1–10)</label>
                <input type="number" min={1} max={10} className="input" value={s.maxFilesPerUpload} onChange={(e) => set('maxFilesPerUpload', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Tamanho máximo por foto (MB)</label>
                <input type="number" min={1} max={50} className="input" value={s.maxFileSizeMB} onChange={(e) => set('maxFileSizeMB', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Envios por pessoa (IP) a cada 10 min</label>
                <input type="number" min={3} max={1000} className="input" value={s.uploadRateLimitPerIp} onChange={(e) => set('uploadRateLimitPerIp', Number(e.target.value))} />
              </div>
            </>
          ),
        })}

        {Card({
          title: 'Exibição e imagens',
          children: (
            <>
              <div>
                <label className="label">Tempo de exibição (segundos)</label>
                <input type="number" min={2} max={300} className="input" value={s.displaySeconds} onChange={(e) => set('displaySeconds', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Tempo de transição (milissegundos)</label>
                <input type="number" min={0} max={5000} step={100} className="input" value={s.transitionMs} onChange={(e) => set('transitionMs', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Formato otimizado</label>
                <select className="input" value={s.imageFormat} onChange={(e) => set('imageFormat', e.target.value as Settings['imageFormat'])}>
                  <option value="webp">WebP (menor, recomendado)</option>
                  <option value="jpeg">JPEG (máxima compatibilidade)</option>
                </select>
              </div>
              <div>
                <label className="label">Qualidade das imagens: {s.imageQuality}</label>
                <input type="range" min={50} max={100} className="w-full accent-violet-600" value={s.imageQuality} onChange={(e) => set('imageQuality', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Resolução máxima (maior lado, px)</label>
                <select className="input" value={s.maxImageDimension} onChange={(e) => set('maxImageDimension', Number(e.target.value))}>
                  <option value={1920}>1920 (Full HD)</option>
                  <option value={2560}>2560 (recomendado)</option>
                  <option value={3840}>3840 (4K)</option>
                </select>
              </div>
              <Toggle checked={s.keepOriginals} onChange={(v) => set('keepOriginals', v)} label="Guardar também o arquivo original" hint="Ocupa mais espaço em disco. Os originais ficam em data/events/ID/originals." />
              <Toggle checked={s.blurBackground} onChange={(v) => set('blurBackground', v)} label="Fundo desfocado atrás das fotos" hint="Preenche as laterais de fotos verticais com uma versão desfocada. Desative em computadores muito simples." />
              <Toggle checked={s.showIndicators} onChange={(v) => set('showIndicators', v)} label="Mostrar indicadores na tela de transmissão" hint="Fila, conexão e estado. Também é possível ocultar na própria tela com a tecla I." />
            </>
          ),
        })}

        {Card({
          title: 'Identidade visual',
          desc: 'Personaliza a página de envio e a tela de transmissão.',
          children: (
            <>
              <div>
                <label className="label">Nome do sistema</label>
                <input className="input" maxLength={60} value={s.branding.systemName} onChange={(e) => setB('systemName', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Cor principal</label>
                  <input type="color" className="h-11 w-full cursor-pointer rounded-xl border border-slate-200 bg-surface p-1" value={s.branding.primaryColor} onChange={(e) => setB('primaryColor', e.target.value)} />
                </div>
                <div>
                  <label className="label">Cor secundária</label>
                  <input type="color" className="h-11 w-full cursor-pointer rounded-xl border border-slate-200 bg-surface p-1" value={s.branding.secondaryColor} onChange={(e) => setB('secondaryColor', e.target.value)} />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Mensagem de boas-vindas (página de envio)</label>
                <textarea className="input min-h-16" maxLength={300} value={s.branding.welcomeMessage} onChange={(e) => setB('welcomeMessage', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Mensagem da tela de espera</label>
                <input className="input" maxLength={200} value={s.branding.waitingMessage} onChange={(e) => setB('waitingMessage', e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Logotipo</label>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="grid h-16 w-28 place-items-center overflow-hidden rounded-xl bg-[#0f0f1a] p-2">
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo} alt="Logotipo" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <span className="text-xs text-white/50">sem logo</span>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
                  <button type="button" className="btn-ghost" disabled={logoBusy} onClick={() => fileRef.current?.click()}>
                    {logoBusy ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />} Enviar logotipo
                  </button>
                  {s.branding.hasLogo && (
                    <button type="button" className="btn-ghost text-rose-600" disabled={logoBusy} onClick={removeLogo}>
                      <Trash2 className="h-4 w-4" /> Remover
                    </button>
                  )}
                  <span className="text-xs text-slate-500">PNG com fundo transparente fica melhor. Máx. 3 MB.</span>
                </div>
              </div>
            </>
          ),
        })}

        {Card({
          title: 'Rede e endereço público',
          desc: 'Define para onde o QR Code permanente aponta. Não é preciso alterar o código-fonte.',
          children: (
            <>
              <div className="sm:col-span-2">
                <label className="label">Endereço público permanente (modo remoto)</label>
                <input className="input font-mono" placeholder={envUrl || 'https://fotos.seudominio.com.br'} value={s.publicBaseUrl} onChange={(e) => set('publicBaseUrl', e.target.value)} />
                <p className="mt-1.5 text-xs text-slate-500">
                  {envUrl ? `Definido no .env: ${envUrl}. Um valor aqui tem prioridade.` : 'Vazio = usa PUBLIC_BASE_URL do arquivo .env (se houver).'} Requer domínio próprio + túnel (veja o README).
                </p>
              </div>
              <div>
                <label className="label">Modo do QR Code</label>
                <select className="input" value={s.qrMode} onChange={(e) => set('qrMode', e.target.value as Settings['qrMode'])}>
                  <option value="auto">Automático (público se configurado)</option>
                  <option value="public">Sempre endereço público</option>
                  <option value="local">Sempre rede local (IP)</option>
                </select>
              </div>
              <div>
                <label className="label">Endereço IP local preferido</label>
                <select className="input" value={s.preferredLocalIp} onChange={(e) => set('preferredLocalIp', e.target.value)}>
                  <option value="">Automático{addrs[0] ? ` (${addrs[0].address})` : ''}</option>
                  {addrs.map((a) => (
                    <option key={a.address} value={a.address}>
                      {a.address} – {a.interface}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ),
        })}

        {Card({
          title: 'Limpeza automática',
          desc: 'Fotos de eventos encerrados são apagadas após o prazo. Eventos ativos nunca são afetados.',
          children: (
            <>
              <div>
                <label className="label">Manter fotos por (horas após o encerramento)</label>
                <input type="number" min={1} max={8760} className="input" value={s.retentionHours} onChange={(e) => set('retentionHours', Number(e.target.value))} />
              </div>
              <div className="flex items-end">
                <button type="button" className="btn-ghost w-full text-rose-600" onClick={runCleanup}>
                  <Eraser className="h-4 w-4" /> Executar limpeza agora
                </button>
              </div>
              <Toggle checked={s.autoCleanup} onChange={(v) => set('autoCleanup', v)} label="Limpeza automática ativada" hint="Verificada a cada 15 minutos. Operações registradas em data/logs/cleanup.log." />
            </>
          ),
        })}

        <section className="card p-5 sm:p-6">
          <h3 className="font-semibold">Segurança</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            A senha administrativa é fixa (definida na própria aplicação). Para trocá-la, defina a variável <code className="rounded bg-slate-100 px-1">ADMIN_PASSWORD_HASH</code> no servidor.
          </p>
          <button type="button" className="btn-ghost mt-4" onClick={logoutAll}>
            <LogOut className="h-4 w-4" /> Encerrar todas as sessões
          </button>
        </section>

        <div className="flex justify-end">
          <button className="btn-primary" disabled={saving}>
            {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Salvar alterações
          </button>
        </div>
      </div>
    </form>
  );
}
