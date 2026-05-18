import { query } from '../../../core/database/connection';

export interface CacheStatus {
  cacheKey: string;
  status: 'fresh' | 'stale' | 'refreshing' | 'error' | 'fast_complete';
  lastRefreshAt: Date | null;
  nextRefreshAt: Date | null;
  recordCount: number;
  sourceType: string;
  isStale: boolean;
}

const STALE_THRESHOLD_MS = 6 * 3600 * 1000; // 6 hours
const REFRESH_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function getCacheStatus(cacheKey: string): Promise<CacheStatus> {
  const result = await query(
    `SELECT * FROM cache_metadata WHERE cache_key = $1`,
    [cacheKey]
  );

  if (result.rows.length === 0) {
    return {
      cacheKey,
      status: 'stale',
      lastRefreshAt: null,
      nextRefreshAt: null,
      recordCount: 0,
      sourceType: 'splunk',
      isStale: true,
    };
  }

  const row = result.rows[0];
  const lastRefresh = row.last_refresh_at ? new Date(row.last_refresh_at) : null;
  const isStale = !lastRefresh || (Date.now() - lastRefresh.getTime()) > STALE_THRESHOLD_MS;

  return {
    cacheKey: row.cache_key,
    status: row.status,
    lastRefreshAt: lastRefresh,
    nextRefreshAt: row.next_refresh_at ? new Date(row.next_refresh_at) : null,
    recordCount: row.record_count,
    sourceType: row.source_type,
    isStale: isStale || row.status === 'stale',
  };
}

export async function isRefreshing(cacheKey: string): Promise<boolean> {
  const result = await query(
    `SELECT status, updated_at FROM cache_metadata WHERE cache_key = $1`,
    [cacheKey]
  );
  const row = result.rows[0];
  if (!row || row.status !== 'refreshing') return false;

  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  const isStaleLock = !updatedAt || (Date.now() - updatedAt.getTime()) > REFRESH_LOCK_TIMEOUT_MS;

  if (isStaleLock) {
    await query(
      `UPDATE cache_metadata SET status = 'stale', updated_at = NOW() WHERE cache_key = $1`,
      [cacheKey]
    );
    return false;
  }

  return true;
}

export async function setCacheRefreshing(cacheKey: string): Promise<void> {
  await query(
    `
    INSERT INTO cache_metadata (cache_key, status, updated_at)
    VALUES ($1, 'refreshing', NOW())
    ON CONFLICT (cache_key)
    DO UPDATE SET status = 'refreshing', updated_at = NOW()
    `,
    [cacheKey]
  );
}

export async function setCacheFresh(cacheKey: string, recordCount?: number): Promise<void> {
  await query(
    `
    INSERT INTO cache_metadata (cache_key, status, last_refresh_at, updated_at, record_count)
    VALUES ($1, 'fresh', NOW(), NOW(), COALESCE($2, 0))
    ON CONFLICT (cache_key)
    DO UPDATE SET status = 'fresh', last_refresh_at = NOW(), updated_at = NOW(), record_count = COALESCE($2, cache_metadata.record_count)
    `,
    [cacheKey, recordCount || 0]
  );
}

export async function setCacheError(cacheKey: string, errorMessage: string): Promise<void> {
  await query(
    `
    INSERT INTO cache_metadata (cache_key, status, error_message, updated_at)
    VALUES ($1, 'error', $2, NOW())
    ON CONFLICT (cache_key)
    DO UPDATE SET status = 'error', error_message = $2, updated_at = NOW()
    `,
    [cacheKey, errorMessage]
  );
}

export async function listCacheStatuses(): Promise<CacheStatus[]> {
  const result = await query(`SELECT * FROM cache_metadata ORDER BY updated_at DESC`);
  return result.rows.map((row) => {
    const lastRefresh = row.last_refresh_at ? new Date(row.last_refresh_at) : null;
    return {
      cacheKey: row.cache_key,
      status: row.status,
      lastRefreshAt: lastRefresh,
      nextRefreshAt: row.next_refresh_at ? new Date(row.next_refresh_at) : null,
      recordCount: row.record_count,
      sourceType: row.source_type,
      isStale: !lastRefresh || (Date.now() - lastRefresh.getTime()) > STALE_THRESHOLD_MS,
    };
  });
}
