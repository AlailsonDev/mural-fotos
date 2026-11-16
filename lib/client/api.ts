'use client';

import type { Branding } from '../shared/types';
import type { CSSProperties } from 'react';

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Chamada à API com cookies de sessão e token CSRF nas operações administrativas. */
export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (csrfToken && init.method && init.method !== 'GET') headers.set('X-CSRF-Token', csrfToken);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      credentials: 'same-origin',
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique a rede e tente novamente.', 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error || `Erro ${res.status}`, data?.code);
  return data as T;
}

export function brandStyle(b?: Pick<Branding, 'primaryColor' | 'secondaryColor'> | null): CSSProperties {
  return {
    ['--brand' as string]: b?.primaryColor || '#7c3aed',
    ['--brand2' as string]: b?.secondaryColor || '#ec4899',
  } as CSSProperties;
}

export function logoUrl(b?: Branding | null) {
  return b?.hasLogo ? `/api/public/logo?v=${b.logoVersion}` : null;
}

export function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function randomId(len = 21) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  return Array.from(bytes, (b) => chars[b & 63]).join('');
}
