import fs from 'node:fs';
import path from 'node:path';

let logDir = '';

export function initLogger(dataDir: string) {
  logDir = path.join(dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
}

function safe(v: unknown) {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function write(file: string, level: string, msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra !== undefined ? ' ' + safe(extra) : ''}\n`;
  if (process.env.LOG_QUIET !== '1') {
    if (level === 'ERROR') console.error(line.trim());
    else console.log(line.trim());
  }
  if (!logDir) return;
  fs.appendFile(path.join(logDir, file), line, () => undefined);
}

export const log = {
  info: (msg: string, extra?: unknown) => write('app.log', 'INFO', msg, extra),
  warn: (msg: string, extra?: unknown) => write('app.log', 'WARN', msg, extra),
  error: (msg: string, extra?: unknown) => write('app.log', 'ERROR', msg, extra),
  cleanup: (msg: string, extra?: unknown) => {
    write('cleanup.log', 'CLEANUP', msg, extra);
  },
};

export function readLogTail(name: 'app.log' | 'cleanup.log', maxLines = 200): string[] {
  if (!logDir) return [];
  try {
    const content = fs.readFileSync(path.join(logDir, name), 'utf8');
    return content.trim().split('\n').filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}
