/**
 * METRICS EXPORTER
 * Prometheus metrics for observability
 * Tracks: job duration, errors, retry rates, pipeline health
 */

import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-otlp-http';
import { metrics as apiMetrics, ValueType } from '@opentelemetry/api';

/**
 * Metrics instance
 */
let metricsInstance: any;

/**
 * Initialize Prometheus metrics
 */
export function initializeMetrics(
  serviceName: string = 'governance-platform',
  otlpEndpoint: string = 'http://localhost:4318'
): void {
  const exporter = new OTLPMetricExporter({
    url: otlpEndpoint + '/v1/metrics',
  });

  const meterProvider = new MeterProvider({
    resource: {
      attributes: {
        'service.name': serviceName,
      },
    },
    readers: [
      new PeriodicExportingMetricReader({
        exporter,
        intervalMillis: 10000, // Export every 10s
      }),
    ],
  });

  apiMetrics.setGlobalMeterProvider(meterProvider);
  metricsInstance = meterProvider.getMeter(serviceName);

  console.log(`[Metrics] Initialized: ${serviceName}`);
}

/**
 * Get global meter
 */
export function getMeter() {
  if (!metricsInstance) {
    metricsInstance = apiMetrics.getMeter('uninitialized');
  }
  return metricsInstance;
}

/**
 * COUNTERS
 */

export class JobMetrics {
  private meter = getMeter();

  private jobsStarted = this.meter.createCounter('jobs_started', {
    description: 'Number of jobs started',
    unit: '1',
  });

  private jobsCompleted = this.meter.createCounter('jobs_completed', {
    description: 'Number of jobs completed successfully',
    unit: '1',
  });

  private jobsFailed = this.meter.createCounter('jobs_failed', {
    description: 'Number of jobs failed',
    unit: '1',
  });

  private jobsRetried = this.meter.createCounter('jobs_retried', {
    description: 'Number of job retries',
    unit: '1',
  });

  private jobDuration = this.meter.createHistogram('job_duration_ms', {
    description: 'Job execution duration',
    unit: 'ms',
  });

  private pipelineLatency = this.meter.createHistogram('pipeline_latency_ms', {
    description: 'End-to-end pipeline latency',
    unit: 'ms',
  });

  recordJobStarted(topic: string, tenantId: string): void {
    this.jobsStarted.add(1, {
      topic,
      tenant: tenantId,
    });
  }

  recordJobCompleted(topic: string, tenantId: string, durationMs: number): void {
    this.jobsCompleted.add(1, {
      topic,
      tenant: tenantId,
    });
    this.jobDuration.record(durationMs, {
      topic,
      status: 'success',
    });
  }

  recordJobFailed(topic: string, tenantId: string, durationMs: number, errorCode: string): void {
    this.jobsFailed.add(1, {
      topic,
      tenant: tenantId,
      error: errorCode,
    });
    this.jobDuration.record(durationMs, {
      topic,
      status: 'failed',
    });
  }

  recordJobRetried(topic: string, attempt: number): void {
    this.jobsRetried.add(1, {
      topic,
      attempt: String(attempt),
    });
  }

  recordPipelineLatency(tenantId: string, totalMs: number, stageCount: number): void {
    this.pipelineLatency.record(totalMs, {
      tenant: tenantId,
      stages: String(stageCount),
    });
  }
}

/**
 * GAUGES
 */

export class QueueMetrics {
  private meter = getMeter();

  private queueDepth = this.meter.createObservableGauge('queue_depth', {
    description: 'Current queue depth per topic',
    unit: '1',
  });

  private dlqSize = this.meter.createObservableGauge('dlq_size', {
    description: 'Dead letter queue size per topic',
    unit: '1',
  });

  private workerLoad = this.meter.createObservableGauge('worker_load', {
    description: 'Current worker load (0-100)',
    unit: '%',
  });

  recordQueueDepth(topic: string, depth: number): void {
    // Implementation: integrate with queue stats
    // this.queueDepth.observe(depth, { topic });
  }

  recordDLQSize(topic: string, size: number): void {
    // this.dlqSize.observe(size, { topic });
  }

  recordWorkerLoad(topic: string, load: number): void {
    // this.workerLoad.observe(load, { topic });
  }
}

/**
 * DECISION METRICS
 */

export class DecisionMetrics {
  private meter = getMeter();

  private decisionsValidated = this.meter.createCounter('decisions_validated', {
    description: 'Decisions validated by policy engine',
    unit: '1',
  });

  private guardrailsTriggered = this.meter.createCounter('guardrails_triggered', {
    description: 'Number of guardrail violations',
    unit: '1',
  });

  private decisionsApproved = this.meter.createCounter('decisions_approved', {
    description: 'Decisions approved by workflow',
    unit: '1',
  });

  private decisionsExecuted = this.meter.createCounter('decisions_executed', {
    description: 'Decisions executed successfully',
    unit: '1',
  });

  recordDecisionValidated(decision: string, isValid: boolean, violationCount: number): void {
    this.decisionsValidated.add(1, {
      decision,
      valid: String(isValid),
    });

    if (violationCount > 0) {
      this.guardrailsTriggered.add(violationCount, {
        decision,
      });
    }
  }

  recordDecisionApproved(decision: string, approver: string): void {
    this.decisionsApproved.add(1, {
      decision,
      approver,
    });
  }

  recordDecisionExecuted(decision: string, status: 'success' | 'failed', error?: string): void {
    this.decisionsExecuted.add(1, {
      decision,
      status,
      error: error || 'none',
    });
  }
}

/**
 * Singleton instances
 */
export const jobMetrics = new JobMetrics();
export const queueMetrics = new QueueMetrics();
export const decisionMetrics = new DecisionMetrics();
