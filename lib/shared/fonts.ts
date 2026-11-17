// Fontes disponíveis para o nome do evento (Google Fonts). Compartilhado entre servidor e navegador.

export interface EventFont {
  id: string;
  label: string;
  /** Valor para a propriedade CSS font-family. */
  css: string;
  /** Nome da família no Google Fonts e pesos usados. */
  google: string;
  kind: 'Cursiva' | 'Elegante' | 'Moderna' | 'Impacto';
}

const stack = (name: string, generic: string) => `"${name}", ${generic}`;

export const EVENT_FONTS: EventFont[] = [
  { id: 'padrao', label: 'Padrão do sistema', css: 'inherit', google: '', kind: 'Moderna' },
  { id: 'pacifico', label: 'Pacifico', css: stack('Pacifico', 'cursive'), google: 'Pacifico', kind: 'Cursiva' },
  { id: 'dancing', label: 'Dancing Script', css: stack('Dancing Script', 'cursive'), google: 'Dancing+Script:wght@700', kind: 'Cursiva' },
  { id: 'great-vibes', label: 'Great Vibes', css: stack('Great Vibes', 'cursive'), google: 'Great+Vibes', kind: 'Cursiva' },
  { id: 'satisfy', label: 'Satisfy', css: stack('Satisfy', 'cursive'), google: 'Satisfy', kind: 'Cursiva' },
  { id: 'lobster', label: 'Lobster', css: stack('Lobster', 'cursive'), google: 'Lobster', kind: 'Cursiva' },
  { id: 'kaushan', label: 'Kaushan Script', css: stack('Kaushan Script', 'cursive'), google: 'Kaushan+Script', kind: 'Cursiva' },
  { id: 'caveat', label: 'Caveat', css: stack('Caveat', 'cursive'), google: 'Caveat:wght@700', kind: 'Cursiva' },
  { id: 'sacramento', label: 'Sacramento', css: stack('Sacramento', 'cursive'), google: 'Sacramento', kind: 'Cursiva' },
  { id: 'mountains', label: 'Mountains of Christmas', css: stack('Mountains of Christmas', 'cursive'), google: 'Mountains+of+Christmas:wght@700', kind: 'Cursiva' },
  { id: 'playfair', label: 'Playfair Display', css: stack('Playfair Display', 'serif'), google: 'Playfair+Display:wght@800', kind: 'Elegante' },
  { id: 'cinzel', label: 'Cinzel', css: stack('Cinzel', 'serif'), google: 'Cinzel:wght@800', kind: 'Elegante' },
  { id: 'abril', label: 'Abril Fatface', css: stack('Abril Fatface', 'serif'), google: 'Abril+Fatface', kind: 'Elegante' },
  { id: 'montserrat', label: 'Montserrat', css: stack('Montserrat', 'sans-serif'), google: 'Montserrat:wght@800', kind: 'Moderna' },
  { id: 'poppins', label: 'Poppins', css: stack('Poppins', 'sans-serif'), google: 'Poppins:wght@700', kind: 'Moderna' },
  { id: 'bebas', label: 'Bebas Neue', css: stack('Bebas Neue', 'sans-serif'), google: 'Bebas+Neue', kind: 'Impacto' },
  { id: 'oswald', label: 'Oswald', css: stack('Oswald', 'sans-serif'), google: 'Oswald:wght@700', kind: 'Impacto' },
  { id: 'bangers', label: 'Bangers', css: stack('Bangers', 'cursive'), google: 'Bangers', kind: 'Impacto' },
];

export const DEFAULT_EVENT_FONT = 'padrao';

export function isEventFont(id: unknown): id is string {
  return typeof id === 'string' && EVENT_FONTS.some((f) => f.id === id);
}

export function eventFontCss(id: string | null | undefined): string {
  return (EVENT_FONTS.find((f) => f.id === id) ?? EVENT_FONTS[0]).css;
}

/** URL única do Google Fonts com todas as fontes de evento. */
export const EVENT_FONTS_GOOGLE_URL =
  'https://fonts.googleapis.com/css2?' +
  EVENT_FONTS.filter((f) => f.google)
    .map((f) => `family=${f.google}`)
    .join('&') +
  '&display=swap';
