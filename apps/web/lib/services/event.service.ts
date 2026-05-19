/**
 * EVENT SERVICE — Governance Events and Audit Trail Management
 * Single Responsibility: Only event and audit operations
 */

import { IAPIClient } from '../api/client';
import {
  GovernanceEvent,
  EventTimeline,
  EventSnapshot,
  ReplaySession,
  AppError,
} from '../types';

export interface IEventService {
  getDecisionEvents(decisionId: string): Promise<GovernanceEvent[]>;
  getEventTimeline(decisionId: string): Promise<EventTimeline>;
  createSnapshot(decisionId: string): Promise<EventSnapshot>;
  getSnapshot(decisionId: string): Promise<EventSnapshot | null>;
  startReplaySession(decisionId: string): Promise<ReplaySession>;
  getReplayFrame(sessionId: string, frameNumber: number): Promise<any>;
  getAuditTrail(filters?: AuditTrailFilters): Promise<GovernanceEvent[]>;
}

export interface AuditTrailFilters {
  decisionId?: string;
  eventType?: string;
  operatorEmail?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

export class EventService implements IEventService {
  constructor(private apiClient: IAPIClient) {}

  /**
   * Get all events for a decision
   */
  async getDecisionEvents(decisionId: string): Promise<GovernanceEvent[]> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const events = await this.apiClient.get<GovernanceEvent[]>(
        `/api/events/decisions/${decisionId}`
      );
      return Array.isArray(events) ? events : [];
    } catch (error) {
      throw this.mapError(error, `Failed to get events for decision ${decisionId}`);
    }
  }

  /**
   * Get timeline of events for a decision
   */
  async getEventTimeline(decisionId: string): Promise<EventTimeline> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const timeline = await this.apiClient.get<EventTimeline>(
        `/api/events/decisions/${decisionId}/timeline`
      );
      return timeline;
    } catch (error) {
      throw this.mapError(error, `Failed to get timeline for decision ${decisionId}`);
    }
  }

  /**
   * Create a snapshot of current state
   */
  async createSnapshot(decisionId: string): Promise<EventSnapshot> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const snapshot = await this.apiClient.post<EventSnapshot>(
        '/api/events/snapshots',
        { decisionId }
      );
      return snapshot;
    } catch (error) {
      throw this.mapError(error, `Failed to create snapshot for decision ${decisionId}`);
    }
  }

  /**
   * Get latest snapshot for a decision
   */
  async getSnapshot(decisionId: string): Promise<EventSnapshot | null> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const snapshot = await this.apiClient.get<EventSnapshot | null>(
        `/api/events/decisions/${decisionId}/snapshot`
      );
      return snapshot;
    } catch (error) {
      // Not found is acceptable (snapshot may not exist)
      if (error instanceof AppError && error.statusCode === 404) {
        return null;
      }
      throw this.mapError(error, `Failed to get snapshot for decision ${decisionId}`);
    }
  }

  /**
   * Start a replay session (time-travel debugging)
   */
  async startReplaySession(decisionId: string): Promise<ReplaySession> {
    if (!decisionId) {
      throw new AppError('INVALID_ID', 'Decision ID is required', 400);
    }

    try {
      const session = await this.apiClient.post<ReplaySession>(
        '/api/events/replay/sessions',
        { decisionId }
      );
      return session;
    } catch (error) {
      throw this.mapError(error, `Failed to start replay session for decision ${decisionId}`);
    }
  }

  /**
   * Get specific frame in replay session
   */
  async getReplayFrame(sessionId: string, frameNumber: number): Promise<any> {
    if (!sessionId) {
      throw new AppError('INVALID_SESSION', 'Session ID is required', 400);
    }

    if (frameNumber < 0) {
      throw new AppError('INVALID_FRAME', 'Frame number must be non-negative', 400);
    }

    try {
      const frame = await this.apiClient.get(
        `/api/events/replay/sessions/${sessionId}/frames/${frameNumber}`
      );
      return frame;
    } catch (error) {
      throw this.mapError(error, `Failed to get replay frame ${frameNumber}`);
    }
  }

  /**
   * Get audit trail with optional filtering
   */
  async getAuditTrail(filters?: AuditTrailFilters): Promise<GovernanceEvent[]> {
    try {
      const params = new URLSearchParams();

      if (filters?.decisionId) params.append('decisionId', filters.decisionId);
      if (filters?.eventType) params.append('eventType', filters.eventType);
      if (filters?.operatorEmail) params.append('operatorEmail', filters.operatorEmail);
      if (filters?.startTime) params.append('startTime', filters.startTime.toISOString());
      if (filters?.endTime) params.append('endTime', filters.endTime.toISOString());
      if (filters?.limit) params.append('limit', String(filters.limit));
      if (filters?.offset) params.append('offset', String(filters.offset));

      const queryString = params.toString();
      const endpoint = `/api/events/audit${queryString ? `?${queryString}` : ''}`;

      const events = await this.apiClient.get<GovernanceEvent[]>(endpoint);
      return Array.isArray(events) ? events : [];
    } catch (error) {
      throw this.mapError(error, 'Failed to get audit trail');
    }
  }

  private mapError(error: any, defaultMessage: string): AppError {
    if (error instanceof AppError) {
      return error;
    }
    return new AppError('SERVICE_ERROR', defaultMessage, 500);
  }
}

export function createEventService(apiClient: IAPIClient): IEventService {
  return new EventService(apiClient);
}
