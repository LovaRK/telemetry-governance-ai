'use client';

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
      // Check if Splunk credentials are stored in localStorage
      const savedConfig = localStorage.getItem('splunk_config');

      if (!savedConfig) {
        const state = { status: 'unconfigured' as const, message: 'Splunk not configured' };
        setConnection(state);
        onConnectionChange?.(state);
        return;
      }

      try {
        const config = JSON.parse(savedConfig);
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });

        if (res.ok) {
          const state = { status: 'connected' as const, message: 'Connected to Splunk' };
          setConnection(state);
          onConnectionChange?.(state);
        } else {
          const data = await res.json();
          const state = {
            status: 'disconnected' as const,
            error: data.error || 'Connection failed',
            message: data.hint,
          };
          setConnection(state);
          onConnectionChange?.(state);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const state = { status: 'disconnected' as const, error: message };
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
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a' }}>
        <div
          style={{
            padding: '2rem',
            background: '#ef444420',
            borderLeft: '4px solid #ef4444',
            marginBottom: '2rem',
            color: '#cbd5e1',
          }}
        >
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h2 style={{ color: '#ef4444', margin: '0 0 0.5rem 0' }}>Connection Error</h2>
            <p style={{ margin: '0 0 0.5rem 0' }}>{connection.error}</p>
            {connection.message && <p style={{ margin: 0, opacity: 0.8 }}>{connection.message}</p>}
            <button
              onClick={() => {
                window.location.href = '/settings?tab=splunk';
              }}
              style={{
                marginTop: '1rem',
                padding: '0.5rem 1rem',
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                borderRadius: 4,
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Fix Connection
            </button>
          </div>
        </div>
        {/* Show children with reduced opacity */}
        <div style={{ opacity: 0.4, pointerEvents: 'none' }}>
          {children}
        </div>
      </div>
    );
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
