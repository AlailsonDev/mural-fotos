/**
 * Assistente de configuração.
 *   npm run setup          -> cria/atualiza o .env (senha, segredo de sessão, porta, endereço público)
 *   npm run set-password   -> apenas (re)define a senha administrativa
 *
 * A senha NUNCA é gravada em texto puro: apenas o hash scrypt vai para o .env.
 * Também aceita a senha pela variável MF_NEW_PASSWORD (uso em automação).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { hashPassword } from '../server/lib/auth';

const ENV_FILE = path.resolve(process.cwd(), '.env');
const EXAMPLE_FILE = path.resolve(process.cwd(), '.env.example');
const passwordOnly = process.argv.includes('--password-only');
const nonInteractive = process.argv.includes('--defaults');

function readEnv(): string {
  if (fs.existsSync(ENV_FILE)) return fs.readFileSync(ENV_FILE, 'utf8');
  if (fs.existsSync(EXAMPLE_FILE)) return fs.readFileSync(EXAMPLE_FILE, 'utf8');
  return '';
}

function getVar(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

function setVar(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(content) ? content.replace(re, () => line) : `${content.trimEnd()}\n${line}\n`;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

function ask(question: string, def = ''): Promise<string> {
  if (nonInteractive) return Promise.resolve(def);
  return new Promise((resolve) => rl.question(def ? `${question} [${def}]: ` : `${question}: `, (a) => resolve(a.trim() || def)));
}

/** Pergunta oculta (não mostra a senha na tela). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const out = process.stdout;
    const anyRl = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WriteStream };
    const original = anyRl._writeToOutput;
    let muted = false;
    anyRl._writeToOutput = (s: string) => {
      if (!muted) out.write(s);
      else if (s.includes('\n') || s.includes('\r')) out.write('\n');
      else out.write('*'.repeat(s.length > 1 ? 0 : 1));
    };
    rl.question(question, (answer) => {
      anyRl._writeToOutput = original;
      muted = false;
      out.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function askPassword(): Promise<string> {
  const fromEnv = process.env.MF_NEW_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < 8) throw new Error('MF_NEW_PASSWORD precisa ter pelo menos 8 caracteres.');
    return fromEnv;
  }
  for (;;) {
    const p1 = await askHidden('Digite a senha administrativa (mín. 8 caracteres): ');
    if (p1.length < 8) {
      console.log('  A senha precisa ter pelo menos 8 caracteres.\n');
      continue;
    }
    const p2 = await askHidden('Repita a senha: ');
    if (p1 !== p2) {
      console.log('  As senhas não conferem. Tente novamente.\n');
      continue;
    }
    return p1;
  }
}

async function main() {
  console.log('\n=== Mural de Fotos – configuração ===\n');
  let env = readEnv();

  if (!passwordOnly) {
    const port = await ask('Porta do servidor', getVar(env, 'PORT') || '3000');
    if (!/^\d{2,5}$/.test(port)) throw new Error('Porta inválida.');
    env = setVar(env, 'PORT', port);
    env = setVar(env, 'HOST', getVar(env, 'HOST') || '0.0.0.0');
    env = setVar(env, 'DATA_DIR', getVar(env, 'DATA_DIR') || './data');

    console.log('\nEndereço público permanente (modo remoto, ex.: domínio com Cloudflare Tunnel).');
    console.log('Deixe em branco para usar apenas a rede local (Wi-Fi). Pode ser alterado depois no painel.');
    const url = await ask('Endereço público', getVar(env, 'PUBLIC_BASE_URL'));
    if (url && !/^https?:\/\/[^\s]+$/.test(url)) throw new Error('Endereço inválido. Use o formato https://seu-dominio');
    env = setVar(env, 'PUBLIC_BASE_URL', url.replace(/\/+$/, ''));
    if (url && getVar(env, 'TRUST_PROXY') !== '1') {
      const trust = await ask('O acesso público passará por Cloudflare Tunnel/proxy? (s/n)', 's');
      env = setVar(env, 'TRUST_PROXY', trust.toLowerCase().startsWith('s') ? '1' : '0');
    }

    if (getVar(env, 'SESSION_SECRET').length < 32) {
      env = setVar(env, 'SESSION_SECRET', crypto.randomBytes(48).toString('base64url'));
      console.log('\nSegredo de sessão gerado automaticamente.');
    }
  }

  const hasPassword = !!getVar(env, 'ADMIN_PASSWORD_HASH');
  let change = true;
  if (hasPassword && !passwordOnly) {
    change = (await ask('\nJá existe uma senha administrativa. Deseja trocá-la? (s/n)', 'n')).toLowerCase().startsWith('s');
  }
  if (change) {
    if (nonInteractive && !process.env.MF_NEW_PASSWORD) {
      console.log('\n[AVISO] Senha não definida (modo automático). Execute depois: npm run set-password');
    } else {
      console.log('');
      const password = await askPassword();
      env = setVar(env, 'ADMIN_PASSWORD_HASH', hashPassword(password));
      console.log('Senha registrada (somente o hash foi salvo no arquivo .env).');
    }
  }

  fs.writeFileSync(ENV_FILE, env.endsWith('\n') ? env : env + '\n', 'utf8');
  console.log(`\nConfiguração salva em ${ENV_FILE}`);
  console.log('Reinicie o servidor (start.bat) para aplicar as alterações.\n');
  rl.close();
}

main().catch((err) => {
  console.error('\n[ERRO]', err.message || err);
  rl.close();
  process.exit(1);
});
