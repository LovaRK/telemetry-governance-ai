'use client';

import React, { useEffect, useState } from 'react';
import { useRuntimeMode } from '../../app/lib/runtime-mode-context';

interface Props {
  cacheStatus?: {
    status: string;
    lastRefreshAt: string | null;
    hasEverRefreshed?: boolean;
    hasAgentDecisions?: boolean;
    recordCount?: number;
  } | null;
  onRefresh?: () => void;
  onOpenConfig?: () => void;
  loading?: boolean;
  hasConfig?: boolean;
}

export default function TopAppBar({ cacheStatus, onRefresh, onOpenConfig, loading, hasConfig }: Props) {
  const { mode, isLoading, dependencies } = useRuntimeMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const modeColor = mode === 'FULL_STACK' ? '#22c55e' : '#f59e0b';
  const modeLabel = mode === 'FULL_STACK' ? 'FULL_STACK' : 'DEMO_MODE';

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
          background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          color: '#fff',
          fontSize: '0.875rem',
          letterSpacing: '-0.02em',
        }}>
          d
        </div>
        <div>
          <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.9375rem', letterSpacing: '-0.02em' }}>
            datasensAI
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Executive ROI Overview
          </div>
        </div>

        {/* Runtime Mode Indicator */}
        <div style={{
          marginLeft: '1.5rem',
          paddingLeft: '1.5rem',
          borderLeft: '1px solid #334155',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.75rem',
          fontWeight: 600,
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: modeColor,
            display: 'inline-block',
          }} />
          <span style={{ color: modeColor }}>
            {isLoading ? 'LOADING...' : modeLabel}
          </span>
          {mode === 'DEMO_MODE' && (
            <span style={{ color: '#f59e0b', marginLeft: '0.25rem' }}>
              (no database)
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {cacheStatus?.hasEverRefreshed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem' }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: cacheStatus.status === 'stale' ? '#f59e0b' : '#22c55e',
              display: 'inline-block',
            }} />
            <span style={{ color: cacheStatus.status === 'stale' ? '#f59e0b' : '#22c55e' }}>
              {cacheStatus.status === 'stale' ? 'Cache Stale' : 'Cache Fresh'}
            </span>
            {!cacheStatus.hasAgentDecisions && (
              <span style={{ color: '#f59e0b', marginLeft: '0.5rem' }}>⚠ No LLM decisions yet</span>
            )}
            {cacheStatus.lastRefreshAt && (
              <span style={{ color: '#64748b' }}>
                · {new Date(cacheStatus.lastRefreshAt).toLocaleTimeString()}
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

        <button
          onClick={() => {
            console.log('CONFIG CLICK', onOpenConfig);
            if (onOpenConfig) onOpenConfig();
          }}
          style={{
            padding: '0.5rem 1rem',
            background: '#1e293b',
            color: '#94a3b8',
            border: '1px solid #334155',
            borderRadius: '6px',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          ⚙ Config
        </button>
      </div>
    </header>
  );
}
