/**
 * MCP Circuit Breaker
 *
 * Provides resilience for Splunk MCP/REST API calls.
 * Without circuit breaking, a slow or unavailable Splunk instance will
 * cause request thread exhaustion and cascade failures.
 *
 * States:
 *   HEALTHY       — Normal operation. All requests pass through.
 *   DEGRADED      — High error rate or elevated latency. Still attempting, logging.
 *   TIMEOUT       — Requests are timing out. Retry with backoff.
 *   PARTIAL_RESULTS — Some endpoints working, others failing (partial data).
 *   UNAVAILABLE   — Circuit open. Returning stale cache or failing fast.
 *
 * Retry policy:
 *   - Max 3 attempts
 *   - Exponential backoff: 1s → 2s → 4s
 *   - Jitter: ±20% to prevent thundering herd
 *
 * Stale cache fallback:
 *   - When UNAVAILABLE, returns last known-good response if available
 *   - Stale cache TTL: 5 minutes
 *   - UI shows degraded banner when stale data is served
 */

export type MCPCircuitState =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'TIMEOUT'
  | 'PARTIAL_RESULTS'
  | 'UNAVAILABLE';

export interface CircuitBreakerConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  errorThresholdPct: number;   // % errors to trigger DEGRADED
  openThresholdPct: number;    // % errors to trigger UNAVAILABLE
  windowSizeMs: number;        // rolling window for error rate calculation
  staleCacheTtlMs: number;     // how long stale cache is valid
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  timeoutMs: 30000,
  errorThresholdPct: 20,   // >20% errors → DEGRADED
  openThresholdPct: 50,    // >50% errors → UNAVAILABLE
  windowSizeMs: 60_000,    // 1 minute rolling window
  staleCacheTtlMs: 5 * 60_000, // 5 minute stale cache
};

// ─────────────────────────────────────────────
// Result Types
// ─────────────────────────────────────────────

export interface CircuitBreakerResult<T> {
  data: T | null;
  state: MCPCircuitState;
  from_cache: boolean;
  retry_count: number;
  latency_ms: number;
  error?: string;
}

// ─────────────────────────────────────────────
// Circuit Breaker
// ─────────────────────────────────────────────

interface WindowEntry {
  timestamp: number;
  success: boolean;
  latency_ms: number;
}

interface CacheEntry<T> {
  data: T;
  stored_at: number;
}

export class MCPCircuitBreaker {
  private state: MCPCircuitState = 'HEALTHY';
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;
  private window: WindowEntry[] = [];
  private stateChangedAt: number = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private staleCache = new Map<string, CacheEntry<any>>();

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  /**
   * Execute a function with circuit breaker protection.
   *
   * @param fn       - Async function to execute (the MCP/Splunk call)
   * @param cacheKey - Optional key for stale cache fallback
   */
  async execute<T>(
    fn: () => Promise<T>,
    cacheKey?: string
  ): Promise<CircuitBreakerResult<T>> {
    const startTime = Date.now();

    // Fast-fail if circuit is open
    if (this.state === 'UNAVAILABLE') {
      const stale = cacheKey ? this.getStaleCache<T>(cacheKey) : null;

      if (stale) {
        console.warn(`[MCP_CIRCUIT:${this.name}] UNAVAILABLE — serving stale cache`, {
          cache_key: cacheKey,
          state_age_ms: Date.now() - this.stateChangedAt,
          timestamp: new Date().toISOString()
        });
        return {
          data: stale,
          state: 'UNAVAILABLE',
          from_cache: true,
          retry_count: 0,
          latency_ms: Date.now() - startTime
        };
      }

      return {
        data: null,
        state: 'UNAVAILABLE',
        from_cache: false,
        retry_count: 0,
        latency_ms: Date.now() - startTime,
        error: `Circuit breaker open for ${this.name}`
      };
    }

    // Execute with retry
    let lastError: Error | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      retryCount = attempt;

      if (attempt > 0) {
        const delay = this.computeBackoff(attempt);
        await sleep(delay);
      }

      try {
        const data = await withTimeout(fn(), this.config.timeoutMs);
        const latency = Date.now() - startTime;

        this.recordSuccess(latency);
        if (cacheKey) this.setStaleCache(cacheKey, data);

        this.updateState();

        return {
          data,
          state: this.state,
          from_cache: false,
          retry_count: retryCount,
          latency_ms: latency
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const latency = Date.now() - startTime;
        const isTimeout = lastError.message.includes('timeout') || lastError.message.includes('TIMEOUT');

        this.recordFailure(latency, isTimeout);
        this.updateState();

        console.warn(`[MCP_CIRCUIT:${this.name}] Attempt ${attempt + 1}/${this.config.maxRetries + 1} failed`, {
          error: lastError.message,
          state: this.state,
          latency_ms: latency,
          timestamp: new Date().toISOString()
        });
      }
    }

    // All retries exhausted — try stale cache
    const stale = cacheKey ? this.getStaleCache<T>(cacheKey) : null;
    if (stale) {
      return {
        data: stale,
        state: this.state,
        from_cache: true,
        retry_count: retryCount,
        latency_ms: Date.now() - startTime,
        error: lastError?.message
      };
    }

    return {
      data: null,
      state: this.state,
      from_cache: false,
      retry_count: retryCount,
      latency_ms: Date.now() - startTime,
      error: lastError?.message ?? 'Unknown error'
    };
  }

