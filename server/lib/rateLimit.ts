/** Limitador de requisições por chave (IP) em janela deslizante, em memória. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private timer: NodeJS.Timeout;

  constructor(private windowMs: number, private max: () => number) {
    this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 60_000));
    this.timer.unref();
  }

  take(key: string, cost = 1): { ok: boolean; retryAfterSec: number } {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length + cost > this.max()) {
      this.hits.set(key, list);
      const retry = list.length ? Math.ceil((this.windowMs - (now - list[0])) / 1000) : 1;
      return { ok: false, retryAfterSec: Math.max(1, retry) };
    }
    for (let i = 0; i < cost; i++) list.push(now);
    this.hits.set(key, list);
    return { ok: true, retryAfterSec: 0 };
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  stop() {
    clearInterval(this.timer);
  }

  private sweep() {
    const now = Date.now();
    for (const [k, list] of this.hits) {
      const kept = list.filter((t) => now - t < this.windowMs);
      if (kept.length) this.hits.set(k, kept);
      else this.hits.delete(k);
    }
  }
}
