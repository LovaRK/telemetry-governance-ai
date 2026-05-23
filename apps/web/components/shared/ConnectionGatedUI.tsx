'use client';
import { apiFetch } from '../../lib/api-client';

import React, { useState, useEffect } from 'react';

interface ConnectionState {
  status: 'checking' | 'connected' | 'disconnected' | 'unconfigured';
  message?: string;
  error?: string;
}

interface Props {
  children: React.ReactNode;
  onConnectionChange?: (status: ConnectionState) => void;
}

export default function ConnectionGatedUI({ children, onConnectionChange }: Props) {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'checking' });

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await apiFetch('/api/splunk/status');
        if (!res.ok) {
          const state = { status: 'unconfigured' as const, message: 'Splunk not configured' };
          setConnection(state);
          onConnectionChange?.(state);
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (data?.is_configured) {
          const state = { status: 'connected' as const, message: 'Connected to Splunk' };
          setConnection(state);
          onConnectionChange?.(state);
        } else {
          const state = { status: 'unconfigured' as const, message: 'Splunk not configured' };
          setConnection(state);
          onConnectionChange?.(state);
        }
      } catch (err) {
        const state = { status: 'unconfigured' as const, message: 'Splunk not configured' };
        setConnection(state);
        onConnectionChange?.(state);
      }
    };

    checkConnection();
  }, [onConnectionChange]);

  // Show banner for unconfigured or disconnected states
  if (connection.status === 'unconfigured') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a' }}>
        <div
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            maxWidth: '600px',
            margin: '0 auto',
            paddingTop: '8rem',
          }}
        >
          <div
            style={{
              padding: '2rem',
              background: '#1e293b',
              borderRadius: 12,
              border: '2px solid #3b82f6',
            }}
          >
            <h1 style={{ color: '#f8fafc', marginBottom: '1rem' }}>Splunk Not Configured</h1>
            <p style={{ color: '#cbd5e1', marginBottom: '2rem', lineHeight: 1.6 }}>
              To view your Splunk telemetry intelligence dashboard, you need to configure your Splunk connection.
            </p>
            <button
              onClick={() => {
                window.location.href = '/settings?tab=splunk';
              }}
              style={{
                padding: '0.75rem 2rem',
                background: '#3b82f6',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                fontSize: '1rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Configure Splunk Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (connection.status === 'disconnected') {
    // Don't block the UI — the main page has its own data/error handling.
    // Just render children normally; page.tsx shows its own stale/error banners.
    return <>{children}</>;
  }

  if (connection.status === 'checking') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: '#0f172a',
          color: '#64748b',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⟳</div>
          <p>Checking Splunk connection...</p>
        </div>
      </div>
    );
  }

  // Connected — show children
  return <>{children}</>;
}
