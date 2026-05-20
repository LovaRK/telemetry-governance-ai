/**
 * Pure Event Emitter
 *
 * SINGLE entry point for ALL event emissions.
 * Automatically enriches events with: source + mode + traceId
 *
 * CRITICAL: Replace ALL emit() calls with emitPureEvent()
 *
 * Usage:
 * ```typescript
 * await emitPureEvent({
 *   type: 'decision_executed',
 *   decisionId: '123',
 *   // ... other fields
 * });
 * ```
 */

import { getTraceId } from '@core/guards/trace-context';
import { assertDataPurity } from '@core/guards/data-purity.guard';
import { failLoudly } from '@core/guards/fail-loud';

export interface PureEvent {
  type: string;
  [key: string]: any;
  source?: 'system';
  mode?: 'live';
  traceId?: string;
  timestamp?: string;
}

/**
 * Get the underlying emit function.
 * This is implemented by the event system (EventEmitter, Kafka, etc.)
 * For now, we mock it as a stub that validates purity.
 */
let emitFn: ((event: any) => Promise<void>) | null = null;

export function setEmitFn(fn: (event: any) => Promise<void>) {
  emitFn = fn;
}

/**
 * Emit an event with automatic purity enforcement.
 * Throws if:
 * - traceId missing (not in trace context)
 * - event is null
 * - purity validation fails
 */
export async function emitPureEvent(event: PureEvent) {
  if (!event) {
    failLoudly(new Error('❌ Cannot emit null event'));
  }

  // Get current trace
  const traceId = getTraceId(); // Throws if missing

  // Enrich event
  const enriched: PureEvent = {
    ...event,
    source: 'system',
    mode: 'live',
    traceId,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  // Validate purity
  try {
    assertDataPurity(enriched);
  } catch (error) {
    failLoudly(
      error instanceof Error
        ? error
        : new Error('Event failed purity validation')
    );
  }

  // Emit
  if (!emitFn) {
    console.warn('⚠️  emit function not configured');
    return;
  }

  try {
    await emitFn(enriched);
  } catch (error) {
    // Log but don't throw — event emission shouldn't crash execution
    console.error('Event emission failed:', error);
  }
}
