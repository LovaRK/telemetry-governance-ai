/**
 * AuditRateLimiter
 *
 * Per-tenant rate limiting for audit endpoints to prevent abuse:
 * - Prevents attackers from flooding audit logs with fake entries
 * - Prevents reconnaissance attacks (mass querying of operator actions)
 * - Prevents denial-of-service through audit endpoint exhaustion
 *
 * Uses in-memory token bucket algorithm per tenant.
 * For distributed systems, replace with Redis-backed limiter.
 */

export interface RateLimitConfig {
  requestsPerMinute: number;
  burstSize: number; // Allow short bursts above the per-minute rate
}

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
}

export class AuditRateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { requestsPerMinute: 60, burstSize: 10 }) {
    this.config = config;
  }

  /**
   * Check if a tenant can make an audit request.
   * Uses token bucket algorithm: refill at requestsPerMinute rate.
   * Bucket size is min(burstSize, requestsPerMinute).
   */
  checkLimit(tenantId: string): { allowed: boolean; remaining: number; resetAt: Date } {
    const now = Date.now();
    const maxTokens = Math.min(this.config.burstSize, this.config.requestsPerMinute);

    let bucket = this.buckets.get(tenantId);

    if (!bucket) {
      // Initialize new bucket
      bucket = {
        tokens: maxTokens,
        lastRefillAt: now,
      };
      this.buckets.set(tenantId, bucket);
    }

    // Calculate tokens to refill based on time elapsed
    const timeSinceRefill = (now - bucket.lastRefillAt) / 1000 / 60; // Minutes elapsed
    const tokensToAdd = timeSinceRefill * this.config.requestsPerMinute;

    // Refill tokens (capped at maxTokens)
    bucket.tokens = Math.min(maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefillAt = now;

    // Check if request is allowed
    const allowed = bucket.tokens >= 1;

    if (allowed) {
      bucket.tokens -= 1;
    }

    // Calculate next reset time (when bucket refills to max)
    const tokensNeeded = maxTokens - bucket.tokens;
    const minutesUntilReset = tokensNeeded / this.config.requestsPerMinute;
    const resetAt = new Date(now + minutesUntilReset * 60 * 1000);

    return {
      allowed,
      remaining: Math.floor(bucket.tokens),
      resetAt,
    };
  }

  /**
   * Reset rate limit for a tenant (admin function)
   */
  reset(tenantId: string): void {
    this.buckets.delete(tenantId);
  }

  /**
   * Get current bucket state (for monitoring)
   */
  getState(tenantId: string): TokenBucket | null {
    return this.buckets.get(tenantId) || null;
  }
}
