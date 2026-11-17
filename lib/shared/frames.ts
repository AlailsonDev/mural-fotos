// Molduras decorativas da tela de transmissão. Feitas só com CSS (sem imagens).
// Compartilhado entre servidor (validação) e navegador (desenho).

export type FrameCss = Record<string, string | number>;

export interface FrameDef {
  id: string;
  label: string;
  /** Espessura da moldura em vmin (0 = sem moldura). */
  inset: number;
  /** Estilo CSS da moldura para a espessura `t` (qualquer unidade CSS, ex.: "2vmin" ou "6px"). */
  css: (t: string) => FrameCss;
}

const gradBorder = (t: string, image: string, extra: FrameCss = {}): FrameCss => ({
  border: `${t} solid transparent`,
  borderImage: `${image} 1`,
  ...extra,
});

const GOLD = 'linear-gradient(135deg,#8a6a1f,#f5e08a 22%,#b8892b 45%,#fff3b0 62%,#a67c1f 80%,#e6c76a)';
const SILVER = 'linear-gradient(135deg,#7b8794,#f1f5f9 25%,#9aa5b1 50%,#ffffff 68%,#8794a1)';
const WOOD = 'repeating-linear-gradient(95deg,#5b3a1e 0 12px,#7a5230 12px 22px,#4a2e17 22px 30px,#6b4527 30px 44px)';

export const FRAMES: FrameDef[] = [
  { id: 'nenhuma', label: 'Sem moldura', inset: 0, css: () => ({}) },
  {
    id: 'fina-branca',
    label: 'Fina branca',
    inset: 1,
    css: (t) => ({ border: `calc(${t} * 0.5) solid rgba(255,255,255,0.92)`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35)' }),
  },
  {
    id: 'dourada',
    label: 'Dourada clássica',
    inset: 2.2,
    css: (t) => gradBorder(t, GOLD, { boxShadow: 'inset 0 0 0 1px rgba(60,40,0,0.7), inset 0 0 18px rgba(0,0,0,0.55)' }),
  },
  {
    id: 'prata',
    label: 'Prata',
    inset: 2.2,
    css: (t) => gradBorder(t, SILVER, { boxShadow: 'inset 0 0 0 1px rgba(30,40,50,0.7), inset 0 0 18px rgba(0,0,0,0.5)' }),
  },
  {
    id: 'madeira',
    label: 'Madeira',
    inset: 2.6,
    css: (t) => gradBorder(t, WOOD, { boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.5), inset 0 0 22px rgba(0,0,0,0.6)' }),
  },
  {
    id: 'polaroid',
    label: 'Polaroid',
    inset: 3,
    css: (t) => ({ border: `${t} solid #f7f5ef`, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.25), inset 0 0 14px rgba(0,0,0,0.35)' }),
  },
  {
    id: 'preta-dourada',
    label: 'Preta com filete dourado',
    inset: 2.2,
    css: (t) => ({ border: `${t} solid #0b0b0d`, boxShadow: `inset 0 0 0 calc(${t} * 0.12) #d4af37, 0 0 0 1px #d4af37` }),
  },
  {
    id: 'azul-real',
    label: 'Azul real',
    inset: 2.2,
    css: (t) => ({ border: `${t} solid #14306b`, boxShadow: `inset 0 0 0 calc(${t} * 0.12) #e5ecff, inset 0 0 16px rgba(0,0,0,0.5)` }),
  },
  {
    id: 'esmeralda',
    label: 'Esmeralda',
    inset: 2.2,
    css: (t) => ({ border: `${t} solid #0b4a37`, boxShadow: `inset 0 0 0 calc(${t} * 0.12) #f0d98a, inset 0 0 16px rgba(0,0,0,0.5)` }),
  },
  {
    id: 'neon-rosa',
    label: 'Neon rosa',
    inset: 1.2,
    css: (t) => ({ border: `calc(${t} * 0.35) solid #ff5ce1`, boxShadow: `0 0 ${t} #ff2fd6, inset 0 0 ${t} #ff2fd6, 0 0 calc(${t} * 3) rgba(255,47,214,0.6)` }),
  },
  {
    id: 'neon-azul',
    label: 'Neon azul',
    inset: 1.2,
    css: (t) => ({ border: `calc(${t} * 0.35) solid #6fe3ff`, boxShadow: `0 0 ${t} #19c2ff, inset 0 0 ${t} #19c2ff, 0 0 calc(${t} * 3) rgba(25,194,255,0.6)` }),
  },
  {
    id: 'natal',
    label: 'Natalina',
    inset: 2.2,
    css: (t) =>
      gradBorder(t, `repeating-linear-gradient(45deg,#c1121f 0 calc(${t} * 0.8),#ffffff calc(${t} * 0.8) calc(${t} * 1.6),#1b7f3b calc(${t} * 1.6) calc(${t} * 2.4),#ffffff calc(${t} * 2.4) calc(${t} * 3.2))`, {
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.4), inset 0 0 14px rgba(0,0,0,0.5)',
      }),
  },
  {
    id: 'festa',
    label: 'Festa colorida',
    inset: 1.8,
    css: (t) =>
      gradBorder(t, `repeating-linear-gradient(90deg,#f43f5e 0 calc(${t} * 1.5),#facc15 calc(${t} * 1.5) calc(${t} * 3),#22d3ee calc(${t} * 3) calc(${t} * 4.5),#a855f7 calc(${t} * 4.5) calc(${t} * 6))`, {
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35)',
      }),
  },
];

export const DEFAULT_FRAME = 'nenhuma';

export function isFrame(id: unknown): id is string {
  return typeof id === 'string' && FRAMES.some((f) => f.id === id);
}

export function getFrame(id: string | null | undefined): FrameDef {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}
