/**
 * Mutex assíncrono simples (fila FIFO de operações).
 * Garante que operações de escrita de metadados nunca se sobreponham.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(() => fn());
    // A cadeia continua mesmo que a operação falhe.
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Semáforo para limitar trabalhos pesados simultâneos (ex.: processamento de imagens). */
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}

  get pending() {
    return this.waiters.length;
  }
  get running() {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release() {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
