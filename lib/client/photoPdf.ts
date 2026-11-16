/**
 * Gera, no navegador, um PDF com uma foto por página (a página tem o formato da foto),
 * com a legenda desenhada sobre a imagem do mesmo jeito que aparece na tela de transmissão:
 * faixa escura em degradê embaixo, fonte "Mountains of Christmas" 700, branca e com sombra.
 * Emojis são desenhados pelo próprio navegador, como no telão.
 */

export interface PdfPhoto {
  id: string;
  url: string;
  caption?: string;
}

export const CAPTION_FONT = '"Mountains of Christmas", "Segoe Script", "Brush Script MT", cursive';
const MAX_SIDE = 1800; // maior lado da página/foto, em pixels
const JPEG_QUALITY = 0.9;

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

async function loadBitmap(url: string): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Foto indisponível (${res.status})`);
  const blob = await res.blob();
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      /* cai para <img> */
    }
  }
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = objUrl;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  }
}

/** Quebra o texto em linhas que caibam em maxWidth (palavras; quebra letras só se a palavra não couber). */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  const push = () => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    push();
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
    } else {
      for (const ch of Array.from(word)) {
        if (ctx.measureText(line + ch).width > maxWidth) push();
        line += ch;
      }
    }
  }
  push();
  return lines;
}

function drawCaption(ctx: CanvasRenderingContext2D, w: number, h: number, caption: string) {
  const vmin = Math.min(w, h);
  // Mesma regra de tamanho do telão (7 / 5,6 / 4,6 vmin conforme o tamanho do texto).
  const size = vmin * (caption.length > 90 ? 0.046 : caption.length > 45 ? 0.056 : 0.07);
  ctx.font = `700 ${size}px ${CAPTION_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const maxWidth = w * 0.9;
  const lines = wrapLines(ctx, caption, maxWidth);
  const lineH = size * 1.1;
  const textH = lines.length * lineH;
  const padBottom = vmin * 0.04;
  const padTop = vmin * 0.14;
  const bandH = Math.min(h, textH + padBottom + padTop);

  // Faixa em degradê (igual ao telão: from-black/75 via-black/40 to-transparent)
  const grad = ctx.createLinearGradient(0, h - bandH, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - bandH, w, bandH);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = size * 0.25;
  ctx.shadowOffsetY = size * 0.04;
  const firstBaseline = h - padBottom - textH + lineH * 0.82;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, firstBaseline + i * lineH));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

async function renderPage(photo: PdfPhoto): Promise<{ data: string; w: number; h: number }> {
  const bmp = await loadBitmap(photo.url);
  const nw = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const nh = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if ('close' in bmp) bmp.close();
  const caption = (photo.caption || '').trim();
  if (caption) {
    // garante que a fonte (e os glifos usados) esteja carregada antes de desenhar
    await document.fonts.load(`700 ${Math.round(Math.min(w, h) * 0.06)}px "Mountains of Christmas"`, caption).catch(() => undefined);
    drawCaption(ctx, w, h, caption);
  }
  const data = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  canvas.width = canvas.height = 0; // libera memória
  return { data, w, h };
}

export async function buildPhotosPdf(
  photos: PdfPhoto[],
  title: string,
  onProgress?: (done: number, total: number) => void,
  shouldCancel?: () => boolean,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  let doc: InstanceType<typeof jsPDF> | null = null;
  let pages = 0;
  const skipped: string[] = [];
  onProgress?.(0, photos.length);
  for (let i = 0; i < photos.length; i++) {
    if (shouldCancel?.()) throw new Error('cancelado');
    try {
      const { data, w, h } = await renderPage(photos[i]);
      const orientation = w >= h ? 'landscape' : 'portrait';
      if (!doc) {
        doc = new jsPDF({ unit: 'pt', format: [w, h], orientation, compress: true });
        doc.setProperties({ title });
      } else {
        doc.addPage([w, h], orientation);
      }
      doc.addImage(data, 'JPEG', 0, 0, w, h, undefined, 'FAST');
      pages++;
    } catch {
      skipped.push(photos[i].id);
    }
    onProgress?.(i + 1, photos.length);
    await nextFrame(); // deixa a tela respirar entre as páginas
  }
  if (!doc || !pages) throw new Error('Não foi possível ler nenhuma das fotos.');
  const blob = doc.output('blob');
  if (skipped.length) console.warn(`PDF: ${skipped.length} foto(s) não puderam ser lidas e foram ignoradas.`);
  return blob;
}
