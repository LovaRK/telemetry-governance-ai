import { DecisionTrace, STAGE_ORDER } from './types';

export class DecisionTraceCollector {
  private traces: DecisionTrace[] = [];
  private traceId: string;

  constructor(traceId?: string) {
    this.traceId = traceId || `trace-${Date.now().toString(36)}`;
  }

  add(trace: Omit<DecisionTrace, 'timestamp' | 'stage_order' | 'trace_id'>) {
    const fullTrace: DecisionTrace = {
      ...trace,
      stage_order: STAGE_ORDER[trace.stage] || 0,
      timestamp: new Date().toISOString(),
      trace_id: this.traceId
    };
    this.traces.push(fullTrace);
    return fullTrace;
  }

  addFromStage(
    stage: string,
    input: any,
    output: any,
    reasoning: string,
    evidence: string[],
    confidence: number,
    duration_ms: number
  ) {
    return this.add({
      stage,
      input: this.sanitizeInput(input),
      output: this.sanitizeOutput(output),
      reasoning,
      evidence,
      confidence,
      duration_ms
    });
  }

  private sanitizeInput(input: any): any {
    if (!input) return {};
    if (typeof input === 'string') return { summary: input.substring(0, 500) };
    if (input.mcp_url || input.token) {
      return { ...input, mcp_url: '[REDACTED]', token: '[REDACTED]' };
    }
    return this.truncateObject(input, 20);
  }

  private sanitizeOutput(output: any): any {
    return this.truncateObject(output, 30);
  }

  private truncateObject(obj: any, maxKeys: number): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) {
      return obj.slice(0, 5).map(item => this.truncateObject(item, maxKeys));
    }
    const keys = Object.keys(obj).slice(0, maxKeys);
    const result: any = {};
    for (const key of keys) {
      result[key] = this.truncateObject(obj[key], maxKeys);
    }
    return result;
  }

  getAll(): DecisionTrace[] {
    return [...this.traces].sort((a, b) => a.stage_order - b.stage_order);
  }

  getByStage(stage: string): DecisionTrace[] {
    return this.traces.filter(t => t.stage === stage);
  }

  getTraceId(): string {
    return this.traceId;
  }

  getOverallConfidence(): number {
    if (this.traces.length === 0) return 0;
    const sum = this.traces.reduce((acc, t) => acc + t.confidence, 0);
    return sum / this.traces.length;
  }

  reset() {
    this.traces = [];
    this.traceId = `trace-${Date.now().toString(36)}`;
  }
}

export const globalTraceCollector = new DecisionTraceCollector();