// Ponto de entrada: define o ambiente ANTES de carregar o Next.js.
import { loadEnv } from './config';

loadEnv(process.env.MURAL_ENV_FILE || undefined);
if (process.argv.includes('--prod')) {
  (process.env as Record<string, string>).NODE_ENV = 'production';
} else if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = 'development';
}

const { main } = await import('./index');
await main();
