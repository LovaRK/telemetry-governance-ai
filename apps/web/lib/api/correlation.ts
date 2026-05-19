/**
 * CORRELATION CONTEXT — Distributed Tracing Support
 * Minimal utility for getting correlation ID in client-side code
 */

let currentCorrelationId: string | null = null;

export function setCorrelationId(id: string): void {
  currentCorrelationId = id;
}

export function getCorrelationId(): string | null {
  return currentCorrelationId;
}

export function generateCorrelationId(): string {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  setCorrelationId(id);
  return id;
}

export function clearCorrelationId(): void {
  currentCorrelationId = null;
}
