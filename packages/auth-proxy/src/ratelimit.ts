export interface RateLimiterOptions {
  /** Bucket size — how many requests a key may burst. */
  capacity: number;
  /** Tokens regained per second. */
  refillPerSec: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export type RateLimiter = (key: string) => boolean;

/**
 * Token-bucket limiter for the auth endpoints. Memory-bounded: buckets are
 * pruned once they are full again (an idle key costs nothing).
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { tokens: number; last: number }>();

  return (key: string): boolean => {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: options.capacity, last: t };
      buckets.set(key, bucket);
    } else {
      bucket.tokens = Math.min(
        options.capacity,
        bucket.tokens + ((t - bucket.last) / 1000) * options.refillPerSec,
      );
      bucket.last = t;
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;

    // opportunistic prune: drop refilled-to-full buckets other than this one
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (k !== key && b.tokens >= options.capacity) buckets.delete(k);
      }
    }
    return true;
  };
}

/** Client IP: Cloudflare header first, then XFF's first hop, then the socket. */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | undefined,
): string {
  const cf = headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  const xff = headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0]!.trim();
  return socketAddress ?? "unknown";
}
