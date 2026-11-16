// Tipos compartilhados entre servidor e navegador.

export type EventStatus = 'planned' | 'active' | 'paused' | 'finished';
export type PhotoStatus = 'queued' | 'playing' | 'displayed' | 'rejected';
export type PhotoFolder = 'uploads' | 'displayed' | 'rejected';
export type TransmissionMode = 'running' | 'paused' | 'stopped';

export interface EventRecord {
  id: string;
  name: string;
  description: string;
  status: EventStatus;
  createdAt: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  finishedAt: string | null;
  purgedAt: string | null;
  /** Próxima posição de fila (monotônica, atribuída pelo servidor). */
  nextPosition: number;
  /** Estatísticas congeladas quando as fotos são apagadas (limpeza). */
  archivedStats: EventStats | null;
}

export interface EventStats {
  received: number;
  queued: number;
  playing: number;
  displayed: number;
  rejected: number;
}

export interface PhotoRecord {
  id: string;
  eventId: string;
  originalName: string;
  storedName: string;
  folder: PhotoFolder;
  /** Caminho relativo à pasta do evento (nunca o caminho físico). */
  path: string;
  thumbName: string | null;
  originalKeptName: string | null;
  receivedAt: string;
  position: number;
  originalSize: number;
  storedSize: number;
  width: number;
  height: number;
  format: string;
  status: PhotoStatus;
  playedAt: string | null;
  displayedAt: string | null;
  rejectedAt: string | null;
  skipped: boolean;
  timesDisplayed: number;
  clientId: string | null;
  /** Legenda opcional escrita por quem enviou a foto (vazia se não houver). */
  caption?: string;
}

export interface Branding {
  systemName: string;
  primaryColor: string;
  secondaryColor: string;
  welcomeMessage: string;
  waitingMessage: string;
  hasLogo: boolean;
  logoVersion: number;
}

export interface Settings {
  maxFilesPerUpload: number;
  maxFileSizeMB: number;
  displaySeconds: number;
  transitionMs: number;
  imageFormat: 'webp' | 'jpeg';
  imageQuality: number;
  maxImageDimension: number;
  keepOriginals: boolean;
  retentionHours: number;
  autoCleanup: boolean;
  publicBaseUrl: string;
  qrMode: 'auto' | 'public' | 'local';
  preferredLocalIp: string;
  showIndicators: boolean;
  blurBackground: boolean;
  uploadRateLimitPerIp: number;
  branding: Branding;
}

export interface PublicPhoto {
  id: string;
  eventId: string;
  width: number;
  height: number;
  url: string;
  caption: string;
}

export interface PlaybackSnapshot {
  mode: TransmissionMode;
  /** running && há tela conectada */
  effective: 'playing' | 'idle' | 'paused' | 'waiting-display' | 'stopped' | 'no-event';
  current: {
    photo: PublicPhoto;
    startedAt: number;
    endsAt: number | null;
    remainingMs: number;
    displayMs: number;
    transitionMs: number;
  } | null;
  upcoming: PublicPhoto | null;
  queueCount: number;
  displays: number;
  serverNow: number;
}

export interface DisplayStatus {
  playback: PlaybackSnapshot;
  event: { id: string; name: string; status: EventStatus } | null;
  branding: Branding;
  showIndicators: boolean;
  blurBackground: boolean;
  transitionMs: number;
  qrUrl: string;
}

export interface PublicStatus {
  systemName: string;
  branding: Branding;
  event: { name: string; description: string } | null;
  state: 'open' | 'paused' | 'closed';
  limits: { maxFiles: number; maxFileSizeMB: number; accept: string[] };
}
