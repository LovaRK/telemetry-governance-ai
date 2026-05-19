/**
 * OBSERVABILITY SERVICE — Health Metrics, Latency, and Monitoring
 * Single Responsibility: Only observability-related operations
 */

import { IAPIClient } from '../api/client';
import {
  HealthMetrics,
  LatencyStatistics,
  OperatorSession,
  SessionMetrics,
  AppError,
} from '../types';

export interface IObservabilityService {
  getHealthMetrics(timeWindowMs?: number): Promise<HealthMetrics>;
  getLatencyStatistics(timeWindowMs?: number): Promise<LatencyStatistics>;
  getOperatorSessions(limit?: number, offset?: number): Promise<OperatorSession[]>;
  getSessionMetrics(sessionId: string): Promise<SessionMetrics>;
}

export class ObservabilityService implements IObservabilityService {
  constructor(private apiClient: IAPIClient) {}

  /**
   * Get system health metrics
   */
  async getHealthMetrics(timeWindowMs: number = 3600000): Promise<HealthMetrics> {
    try {
      const metrics = await this.apiClient.get<HealthMetrics>(
        `/api/observability/health?window=${timeWindowMs}`
      );
      return metrics;
    } catch (error) {
      throw this.mapError(error, 'Failed to get health metrics');
    }
  }

  /**
   * Get latency statistics (p50, p95, p99, etc.)
   */
  async getLatencyStatistics(timeWindowMs: number = 3600000): Promise<LatencyStatistics> {
    try {
      const stats = await this.apiClient.get<LatencyStatistics>(
        `/api/observability/latency?window=${timeWindowMs}`
      );
      return stats;
    } catch (error) {
      throw this.mapError(error, 'Failed to get latency statistics');
    }
  }

  /**
   * Get operator sessions
   */
  async getOperatorSessions(limit: number = 50, offset: number = 0): Promise<OperatorSession[]> {
    try {
      const sessions = await this.apiClient.get<OperatorSession[]>(
        `/api/observability/sessions?limit=${limit}&offset=${offset}`
      );
      return Array.isArray(sessions) ? sessions : [];
    } catch (error) {
      throw this.mapError(error, 'Failed to get operator sessions');
    }
  }

  /**
   * Get metrics for specific session
   */
  async getSessionMetrics(sessionId: string): Promise<SessionMetrics> {
    if (!sessionId) {
      throw new AppError('INVALID_SESSION', 'Session ID is required', 400);
    }

    try {
      const metrics = await this.apiClient.get<SessionMetrics>(
        `/api/observability/sessions/${sessionId}/metrics`
      );
      return metrics;
    } catch (error) {
      throw this.mapError(error, `Failed to get metrics for session ${sessionId}`);
    }
  }

  private mapError(error: any, defaultMessage: string): AppError {
    if (error instanceof AppError) {
      return error;
    }
    return new AppError('SERVICE_ERROR', defaultMessage, 500);
  }
}

export function createObservabilityService(apiClient: IAPIClient): IObservabilityService {
  return new ObservabilityService(apiClient);
}
