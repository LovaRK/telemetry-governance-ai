'use client';

import { useEffect, useState } from 'react';

interface ModeStatus {
  mode: 'DEMO_MODE' | 'FULL_STACK';
  database: {
    configured: boolean;
    connected: boolean;
    latencyMs?: number;
    migrationsApplied?: number | null;
  };
}

export function DemoModeBanner() {
  const [modeStatus, setModeStatus] = useState<ModeStatus | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Fetch health status on mount
    const checkHealth = async () => {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        const data = await response.json();
        setModeStatus(data);
        // Show banner if not in FULL_STACK mode
        if (data.mode !== 'FULL_STACK') {
          setIsVisible(true);
        }
      } catch (error) {
        console.error('[DemoModeBanner] Health check failed:', error);
        // If health check fails, assume demo mode
        setIsVisible(true);
      }
    };

    checkHealth();
  }, []);

  if (!isVisible || !modeStatus || modeStatus.mode === 'FULL_STACK') {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: '#fff3cd',
        borderBottom: '2px solid #ffc107',
        padding: '12px 24px',
        fontSize: '13px',
        color: '#856404',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        lineHeight: '1.5',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
        <span style={{ fontSize: '18px' }}>⚠️</span>
        <div>
          <strong>Running in DEMO_MODE</strong>
          <div style={{ fontSize: '12px', marginTop: '2px', opacity: 0.8 }}>
            {modeStatus.database.configured ? (
              modeStatus.database.connected ? (
                <>Database connected ({modeStatus.database.latencyMs}ms latency)</>
              ) : (
                <>Database configured but not accessible</>
              )
            ) : (
              <>Database not configured. Live telemetry pipelines are inactive.</>
            )}
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: '11px',
          opacity: 0.7,
          textAlign: 'right',
          whiteSpace: 'nowrap',
        }}
      >
        Use for testing & demos only.
        <br />
        Real data disabled.
      </div>
    </div>
  );
}
