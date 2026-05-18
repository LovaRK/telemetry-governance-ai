'use client';

/**
 * Governance Observability Dashboard
 *
 * Phase 6: Real-time monitoring of governance mutations, telemetry, and health
 * Shows:
 * - Mutation success/failure rates
 * - Version collision patterns
 * - Invalidation failures
 * - Operator session metrics
 * - Trust score progression over time
 * - Event stream with severity indicators
 */

import React, { useState } from 'react';
import {
  useGovernanceHealthSummary,
  useGovernanceAuditHistory,
  useGovernanceEventsStream,
} from '@/hooks/useGovernanceTelemetry';
import { AlertTriangle, Activity, TrendingUp, Zap, Clock } from 'lucide-react';

interface ObservabilityStats {
  metric: string;
  value: number | string;
  trend?: 'up' | 'down' | 'stable';
  alert?: boolean;
}

export function GovernanceObservabilityDashboard() {
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d'>('24h');

  // Query health summary
  const healthSummary = useGovernanceHealthSummary(true);

  // Query audit history if index selected
  const auditHistory = useGovernanceAuditHistory(
    selectedIndex,
    new Date(Date.now() - (timeRange === '1h' ? 3600000 : timeRange === '24h' ? 86400000 : 604800000))
  );

  // Query events stream
  const eventsStream = useGovernanceEventsStream(50);

  const stats: ObservabilityStats[] = [
    {
      metric: 'Mutations (24h)',
      value: healthSummary.data?.indexes_with_mutations_24h || 0,
      trend: 'stable',
    },
    {
      metric: 'Version Collisions',
      value: healthSummary.data?.version_collisions_24h || 0,
      alert: (healthSummary.data?.version_collisions_24h || 0) > 5,
      trend: 'up',
    },
    {
      metric: 'Invalidation Failures',
      value: healthSummary.data?.invalidation_failures_24h || 0,
      alert: (healthSummary.data?.invalidation_failures_24h || 0) > 2,
      trend: 'up',
    },
    {
      metric: 'Operations Abandoned',
      value: healthSummary.data?.operations_abandoned_24h || 0,
      trend: 'stable',
    },
    {
      metric: 'Degraded Indexes',
      value: healthSummary.data?.degraded_indexes || 0,
      alert: (healthSummary.data?.degraded_indexes || 0) > 0,
      trend: 'up',
    },
    {
      metric: 'Post-Refresh Success Rate',
      value: `${Math.round(((healthSummary.data?.avg_post_refresh_success_rate || 0) * 100))}%`,
      alert: (healthSummary.data?.avg_post_refresh_success_rate || 1) < 0.8,
      trend: 'down',
    },
  ];

  return (
    <div className="space-y-6 p-6 bg-slate-900 text-slate-50 min-h-screen">
      {/* Header */}
      <div className="border-b border-slate-700 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold">Governance Observability</h1>
        </div>
        <p className="text-slate-400 text-sm">
          Real-time monitoring of governance mutations, telemetry, and system health
        </p>
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-2">
        {(['1h', '24h', '7d'] as const).map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-4 py-2 rounded text-sm font-medium transition ${
              timeRange === range
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Last {range}
          </button>
        ))}
      </div>

      {/* Health Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.metric}
            className={`p-4 rounded border ${
              stat.alert ? 'bg-red-950 border-red-700' : 'bg-slate-800 border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-300 text-sm font-medium">{stat.metric}</span>
              {stat.alert && <AlertTriangle className="w-4 h-4 text-red-500" />}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{stat.value}</span>
              {stat.trend && (
                <span
                  className={`text-xs font-medium ${
                    stat.trend === 'up'
                      ? 'text-red-400'
                      : stat.trend === 'down'
                        ? 'text-green-400'
                        : 'text-slate-400'
                  }`}
                >
                  {stat.trend === 'up' ? '↑' : stat.trend === 'down' ? '↓' : '→'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Trust Score Progression (if index selected) */}
      {selectedIndex && auditHistory.data?.trustScoreProgression && (
        <div className="bg-slate-800 border border-slate-700 rounded p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Trust Score Progression
          </h2>
          <div className="space-y-2">
            {auditHistory.data.trustScoreProgression.map((point, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-slate-400">{new Date(point.timestamp).toLocaleString()}</span>
                <div className="flex items-center gap-3">
                  <div className="w-32 bg-slate-700 rounded h-2">
                    <div
                      className="h-2 rounded bg-blue-500"
                      style={{ width: `${point.confidence * 100}%` }}
                    />
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    point.band === 'TRUSTED' ? 'bg-green-900 text-green-200' :
                    point.band === 'RELIABLE' ? 'bg-blue-900 text-blue-200' :
                    point.band === 'CAUTION' ? 'bg-yellow-900 text-yellow-200' :
                    'bg-red-900 text-red-200'
                  }`}>
                    {point.band}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Events Stream */}
      <div className="bg-slate-800 border border-slate-700 rounded p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Recent Events
        </h2>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {eventsStream.data?.events && eventsStream.data.events.length > 0 ? (
            eventsStream.data.events.map((event) => (
              <div
                key={event.eventId}
                onClick={() => setSelectedIndex(event.indexName)}
                className={`p-3 rounded cursor-pointer transition border-l-4 ${
                  event.severity === 'ERROR'
                    ? 'bg-red-950 border-l-red-500 text-red-100 hover:bg-red-900'
                    : event.severity === 'COLLISION'
                      ? 'bg-yellow-950 border-l-yellow-500 text-yellow-100 hover:bg-yellow-900'
                      : event.severity === 'SUCCESS'
                        ? 'bg-green-950 border-l-green-500 text-green-100 hover:bg-green-900'
                        : 'bg-slate-700 border-l-blue-500 text-slate-100 hover:bg-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs">{event.indexName}</span>
                  <span className="text-xs text-slate-400">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="font-medium">{event.eventType}</span>
                  {event.fromState && event.toState && (
                    <span className="text-slate-300 ml-2">
                      {event.fromState} → {event.toState}
                    </span>
                  )}
                </div>
                {event.blockingReason && (
                  <div className="text-xs text-slate-300 mt-1">
                    {event.blockingReason}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-slate-400 text-center py-8">No events in selected time range</div>
          )}
        </div>
      </div>

      {/* Mutation Statistics (if index selected) */}
      {selectedIndex && auditHistory.data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Mutation Counts */}
          <div className="bg-slate-800 border border-slate-700 rounded p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Mutation Counts
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Mutations</span>
                <span className="font-bold">{auditHistory.data.mutations.total}</span>
              </div>
              <div className="flex justify-between text-green-300">
                <span className="text-slate-400">Successful</span>
                <span className="font-bold">{auditHistory.data.mutations.successful}</span>
              </div>
              <div className="flex justify-between text-red-300">
                <span className="text-slate-400">Failed</span>
                <span className="font-bold">{auditHistory.data.mutations.failed}</span>
              </div>
              <div className="flex justify-between text-yellow-300">
                <span className="text-slate-400">Abandoned</span>
                <span className="font-bold">{auditHistory.data.mutations.abandoned}</span>
              </div>
            </div>
          </div>

          {/* Error Breakdown */}
          <div className="bg-slate-800 border border-slate-700 rounded p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Error Breakdown
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Version Collisions</span>
                <span className="font-bold text-yellow-300">
                  {auditHistory.data.errors.versionCollisions}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Invalidation Failures</span>
                <span className="font-bold text-red-300">
                  {auditHistory.data.errors.invalidationFailures}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Forbidden Transitions</span>
                <span className="font-bold text-red-300">
                  {auditHistory.data.errors.forbiddenTransitions}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Rate Limited</span>
                <span className="font-bold text-orange-300">
                  {auditHistory.data.errors.rateLimited}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading States */}
      {healthSummary.isLoading && (
        <div className="text-slate-400 text-center py-8">Loading health summary...</div>
      )}
      {eventsStream.isLoading && (
        <div className="text-slate-400 text-center py-8">Loading events...</div>
      )}
    </div>
  );
}
