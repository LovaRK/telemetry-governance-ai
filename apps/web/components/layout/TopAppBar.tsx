'use client';

import React from 'react';

interface Props {
  cacheStatus?: {
    status: string;
    lastRefreshAt: string | null;
    isStale: boolean;
    recordCount?: number;
  } | null;
  onRefresh?: () => void;
  loading?: boolean;
  hasConfig?: boolean;
}

export default function TopAppBar({ cacheStatus, onRefresh, loading, hasConfig }: Props) {
  return (
    <header style={{
      height: 64,
      background: '#0c1322',
      borderBottom: '1px solid #1e293b',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 1.5rem',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          color: '#fff',
          fontSize: '0.875rem',
        }}>
          A
        </div>
        <div>
          <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.9375rem', letterSpacing: '-0.01em' }}>
            Aetheris Sentinel
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Agentic Telemetry OS
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {cacheStatus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: cacheStatus.isStale ? '#f59e0b' : '#22c55e',
              display: 'inline-block',
            }} />
            <span style={{ color: cacheStatus.isStale ? '#f59e0b' : '#22c55e' }}>
              {cacheStatus.isStale ? 'Cache Stale' : 'Cache Fresh'}
            </span>
            {cacheStatus.lastRefreshAt && (
              <span style={{ color: '#64748b' }}>
                (updated {new Date(cacheStatus.lastRefreshAt).toLocaleTimeString()})
              </span>
            )}
          </div>
        )}

        {onRefresh && hasConfig && (
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              background: loading ? '#1e293b' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            {loading ? '⟳ Refreshing...' : '↻ Refresh from Splunk'}
          </button>
        )}

        {onRefresh && !hasConfig && (
          <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '0.5rem 1rem', background: '#1e293b', borderRadius: '6px' }}>
            Configure MCP credentials to enable refresh
          </div>
        )}
      </div>
    </header>
  );
}
