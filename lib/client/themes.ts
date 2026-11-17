// Temas do painel administrativo. A escolha fica salva no navegador (localStorage).

export interface AdminTheme {
  id: string;
  label: string;
  mode: 'light' | 'dark';
  /** Cores principais (botões, destaques). */
  brand: string;
  brand2: string;
  /** Fundo da página, dos cartões e da barra lateral. */
  page: string;
  surface: string;
  side: string;
}

export const ADMIN_THEMES: AdminTheme[] = [
  // Claros
  { id: 'violeta', label: 'Violeta', mode: 'light', brand: '#7c3aed', brand2: '#ec4899', page: '#f8fafc', surface: '#ffffff', side: '#0f0f1a' },
  { id: 'oceano', label: 'Oceano', mode: 'light', brand: '#0284c7', brand2: '#06b6d4', page: '#f0f9ff', surface: '#ffffff', side: '#0c1a2b' },
  { id: 'floresta', label: 'Floresta', mode: 'light', brand: '#059669', brand2: '#84cc16', page: '#f0fdf4', surface: '#ffffff', side: '#0d1f17' },
  { id: 'por-do-sol', label: 'Pôr do sol', mode: 'light', brand: '#ea580c', brand2: '#f43f5e', page: '#fff7ed', surface: '#ffffff', side: '#27120a' },
  { id: 'rosa', label: 'Rosa', mode: 'light', brand: '#db2777', brand2: '#a855f7', page: '#fdf2f8', surface: '#ffffff', side: '#240d1a' },
  { id: 'dourado', label: 'Dourado', mode: 'light', brand: '#b45309', brand2: '#eab308', page: '#fefce8', surface: '#ffffff', side: '#231a08' },
  { id: 'indigo', label: 'Índigo', mode: 'light', brand: '#4f46e5', brand2: '#3b82f6', page: '#eef2ff', surface: '#ffffff', side: '#12122b' },
  { id: 'grafite-claro', label: 'Grafite', mode: 'light', brand: '#334155', brand2: '#64748b', page: '#f1f5f9', surface: '#ffffff', side: '#1e293b' },
  // Escuros
  { id: 'meia-noite', label: 'Meia-noite', mode: 'dark', brand: '#8b5cf6', brand2: '#ec4899', page: '#0b0d17', surface: '#141828', side: '#080a12' },
  { id: 'carvao', label: 'Carvão', mode: 'dark', brand: '#94a3b8', brand2: '#e2e8f0', page: '#121212', surface: '#1c1c1e', side: '#0a0a0a' },
  { id: 'oceano-escuro', label: 'Oceano escuro', mode: 'dark', brand: '#0ea5e9', brand2: '#2dd4bf', page: '#0a1622', surface: '#10222f', side: '#06101a' },
  { id: 'floresta-escura', label: 'Floresta escura', mode: 'dark', brand: '#10b981', brand2: '#a3e635', page: '#0a1511', surface: '#10211a', side: '#060e0b' },
  { id: 'vinho', label: 'Vinho', mode: 'dark', brand: '#e11d48', brand2: '#fb923c', page: '#170a10', surface: '#24111a', side: '#0f060a' },
  { id: 'neon', label: 'Neon', mode: 'dark', brand: '#d946ef', brand2: '#22d3ee', page: '#0d0716', surface: '#190f29', side: '#07040d' },
  { id: 'ambar', label: 'Âmbar', mode: 'dark', brand: '#f59e0b', brand2: '#ef4444', page: '#16110a', surface: '#231a0e', side: '#0e0a05' },
  { id: 'cafe', label: 'Café', mode: 'dark', brand: '#d97706', brand2: '#a16207', page: '#14100d', surface: '#211a15', side: '#0c0907' },
];

export const DEFAULT_THEME_ID = 'violeta';
const STORAGE_KEY = 'mural-admin-theme';

export function getTheme(id: string | null | undefined): AdminTheme {
  return ADMIN_THEMES.find((t) => t.id === id) ?? ADMIN_THEMES[0];
}

export function loadThemeId(): string {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return getTheme(v).id;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* navegador sem armazenamento: o tema vale só nesta sessão */
  }
}

/** Aplica o tema na raiz do documento (cobre também janelas modais, que ficam fora do painel). */
export function applyTheme(t: AdminTheme): () => void {
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--brand': t.brand,
    '--brand2': t.brand2,
    '--page': t.page,
    '--surface': t.surface,
    '--side': t.side,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.backgroundColor = t.page;
  root.dataset.adminTheme = t.id;
  root.dataset.adminMode = t.mode;
  root.style.colorScheme = t.mode;
  return () => {
    for (const k of Object.keys(vars)) root.style.removeProperty(k);
    root.style.removeProperty('background-color');
    root.style.removeProperty('color-scheme');
    delete root.dataset.adminTheme;
    delete root.dataset.adminMode;
  };
}
