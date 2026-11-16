import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Repete operações de arquivo que podem falhar temporariamente no Windows (antivírus, indexador). */
export async function retryFs<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'EMFILE') throw err;
      lastErr = err;
      await sleep(40 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Gravação atômica: escreve em arquivo temporário, força gravação em disco (fsync)
 * e renomeia por cima do original. Opcionalmente mantém uma cópia .bak da versão anterior.
 */
export async function writeJsonAtomic(file: string, data: unknown, opts: { backup?: boolean } = {}) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const json = JSON.stringify(data, null, 2);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (opts.backup && fsSync.existsSync(file)) {
    await retryFs(() => fs.copyFile(file, file + '.bak')).catch(() => undefined);
  }
  try {
    await retryFs(() => fs.rename(tmp, file));
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * Lê JSON com recuperação: se o arquivo principal estiver corrompido/ausente,
 * tenta a cópia .bak; se nada existir, devolve o valor padrão.
 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  for (const candidate of [file, file + '.bak']) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      if (!raw.trim()) continue;
      const parsed = JSON.parse(raw) as T;
      if (candidate !== file) {
        console.warn(`[storage] ${path.basename(file)} estava ausente/corrompido; restaurado a partir do backup.`);
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code && code !== 'ENOENT') console.warn(`[storage] Falha ao ler ${path.basename(candidate)}:`, code);
      if (!code) console.warn(`[storage] JSON inválido em ${path.basename(candidate)}`);
    }
  }
  return fallback;
}

/** Remove arquivos temporários esquecidos por um encerramento inesperado. */
export async function cleanupTempFiles(dir: string) {
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries.filter((e) => e.endsWith('.tmp')).map((e) => fs.rm(path.join(dir, e), { force: true })),
    );
  } catch {
    /* pasta inexistente */
  }
}
