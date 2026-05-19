'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface CacheCoherenceData {
  id: string;
  indexName: string;
  cacheTier: string;
  coherenceScore: number;
  stalenessSeconds: number;
  hitRate: number;
  missRate: number;
  driftDetected: boolean;
  driftSeverity: string | null;
  recordedAt: string;
}

interface CoherenceSummary {
  avgCoherenceScore: number;
  driftDetectedCount: number;
  avgHitRatePct: number;
  totalRecords: number;
}

function classifyCoherenceTier(score: number): 'NOMINAL' | 'DEGRADED' | 'STALE' | 'SEVERE' {
  if (score >= 0.9) return 'NOMINAL';
  if (score >= 0.7) return 'DEGRADED';
  if (score >= 0.4) return 'STALE';
  return 'SEVERE';
}

function tierColor(tier: string): string {
  if (tier === 'NOMINAL') return '#22c55e';
  if (tier === 'DEGRADED') return '#f59e0b';
  if (tier === 'STALE') return '#3b82f6';
  return '#ef4444';
}

function tierIcon(tier: string): string {
  if (tier === 'NOMINAL') return '✓';
  if (tier === 'DEGRADED') return '⚠';
  if (tier === 'STALE') return '◐';
  return '✕';
}

/**
 * LiveCacheCoherenceMonitor — displays real-time cache health metrics
 *
 * Polls /api/governance/cache-coherence every 10 seconds and displays:
 * - Overall coherence score (avg)
 * - Tier classification (NOMINAL/DEGRADED/STALE/SEVERE)
 * - Hit rate percentage
 * - Drift detected count
 * - Per-index status breakdown
 */
export default function LiveCacheCoherenceMonitor() {
  const [data, setData] = useState<CacheCoherenceData[]>([]);
  const [summary, setSummary] = useState<CoherenceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/governance/cache-coherence?limit=50');
      if (!res.ok) throw new Error('Failed to fetch cache coherence');

      const json = await res.json();
      setData(json.records || []);
      setSummary(json.summary || null);
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      console.error('Cache coherence fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', textAlign: 'center', color: '#64748b' }}>
        Loading cache coherence data...
      </div>
    );
  }

  const avgScore = summary?.avgCoherenceScore || 0;
  const tier = classifyCoherenceTier(avgScore);
  const color = tierColor(tier);

  // Top 10 indexes by staleness (most problematic)
  const topStaleIndexes = [...data]
    .sort((a, b) => (b.stalenessSeconds as any) - (a.stalenessSeconds as any))
    .slice(0, 10);

  return (
    <div style={{ background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>
          🔄 Live Cache Coherence
        </div>
        {lastUpdated && (
          <div style={{ fontSize: '0.65rem', color: '#475569' }}>
            Updated {new Date(lastUpdated).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        {/* Coherence Score Card */}
        <div style={{
          background: `${color}15`,
          border: `1px solid ${color}40`,
          borderRadius: 6,
          padding: '0.75rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4 }}>Coherence Score</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color }}>
            {(avgScore * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: '0.65rem', color, fontWeight: 600, marginTop: 4 }}>
            {tierIcon(tier)} {tier}
          </div>
        </div>

        {/* Hit Rate Card */}
        <div style={{
          background: '#22c55e15',
          border: '1px solid #22c55e40',
          borderRadius: 6,
          padding: '0.75rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4 }}>Hit Rate</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#22c55e' }}>
            {(summary?.avgHitRatePct || 0).toFixed(0)}%
          </div>
          <div style={{ fontSize: '0.65rem', color: '#22c55e', marginTop: 4 }}>avg across indexes</div>
        </div>

        {/* Drift Count Card */}
        <div style={{
          background: summary && summary.driftDetectedCount > 0 ? '#ef444415' : '#3b82f615',
          border: `1px solid ${summary && summary.driftDetectedCount > 0 ? '#ef444440' : '#3b82f640'}`,
          borderRadius: 6,
          padding: '0.75rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4 }}>Drift Events</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: summary && summary.driftDetectedCount > 0 ? '#ef4444' : '#3b82f6' }}>
            {summary?.driftDetectedCount || 0}
          </div>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 4 }}>detected</div>
        </div>

        {/* Index Count Card */}
        <div style={{
          background: '#3b82f615',
          border: '1px solid #3b82f640',
          borderRadius: 6,
          padding: '0.75rem',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4 }}>Indexes</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#3b82f6' }}>
            {summary?.totalRecords || 0}
          </div>
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 4 }}>monitored</div>
        </div>
      </div>

      {/* Top Stale Indexes */}
      <div style={{ marginTop: '1rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
          Most Stale Indexes
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 220, overflowY: 'auto' }}>
          {topStaleIndexes.length === 0 ? (
            <div style={{ fontSize: '0.7rem', color: '#475569', paddingTop: '0.5rem' }}>No stale indexes detected ✓</div>
          ) : (
            topStaleIndexes.map(record => {
              const stalenessMins = (((record.stalenessSeconds as any) / 60)).toFixed(0);
              const color = record.coherenceScore >= 0.9 ? '#22c55e' : record.coherenceScore >= 0.7 ? '#f59e0b' : record.coherenceScore >= 0.4 ? '#3b82f6' : '#ef4444';
              return (
                <div key={record.id} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.5rem 0.75rem',
                  background: `${color}10`,
                  border: `1px solid ${color}30`,
                  borderRadius: 4,
                  fontSize: '0.7rem',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {record.indexName}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '0.65rem', marginTop: 2 }}>
                      Stale {stalenessMins}m · Hit rate {(((record.hitRate as any) * 100)).toFixed(0)}%
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, marginLeft: '0.5rem' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 3, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0f172a', fontWeight: 700, fontSize: '0.65rem' }}>
                      {(((record.coherenceScore as any) * 100)).toFixed(0)[0]}
                    </div>
                    {record.driftDetected && (
                      <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>📊</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
