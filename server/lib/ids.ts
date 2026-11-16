import crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const newId = () => crypto.randomUUID();
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Identificador gerado pelo navegador para evitar duplicidade em reenvios após queda de conexão. */
export const isClientId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v);

/** Limpa o nome original apenas para exibição (nunca é usado como nome de arquivo no disco). */
export function sanitizeDisplayName(name: string): string {
  const base = String(name || 'foto')
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return (base || 'foto').slice(0, 120);
}
