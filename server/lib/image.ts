import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { Semaphore } from './mutex';

// Controle de memória: sem cache interno do libvips e poucas threads por imagem,
// pois o limite de trabalhos simultâneos é feito pelo semáforo abaixo.
sharp.cache(false);
sharp.concurrency(2);

/** No máximo 2 imagens processadas ao mesmo tempo; as demais aguardam na fila. */
export const imageSemaphore = new Semaphore(2);

export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPTED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_INPUT_PIXELS = 120_000_000; // ~120 MP

export class InvalidImageError extends Error {}

/** Verifica a assinatura binária real (magic bytes) do arquivo – não confia na extensão. */
export async function detectImageType(file: string): Promise<'jpeg' | 'png' | 'webp' | null> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    if (bytesRead < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
  } finally {
    await fh.close();
  }
}

export interface ProcessOptions {
  format: 'webp' | 'jpeg';
  quality: number;
  maxDimension: number;
  keepOriginal: boolean;
}

export interface ProcessResult {
  storedName: string;
  thumbName: string;
  originalKeptName: string | null;
  width: number;
  height: number;
  storedSize: number;
  format: string;
  sourceFormat: string;
}

/**
 * Valida e otimiza a imagem:
 *  - confere a assinatura e decodifica com Sharp (arquivos corrompidos são recusados);
 *  - corrige a orientação EXIF (rotate) e remove metadados (Sharp não copia EXIF/GPS por padrão);
 *  - redimensiona sem ampliar e gera WebP/JPEG otimizado + miniatura para o painel.
 * Sharp lê o arquivo do disco em fluxo – a imagem inteira nunca é carregada em um Buffer do Node.
 */
export async function processImage(
  tmpFile: string,
  eventDir: string,
  id: string,
  opts: ProcessOptions,
): Promise<ProcessResult> {
  const sourceFormat = await detectImageType(tmpFile);
  if (!sourceFormat) throw new InvalidImageError('O arquivo não é uma imagem JPG, PNG ou WebP válida.');

  let meta: Metadata;
  try {
    meta = await sharp(tmpFile, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new InvalidImageError('Não foi possível ler a imagem (arquivo corrompido ou incompleto).');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format) || !meta.width || !meta.height) {
    throw new InvalidImageError('Formato de imagem não suportado.');
  }

  const ext = opts.format === 'webp' ? 'webp' : 'jpg';
  const storedName = `${id}.${ext}`;
  const thumbName = `${id}.webp`;
  const outFile = path.join(eventDir, 'uploads', storedName);
  const thumbFile = path.join(eventDir, 'thumbs', thumbName);

  const base = () =>
    sharp(tmpFile, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate() // aplica a orientação EXIF
      .toColorspace('srgb');

  let info: OutputInfo;
  try {
    const pipeline = base().resize({
      width: opts.maxDimension,
      height: opts.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
    info =
      opts.format === 'webp'
        ? await pipeline.webp({ quality: opts.quality, effort: 4 }).toFile(outFile)
        : await pipeline
            .flatten({ background: '#000000' })
            .jpeg({ quality: opts.quality, mozjpeg: true, chromaSubsampling: opts.quality >= 90 ? '4:4:4' : '4:2:0' })
            .toFile(outFile);
    await base()
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toFile(thumbFile);
  } catch (err) {
    await fs.rm(outFile, { force: true }).catch(() => undefined);
    await fs.rm(thumbFile, { force: true }).catch(() => undefined);
    if (err instanceof InvalidImageError) throw err;
    throw new InvalidImageError('A imagem está corrompida ou não pôde ser processada.');
  }

  let originalKeptName: string | null = null;
  if (opts.keepOriginal) {
    originalKeptName = `${id}.${sourceFormat === 'jpeg' ? 'jpg' : sourceFormat}`;
    await fs.copyFile(tmpFile, path.join(eventDir, 'originals', originalKeptName));
  }

  return {
    storedName,
    thumbName,
    originalKeptName,
    width: info.width,
    height: info.height,
    storedSize: info.size,
    format: opts.format,
    sourceFormat,
  };
}

/** Logotipo: normaliza para PNG de até 512px. */
export async function processLogo(tmpFile: string, outFile: string) {
  const type = await detectImageType(tmpFile);
  if (!type) throw new InvalidImageError('O logotipo deve ser PNG, JPG ou WebP.');
  try {
    await sharp(tmpFile, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(outFile);
  } catch {
    throw new InvalidImageError('Não foi possível processar o logotipo.');
  }
}
