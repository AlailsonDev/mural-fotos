// Tema do painel administrativo: escolha salva no navegador e no servidor (para a página de envio herdar).
import { ADMIN_THEMES, DEFAULT_THEME_ID, getTheme, type AdminTheme } from '../shared/themes';

export { ADMIN_THEMES, DEFAULT_THEME_ID, getTheme };
export type { AdminTheme };

const STORAGE_KEY = 'mural-admin-theme';

export function loadThemeId(): string {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return getTheme(v).id;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

/** O administrador já escolheu um tema neste navegador? */
export function hasStoredTheme(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
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