  getState(): MCPCircuitState {
    return this.state;
  }

  getStats(): {
    state: MCPCircuitState;
    state_age_ms: number;
    window_size: number;
    error_rate_pct: number;
    avg_latency_ms: number;
  } {
    this.pruneWindow();
    const total = this.window.length;
    const errors = this.window.filter(e => !e.success).length;
    const avgLatency = total > 0
      ? this.window.reduce((sum, e) => sum + e.latency_ms, 0) / total
      : 0;

    return {
      state: this.state,
      state_age_ms: Date.now() - this.stateChangedAt,
      window_size: total,
      error_rate_pct: total > 0 ? (errors / total) * 100 : 0,
      avg_latency_ms: Math.round(avgLatency)
    };
  }

  // ─────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────

  private recordSuccess(latency_ms: number): void {
    this.pruneWindow();
    this.window.push({ timestamp: Date.now(), success: true, latency_ms });
  }

  private recordFailure(latency_ms: number, isTimeout: boolean): void {
    this.pruneWindow();
    this.window.push({ timestamp: Date.now(), success: false, latency_ms });
    if (isTimeout && this.state !== 'UNAVAILABLE') {
      this.transitionTo('TIMEOUT');
    }
  }

  private updateState(): void {
    this.pruneWindow();
    const total = this.window.length;
    if (total < 5) return; // Not enough data to make state decisions

    const errorRate = this.window.filter(e => !e.success).length / total * 100;

    if (errorRate >= this.config.openThresholdPct) {
      this.transitionTo('UNAVAILABLE');
    } else if (errorRate >= this.config.errorThresholdPct) {
      this.transitionTo('DEGRADED');
    } else if (this.state !== 'HEALTHY') {
      this.transitionTo('HEALTHY');
    }
  }

  private transitionTo(newState: MCPCircuitState): void {
    if (newState === this.state) return;

    const prev = this.state;
    this.state = newState;
    this.stateChangedAt = Date.now();

    const level = newState === 'HEALTHY' ? 'info' : 'warn';
    console[level](`[MCP_CIRCUIT:${this.name}] State transition: ${prev} → ${newState}`, {
      timestamp: new Date().toISOString()
    });
  }

  private pruneWindow(): void {
    const cutoff = Date.now() - this.config.windowSizeMs;
    this.window = this.window.filter(e => e.timestamp > cutoff);
  }

  private computeBackoff(attempt: number): number {
    const base = Math.min(
      this.config.baseDelayMs * Math.pow(2, attempt - 1),
      this.config.maxDelayMs
    );
    // Add ±20% jitter
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.round(base + jitter);
  }

  private getStaleCache<T>(key: string): T | null {
    const entry = this.staleCache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.stored_at > this.config.staleCacheTtlMs) {
      this.staleCache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setStaleCache<T>(key: string, data: T): void {
    this.staleCache.set(key, { data, stored_at: Date.now() });
  }
}

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`TIMEOUT after ${timeoutMs}ms`)),
      timeoutMs
    );
    promise.then(
      result => { clearTimeout(timer); resolve(result); },
      error  => { clearTimeout(timer); reject(error); }
    );
  });
}

// ─────────────────────────────────────────────
// Global circuit breaker registry
// ─────────────────────────────────────────────

const registry = new Map<string, MCPCircuitBreaker>();

/**
 * Get or create a named circuit breaker.
 * Use named breakers to group related MCP calls (e.g., all Splunk REST calls).
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): MCPCircuitBreaker {
  if (!registry.has(name)) {
    registry.set(name, new MCPCircuitBreaker(name, config));
  }
  return registry.get(name)!;
}

/**
 * Get health summary for all registered circuit breakers.
 * Used by the governance self-observability system.
 */
export function getAllCircuitBreakerStats(): Record<string, ReturnType<MCPCircuitBreaker['getStats']>> {
  const result: Record<string, ReturnType<MCPCircuitBreaker['getStats']>> = {};
  for (const [name, breaker] of registry) {
    result[name] = breaker.getStats();
  }
  return result;
}
