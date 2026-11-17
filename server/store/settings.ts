import path from 'node:path';
import crypto from 'node:crypto';
import type { Settings, TransmissionMode } from '../../lib/shared/types';
import { readJson, writeJsonAtomic } from '../lib/jsonStore';
import { Mutex } from '../lib/mutex';
import { normalizeBaseUrl } from '../config';
import { DEFAULT_FRAME, isFrame } from '../../lib/shared/frames';
import { DEFAULT_THEME_ID, isTheme } from '../../lib/shared/themes';

export const DEFAULT_SETTINGS: Settings = {
  maxFilesPerUpload: 3,
  maxFileSizeMB: 10,
  displaySeconds: 8,
  transitionMs: 1200,
  imageFormat: 'webp',
  imageQuality: 85,
  maxImageDimension: 2560,
  keepOriginals: false,
  retentionHours: 48,
  autoCleanup: true,
  publicBaseUrl: '',
  qrMode: 'auto',
  preferredLocalIp: '',
  showIndicators: true,
  blurBackground: true,
  uploadRateLimitPerIp: 30,
  branding: {
    systemName: 'Mural de Fotos',
    primaryColor: '#7c3aed',
    secondaryColor: '#ec4899',
    welcomeMessage: 'Compartilhe seus melhores momentos! Escolha suas fotos e veja-as aparecer no telão.',
    waitingMessage: 'Queremos ver este momento pelos seus olhos!',
    hasLogo: false,
    logoVersion: 0,
    frame: DEFAULT_FRAME,
    theme: DEFAULT_THEME_ID,
  },
};

interface InternalState {
  displayKey: string;
  sessionVersion: number;
  transmissionMode: TransmissionMode;
}

interface SettingsFile {
  settings: Settings;
  internal: InternalState;
}

const clamp = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const str = (v: unknown, max: number, def: string) => (typeof v === 'string' ? v.trim().slice(0, max) : def);
const color = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Valida e normaliza uma alteração parcial de configurações. */
export function sanitizeSettings(input: Partial<Settings> & Record<string, unknown>, base: Settings): Settings {
  const b = (input.branding || {}) as Partial<Settings['branding']>;
  return {
    maxFilesPerUpload: Math.round(clamp(input.maxFilesPerUpload, 1, 10, base.maxFilesPerUpload)),
    maxFileSizeMB: Math.round(clamp(input.maxFileSizeMB, 1, 50, base.maxFileSizeMB)),
    displaySeconds: Math.round(clamp(input.displaySeconds, 2, 300, base.displaySeconds) * 10) / 10,
    transitionMs: Math.round(clamp(input.transitionMs, 0, 5000, base.transitionMs)),
    imageFormat: input.imageFormat === 'jpeg' || input.imageFormat === 'webp' ? input.imageFormat : base.imageFormat,
    imageQuality: Math.round(clamp(input.imageQuality, 50, 100, base.imageQuality)),
    maxImageDimension: Math.round(clamp(input.maxImageDimension, 1024, 4096, base.maxImageDimension)),
    keepOriginals: bool(input.keepOriginals, base.keepOriginals),
    retentionHours: Math.round(clamp(input.retentionHours, 1, 24 * 365, base.retentionHours)),
    autoCleanup: bool(input.autoCleanup, base.autoCleanup),
    publicBaseUrl:
      input.publicBaseUrl === undefined ? base.publicBaseUrl : normalizeBaseUrl(String(input.publicBaseUrl)),
    qrMode: input.qrMode === 'public' || input.qrMode === 'local' || input.qrMode === 'auto' ? input.qrMode : base.qrMode,
    preferredLocalIp:
      input.preferredLocalIp === undefined
        ? base.preferredLocalIp
        : IPV4.test(String(input.preferredLocalIp))
          ? String(input.preferredLocalIp)
          : '',
    showIndicators: bool(input.showIndicators, base.showIndicators),
    blurBackground: bool(input.blurBackground, base.blurBackground),
    uploadRateLimitPerIp: Math.round(clamp(input.uploadRateLimitPerIp, 3, 1000, base.uploadRateLimitPerIp)),
    branding: {
      systemName: str(b.systemName, 60, base.branding.systemName) || DEFAULT_SETTINGS.branding.systemName,
      primaryColor: color(b.primaryColor, base.branding.primaryColor),
      secondaryColor: color(b.secondaryColor, base.branding.secondaryColor),
      welcomeMessage: str(b.welcomeMessage, 300, base.branding.welcomeMessage),
      waitingMessage: str(b.waitingMessage, 200, base.branding.waitingMessage),
      hasLogo: base.branding.hasLogo,
      logoVersion: base.branding.logoVersion,
      frame: isFrame(b.frame) ? b.frame : isFrame(base.branding.frame) ? base.branding.frame : DEFAULT_FRAME,
      theme: isTheme(b.theme) ? b.theme : isTheme(base.branding.theme) ? base.branding.theme : DEFAULT_THEME_ID,
    },
  };
}

export class SettingsStore {
  private data!: SettingsFile;
  private mutex = new Mutex();
  readonly file: string;

  constructor(private dataDir: string) {
    this.file = path.join(dataDir, 'config', 'settings.json');
  }

  async init() {
    const loaded = await readJson<Partial<SettingsFile>>(this.file, {});
    const settings = sanitizeSettings(
      { ...(loaded.settings || {}) } as Partial<Settings> & Record<string, unknown>,
      DEFAULT_SETTINGS,
    );
    if (loaded.settings?.branding) {
      settings.branding.hasLogo = !!loaded.settings.branding.hasLogo;
      settings.branding.logoVersion = Number(loaded.settings.branding.logoVersion) || 0;
    }
    const internal: InternalState = {
      displayKey: loaded.internal?.displayKey || crypto.randomBytes(18).toString('base64url'),
      sessionVersion: Number(loaded.internal?.sessionVersion) || 1,
      transmissionMode: (['running', 'paused', 'stopped'] as const).includes(loaded.internal?.transmissionMode as TransmissionMode)
        ? (loaded.internal!.transmissionMode as TransmissionMode)
        : 'running',
    };
    this.data = { settings, internal };
    await this.persist();
  }

  get(): Settings {
    return structuredClone(this.data.settings);
  }

  get internal(): Readonly<InternalState> {
    return this.data.internal;
  }

  update(patch: Partial<Settings> & Record<string, unknown>): Promise<Settings> {
    return this.mutex.run(async () => {
      this.data.settings = sanitizeSettings(patch, this.data.settings);
      await this.persist();
      return this.get();
    });
  }

  setLogo(present: boolean): Promise<Settings> {
    return this.mutex.run(async () => {
      this.data.settings.branding.hasLogo = present;
      this.data.settings.branding.logoVersion = Date.now();
      await this.persist();
      return this.get();
    });
  }

  setInternal(patch: Partial<InternalState>): Promise<void> {
    return this.mutex.run(async () => {
      this.data.internal = { ...this.data.internal, ...patch };
      await this.persist();
    });
  }

  regenerateDisplayKey() {
    return this.setInternal({ displayKey: crypto.randomBytes(18).toString('base64url') });
  }

  private persist() {
    return writeJsonAtomic(this.file, this.data, { backup: true });
  }
}
