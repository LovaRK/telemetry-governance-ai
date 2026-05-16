'use client';

import React, { useState, useEffect } from 'react';

interface DecisionHistoryRecord {
  snapshotId: number;
  snapshotDate: string;
  indexName: string;
  tierPrevious?: string;
  tierCurrent: string;
  actionPrevious?: string;
  actionCurrent: string;
  confidenceChanged: boolean;
  scoreDelta?: number;
  changeReason?: string;
}

interface ConfigAuditRecord {
  configKey: string;
  changeType: 'cost_model' | 'retention_policy' | 'decision_weights';
  oldValue?: Record<string, any>;
  newValue: Record<string, any>;
  changedBy?: string;
  changeReason?: string;
}

interface Props {
  indexName?: string;
  maxRecords?: number;
}

const TIER_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  IMPORTANT: '#f59e0b',
  NICE_TO_HAVE: '#3b82f6',
  LOW_VALUE: '#64748b',
};

const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  S3_CANDIDATE: '#06b6d4',
};

export default function DecisionHistoryViewer({ indexName, maxRecords = 20 }: Props) {
  const [history, setHistory] = useState<DecisionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'decisions' | 'config'>('decisions');

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          type: activeTab,
          limit: maxRecords.toString(),
        });
        if (indexName) params.append('index', indexName);

        const res = await fetch(`/api/decision-history?${params}`);
        if (!res.ok) throw new Error('Failed to fetch history');

        const data = await res.json();
        setHistory(data.data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [activeTab, indexName, maxRecords]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
        Loading decision history...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', color: '#ef4444' }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid #1e293b', paddingBottom: '1rem' }}>
        {['decisions', 'config'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === tab ? '#1e293b' : 'transparent',
              border: activeTab === tab ? '1px solid #334155' : '1px solid transparent',
              color: activeTab === tab ? '#f8fafc' : '#64748b',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {tab === 'decisions' ? 'Decision Changes' : 'Config Changes'}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {history.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
            No {activeTab === 'decisions' ? 'decision' : 'config'} history available
          </div>
        ) : (
          history.map((item: any, idx) => (
            <div
              key={idx}
              style={{
                padding: '1rem',
                background: '#0f172a',
                borderRadius: 8,
                border: '1px solid #1e293b',
                borderLeft: '3px solid #3b82f6',
              }}
            >
              {activeTab === 'decisions' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f8fafc' }}>
                      {(item as DecisionHistoryRecord).indexName}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {new Date((item as DecisionHistoryRecord).snapshotDate).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {(item as DecisionHistoryRecord).tierPrevious && (
                        <>
                          <span
                            style={{
                              padding: '0.2rem 0.5rem',
                              borderRadius: 4,
                              fontSize: '0.75rem',
                              background: TIER_COLORS[(item as DecisionHistoryRecord).tierPrevious!] + '40',
                              color: TIER_COLORS[(item as DecisionHistoryRecord).tierPrevious!],
                              fontWeight: 600,
                              textDecoration: 'line-through',
                            }}
                          >
                            {(item as DecisionHistoryRecord).tierPrevious}
                          </span>
                          <span style={{ color: '#64748b' }}>→</span>
                        </>
                      )}
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          background: TIER_COLORS[(item as DecisionHistoryRecord).tierCurrent] + '40',
                          color: TIER_COLORS[(item as DecisionHistoryRecord).tierCurrent],
                          fontWeight: 600,
                        }}
                      >
                        {(item as DecisionHistoryRecord).tierCurrent}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {(item as DecisionHistoryRecord).actionPrevious && (
                        <>
                          <span
                            style={{
                              padding: '0.2rem 0.5rem',
                              borderRadius: 4,
                              fontSize: '0.75rem',
                              background: ACTION_COLORS[(item as DecisionHistoryRecord).actionPrevious!] + '40',
                              color: ACTION_COLORS[(item as DecisionHistoryRecord).actionPrevious!],
                              fontWeight: 600,
                              textDecoration: 'line-through',
                            }}
                          >
                            {(item as DecisionHistoryRecord).actionPrevious}
                          </span>
                          <span style={{ color: '#64748b' }}>→</span>
                        </>
                      )}
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          background: ACTION_COLORS[(item as DecisionHistoryRecord).actionCurrent] + '40',
                          color: ACTION_COLORS[(item as DecisionHistoryRecord).actionCurrent],
                          fontWeight: 600,
                        }}
                      >
                        {(item as DecisionHistoryRecord).actionCurrent}
                      </span>
                    </div>
                  </div>
                  {(item as DecisionHistoryRecord).scoreDelta !== undefined && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Score change: {(item as DecisionHistoryRecord).scoreDelta! > 0 ? '+' : ''}{(item as DecisionHistoryRecord).scoreDelta!.toFixed(1)}
                    </div>
                  )}
                  {(item as DecisionHistoryRecord).changeReason && (
                    <div style={{ fontSize: '0.8125rem', color: '#cbd5e1', marginTop: '0.5rem' }}>
                      {(item as DecisionHistoryRecord).changeReason}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f8fafc', textTransform: 'capitalize' }}>
                      {((item as ConfigAuditRecord).changeType || '').replace('_', ' ')}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      by {(item as ConfigAuditRecord).changedBy || 'system'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: '#cbd5e1' }}>
                    <div>Old: <code style={{ color: '#94a3b8' }}>{JSON.stringify((item as ConfigAuditRecord).oldValue)}</code></div>
                    <div>New: <code style={{ color: '#22c55e' }}>{JSON.stringify((item as ConfigAuditRecord).newValue)}</code></div>
                  </div>
                  {(item as ConfigAuditRecord).changeReason && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
                      {(item as ConfigAuditRecord).changeReason}
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
