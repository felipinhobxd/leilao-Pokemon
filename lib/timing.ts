// Per-request measurements only: never log tokens, URLs, QR or response data.
export class Timing {
  private started = performance.now();
  private values: string[] = [];
  async measure<T>(name: string, task: () => PromiseLike<T>): Promise<T> {
    const start = performance.now();
    try { return await task(); }
    finally { this.values.push(`${name};dur=${(performance.now()-start).toFixed(2)}`); }
  }
  headers() {
    return { "Cache-Control": "no-store", "Server-Timing": [...this.values, `total;dur=${(performance.now()-this.started).toFixed(2)}`].join(", ") };
  }
}
