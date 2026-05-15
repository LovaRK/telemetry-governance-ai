import { query, transaction } from '../../../core/database/connection';
import { DecisionTrace } from '../../../core/traceability/types';

export interface StoredTrace {
  id: number;
  traceId: string;
  stage: string;
  stageOrder: number;
  input: any;
  output: any;
  reasoning: string;
  evidence: string[];
  confidence: number;
  durationMs: number;
  timestamp: string;
}

export async function saveTrace(trace: DecisionTrace): Promise<void> {
  await query(
    `
    INSERT INTO decision_traces (trace_id, stage, stage_order, input, output, reasoning, evidence, confidence, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      trace.trace_id,
      trace.stage,
      trace.stage_order,
      JSON.stringify(trace.input),
      JSON.stringify(trace.output),
      trace.reasoning,
      JSON.stringify(trace.evidence),
      trace.confidence,
      trace.duration_ms,
    ]
  );
}

export async function saveTraces(traces: DecisionTrace[]): Promise<void> {
  await transaction(async (client) => {
    for (const trace of traces) {
      await client.query(
        `
        INSERT INTO decision_traces (trace_id, stage, stage_order, input, output, reasoning, evidence, confidence, duration_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          trace.trace_id,
          trace.stage,
          trace.stage_order,
          JSON.stringify(trace.input),
          JSON.stringify(trace.output),
          trace.reasoning,
          JSON.stringify(trace.evidence),
          trace.confidence,
          trace.duration_ms,
        ]
      );
    }
  });
}

export async function getTracesByTraceId(traceId: string): Promise<StoredTrace[]> {
  const result = await query(
    `SELECT * FROM decision_traces WHERE trace_id = $1 ORDER BY stage_order ASC`,
    [traceId]
  );
  return result.rows.map(mapRow);
}

export async function getTracesByDateRange(start: Date, end: Date): Promise<StoredTrace[]> {
  const result = await query(
    `SELECT * FROM decision_traces WHERE timestamp BETWEEN $1 AND $2 ORDER BY timestamp DESC`,
    [start.toISOString(), end.toISOString()]
  );
  return result.rows.map(mapRow);
}

function mapRow(row: any): StoredTrace {
  return {
    id: row.id,
    traceId: row.trace_id,
    stage: row.stage,
    stageOrder: row.stage_order,
    input: typeof row.input === 'string' ? JSON.parse(row.input) : row.input,
    output: typeof row.output === 'string' ? JSON.parse(row.output) : row.output,
    reasoning: row.reasoning,
    evidence: Array.isArray(row.evidence) ? row.evidence : JSON.parse(row.evidence || '[]'),
    confidence: parseFloat(row.confidence),
    durationMs: row.duration_ms,
    timestamp: row.timestamp,
  };
}
