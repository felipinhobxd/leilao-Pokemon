// Rate limit por usuário (Fase 4.2): protege a cota de signedUrl do
// Supabase contra abuso de um único usuário — sem limite, um usuário
// consegue esgotar o orçamento de URLs assinadas para todos.
//
// - Com REDIS_URL: contador distribuído (INCR + EXPIRE, janela fixa) —
//   correto entre instâncias (deploy serverless/Vercel).
// - Sem REDIS_URL (ou com Redis caído): fallback IN-MEMORY por processo.
//   Honesto e documentado: correto para 1 instância (dev/local); um deploy
//   multi-instância SEM Redis limita por instância, não globalmente.
//   A degradação nunca quebra a rota — um erro de infra não pode derrubar
//   uploads, apenas afrouxar o limite.
//
// Semântica: janela fixa (chave por userId + índice da janela), limite
// default 50 requisições por 60s, 429 com header Retry-After em segundos.

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  backend: "redis" | "memory";
};

export type RateLimitOptions = {
  limit?: number;
  windowSeconds?: number;
  /** Test seam: fixed clock. */
  now?: number;
};

export const DEFAULT_RATE_LIMIT = 50;
export const DEFAULT_RATE_WINDOW_SECONDS = 60;

type MemoryBucket = { count: number; window: number };

const buckets = new Map<string, MemoryBucket>();
const MEMORY_BUCKET_SOFT_CAP = 10_000;

type MinimalRedis = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number, mode?: string): Promise<number>;
};

let redisClient: MinimalRedis | null | undefined;

function windowIndex(now: number, windowSeconds: number): number {
  return Math.floor(now / (windowSeconds * 1000));
}

function retryAfterSeconds(now: number, windowSeconds: number): number {
  const windowEnd = (windowIndex(now, windowSeconds) + 1) * windowSeconds * 1000;
  return Math.max(1, Math.ceil((windowEnd - now) / 1000));
}

function memoryBucket(key: string, window: number): MemoryBucket {
  const current = buckets.get(key);
  if (!current || current.window !== window) {
    if (buckets.size >= MEMORY_BUCKET_SOFT_CAP) {
      // prune: expired entries die first; a fresh map every window anyway.
      for (const [k, v] of buckets) if (v.window < window) buckets.delete(k);
    }
    const fresh = { count: 0, window };
    buckets.set(key, fresh);
    return fresh;
  }
  return current;
}

async function getRedis(): Promise<MinimalRedis | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (redisClient !== undefined) return redisClient;
  try {
    const { default: RedisCtor } = await import("ioredis");
    const client = new RedisCtor(url, {
      // Um Redis caído NUNCA pode travar a rota: falha rápida, degrada para
      // o limite in-memory em vez de enfileirar comandos eternamente.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      connectionName: "leilao-rate-limit",
    });
    client.on("error", () => { /* log silencioso: a degradação é a resposta */ });
    redisClient = client as unknown as MinimalRedis;
  } catch {
    redisClient = null;
  }
  return redisClient;
}

export async function enforceUserRateLimit(
  scope: string,
  userId: string,
  options: RateLimitOptions = {},
): Promise<RateLimitDecision> {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_RATE_LIMIT));
  const windowSeconds = Math.max(1, Math.floor(options.windowSeconds ?? DEFAULT_RATE_WINDOW_SECONDS));
  const now = options.now ?? Date.now();
  const window = windowIndex(now, windowSeconds);
  const key = `rl:${scope}:${userId}:${window}`;

  const redis = await getRedis();
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds + 1, "NX").catch(() => {});
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: retryAfterSeconds(now, windowSeconds),
        backend: "redis",
      };
    } catch {
      // Redis indisponível no meio da contagem: degrada sem quebrar a rota.
      redisClient = null;
    }
  }

  const bucket = memoryBucket(key, window);
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: retryAfterSeconds(now, windowSeconds),
    backend: "memory",
  };
}

/** Test seam: limpa o estado in-memory e desconecta o Redis mockado. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
  redisClient = undefined;
}
