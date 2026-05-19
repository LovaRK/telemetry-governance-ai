/**
 * SHARED TYPES — Single Source of Truth
 * All TypeScript interfaces and types used across the application
 */

// ============================================================================
// GOVERNANCE DOMAIN
// ============================================================================

export type DecisionStatus = 'pending' | 'active' | 'resolved' | 'blocked' | 'archived';
export type CausalityType = 'blocks' | 'depends_on' | 'overrides' | 'triggers' | 'contradicts' | 'related';
export type EventType =
  | 'decision_created'
  | 'decision_modified'
  | 'decision_blocked'
  | 'decision_resolved'
  | 'causality_recorded'
  | 'confidence_updated'
  | 'state_transitioned';

export interface Decision {
  id: string;
  indexName: string;
  status: DecisionStatus;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export interface CausalityEdge {
  id: string;
  parentDecisionId: string;
  childDecisionId: string;
  causalityType: CausalityType;
  confidence: number;
  reason?: string;
  createdAt: Date;
}

export interface CausalLink {
  parentDecisionId: string;
  childDecisionId: string;
  causalityType: CausalityType;
  confidence: number;
  reason?: string;
}

export interface DecisionNode {
  id: string;
  indexName: string;
  status: DecisionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CausalityDAG {
  nodes: DecisionNode[];
  edges: CausalityEdge[];
  rootNodes: string[];
  leafNodes: string[];
}

export interface DependencyAnalysis {
  decisionId: string;
  incomingDependencies: DecisionNode[];
  outgoingDependencies: DecisionNode[];
  rootCauses: DecisionNode[];
  impactRadius: DecisionNode[];
  cycleDetected: boolean;
  depth: number;
}

// ============================================================================
// EVENT JOURNALING
// ============================================================================

export interface GovernanceEvent {
  id: string;
  correlationId: string;
  decisionId: string;
  eventType: EventType;
  payload: Record<string, any>;
  operatorEmail: string;
  timestamp: Date;
}

export interface EventTimeline {
  decisionId: string;
  events: GovernanceEvent[];
  startTime: Date;
  endTime: Date;
  eventCount: number;
}

export interface EventSnapshot {
  id: string;
  decisionId: string;
  eventSequenceNumber: number;
  snapshotData: Record<string, any>;
  snapshotType: 'periodic' | 'manual' | 'checkpoint';
  createdAt: Date;
}

export interface ReplaySession {
  sessionId: string;
  decisionId: string;
  startFrame: number;
  endFrame: number;
  currentFrame: number;
  isPlaying: boolean;
}

// ============================================================================
// CORRELATION & TRACING
// ============================================================================

export interface CorrelationContext {
  correlationId: string;
  parentDecisionId?: string;
  traceStartTime: number;
  operatorEmail?: string;
}

export interface TraceEntry {
  timestamp: number;
  correlationId: string;
  boundary: 'sse' | 'queue' | 'fetch' | 'query' | 'retry';
  action: 'enter' | 'exit' | 'error';
  metadata?: Record<string, any>;
}

// ============================================================================
// OBSERVABILITY & HEALTH
// ============================================================================

export interface HealthMetrics {
  overallHealth: 'healthy' | 'warning' | 'critical';
  healthScore: number; // 0-100
  timestamp: Date;
  metrics: {
    confidence: number;
    throughput: number;
    causality: number;
    snapshot: number;
    alerts: number;
  };
}

export interface LatencyStatistics {
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  average: number;
  stdDeviation: number;
}

export interface OperatorSession {
  id: string;
  operatorHash: string;
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
  decisionCount: number;
  actionTypes: Record<string, number>;
  auditTrailCount: number;
  avgConfidenceChange: number;
}

export interface SessionMetrics {
  totalDuration: number;
  decisionsPerMinute: number;
  avgConfidenceChange: number;
  actionsPerDecision: number;
  sessionHealth: 'active' | 'idle' | 'ended';
}

// ============================================================================
// AUTHENTICATION & AUTHORIZATION
// ============================================================================

export type UserRole = 'viewer' | 'analyst' | 'operator' | 'admin';

export interface AuthContext {
  userId: string;
  email: string;
  role: UserRole;
  permissions: string[];
  timestamp: number;
  token: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  permissions: string[];
  iat: number;
  exp: number;
}

// ============================================================================
// API CONTRACTS
// ============================================================================

export interface APIRequest<T = any> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  data?: T;
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  timestamp: string;
  correlationId?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// VISUALIZATION
// ============================================================================

export interface VisualizationNode {
  id: string;
  label: string;
  status: DecisionStatus;
  x?: number;
  y?: number;
  confidence?: number;
  incomingCount?: number;
  outgoingCount?: number;
}

export interface VisualizationEdge {
  id: string;
  source: string;
  target: string;
  causalityType: CausalityType;
  confidence: number;
}

export interface DAGLayout {
  nodes: VisualizationNode[];
  edges: VisualizationEdge[];
  layout: 'hierarchical' | 'force-directed' | 'radial';
  zoom?: number;
  pan?: { x: number; y: number };
}

// ============================================================================
// ERRORS
// ============================================================================

export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', details?: Record<string, any>) {
    super('NOT_FOUND', message, 404, details);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', details?: Record<string, any>) {
    super('UNAUTHORIZED', message, 401, details);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed', details?: Record<string, any>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface AppConfig {
  apiBaseUrl: string;
  environment: 'development' | 'staging' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  features: {
    enableSSE: boolean;
    enableEventJournaling: boolean;
    enableDAGVisualization: boolean;
    enableOperatorTracking: boolean;
  };
}

// ============================================================================
// HOOKS & UTILITIES
// ============================================================================

export interface UseQueryOptions<T> {
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
  retry?: number | ((failureCount: number) => boolean);
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export interface UseMutationOptions<T, E = Error> {
  onSuccess?: (data: T) => void;
  onError?: (error: E) => void;
  onSettled?: () => void;
}
