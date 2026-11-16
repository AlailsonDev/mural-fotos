import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import next from 'next';
import { readConfig, type AppConfig } from './config';
import { createServices, type Services } from './services';
import { createApp } from './http/app';
import { attachRealtime } from './realtime';
import { getLocalAddresses } from './lib/network';
import { log } from './lib/logger';

export interface RunningServer {
  server: http.Server;
  svc: Services;
  close: () => Promise<void>;
}

/** Monta o servidor HTTP + API + Socket.IO. `withNext=false` é usado nos testes automatizados. */
export async function buildServer(config: AppConfig, opts: { withNext: boolean }) {
  const svc = await createServices(config);
  const server = http.createServer();
  const rt = attachRealtime(server, svc);
  const { app, errorHandler, onSettingsChanged } = createApp(svc, { notifySocket: rt.notifySocket });
  onSettingsChanged(rt.settingsChanged);

  if (opts.withNext) {
    const nextApp = next({ dev: config.dev, dir: process.cwd(), hostname: 'localhost', port: config.port, httpServer: server });
    await nextApp.prepare();
    const handle = nextApp.getRequestHandler();
    app.use((req, res) => handle(req, res));
  }
  app.use(errorHandler);
  server.on('request', app);

  const close = async () => {
    svc.shutdown();
    await new Promise<void>((resolve) => rt.io.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { server, svc, close };
}

function banner(config: AppConfig, svc: Services) {
  const line = '='.repeat(64);
  const addrs = getLocalAddresses();
  const qr = svc.qrTarget();
  const ev = svc.store.getCurrentEvent();
  const port = config.port === 80 ? '' : `:${config.port}`;
  const out: string[] = [];
  out.push('', line, `  ${svc.settings.get().branding.systemName.toUpperCase()} – servidor iniciado`, line);
  out.push(`  Neste computador:        http://localhost${port}`);
  if (addrs.length) {
    out.push(`  Na rede local (Wi-Fi):   http://${addrs[0].address}${port}   (${addrs[0].interface})`);
    for (const a of addrs.slice(1)) out.push(`                           http://${a.address}${port}   (${a.interface})`);
  } else {
    out.push('  Rede local:              nenhum endereço IPv4 encontrado (verifique o Wi-Fi/cabo).');
  }
  out.push('');
  out.push(`  Transmissão (projetor):  http://localhost${port}/transmissao`);
  out.push(`  Painel administrativo:   http://localhost${port}/admin`);
  out.push('');
  out.push(qr.publicUrl ? `  Endereço público:        ${qr.publicUrl}  (configurado)` : '  Endereço público:        não configurado (modo local)');
  out.push(`  QR Code aponta para:     ${qr.url}  [modo ${qr.mode === 'public' ? 'remoto' : 'local'}]`);
  out.push('');
  out.push(config.adminPasswordHash ? '  Senha administrativa:    configurada' : '  ATENÇÃO: senha administrativa NÃO configurada. Execute: npm run set-password');
  if (ev && ev.status === 'active') out.push(`  PRONTO para receber fotografias no evento "${ev.name}".`);
  else if (ev && ev.status === 'paused') out.push(`  Evento "${ev.name}" está PAUSADO: os envios estão suspensos.`);
  else out.push('  Nenhum evento ativo: crie/inicie um evento no painel para receber fotografias.');
  out.push(line, '  Para encerrar o servidor, feche esta janela ou pressione Ctrl+C.', line, '');
  console.log(out.join('\n'));
}

export async function main() {
  const config = readConfig();
  if (!config.dev && !fs.existsSync(path.join(process.cwd(), '.next', 'BUILD_ID'))) {
    console.error('\n[ERRO] A interface ainda não foi compilada. Execute "npm run build" (ou install.bat) e tente novamente.\n');
    process.exit(1);
  }
  const { server, svc, close } = await buildServer(config, { withNext: true });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[ERRO] A porta ${config.port} já está em uso. Feche o outro programa ou altere PORT no arquivo .env.\n`);
    } else {
      console.error('[ERRO] Falha no servidor:', err);
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    log.info(`Servidor ouvindo em ${config.host}:${config.port} (${config.dev ? 'desenvolvimento' : 'produção'})`);
    banner(config, svc);
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info(`Encerrando servidor (${signal})...`);
    const force = setTimeout(() => process.exit(0), 4000);
    force.unref();
    await close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => log.error('Promessa rejeitada sem tratamento', String(err)));
  process.on('uncaughtException', (err) => log.error('Exceção não tratada', err.stack || String(err)));
}
