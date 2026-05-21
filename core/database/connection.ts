import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { RequestContext } from '../../packages/auth/request-context';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://telemetry:telemetry@localhost:5433/telemetry_os';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
  process.exit(-1);
});

async function setTenantContext(client: PoolClient, tenantId: string): Promise<void> {
  await client.query('SET app.current_tenant = $1', [tenantId]);
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[],
  context?: RequestContext
): Promise<QueryResult<T>> {
  const start = Date.now();

  if (!context) {
    // Fast path: no context, use pool directly
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount });
    }
    return result;
  }

  // Context provided: use client to set session variable for RLS
  const client = await pool.connect();
  try {
    await setTenantContext(client, context.tenantId);
    const result = await client.query<T>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text: text.substring(0, 100), duration, rows: result.rowCount, tenantId: context.tenantId });
    }
    return result;
  } finally {
    client.release();
  }
}

export async function getClient(context?: RequestContext): Promise<PoolClient> {
  const client = await pool.connect();
  if (context) {
    await setTenantContext(client, context.tenantId);
  }
  return client;
}

export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  context?: RequestContext
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (context) {
      await setTenantContext(client, context.tenantId);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { pool };
