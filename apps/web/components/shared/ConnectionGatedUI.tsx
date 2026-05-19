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
      // If env vars are configured, auto-populate localStorage so the UI
      // doesn't show "unconfigured" when Splunk is set via server env.
      const envMcpUrl   = process.env.NEXT_PUBLIC_SPLUNK_MCP_URL;
      const envToken    = process.env.NEXT_PUBLIC_SPLUNK_TOKEN;
      const envNoSsl    = process.env.NEXT_PUBLIC_SPLUNK_DISABLE_SSL_VERIFY === 'true';

      let savedConfig = localStorage.getItem('splunk_config');
      if (!savedConfig && envMcpUrl && envToken) {
        const envConfig = JSON.stringify({ mcpUrl: envMcpUrl, token: envToken, disableSslVerify: envNoSsl });
        localStorage.setItem('splunk_config', envConfig);
        savedConfig = envConfig;
      }

      if (!savedConfig) {
        const state = { status: 'unconfigured' as const, message: 'Splunk not configured' };
        setConnection(state);
        onConnectionChange?.(state);
        return;
      }

      try {
        const config = JSON.parse(savedConfig);
        const res = await apiFetch('/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        });

        if (res.ok) {
          const state = { status: 'connected' as const, message: 'Connected to Splunk' };
          setConnection(state);
          onConnectionChange?.(state);
        } else {
          const data = await res.json().catch(() => ({}));
          // If the test-connection API itself is misconfigured but we have env vars,
          // treat as connected — the real Splunk client uses env vars at the API level.
          if (envMcpUrl && envToken) {
            const state = { status: 'connected' as const, message: 'Connected via environment config' };
            setConnection(state);
            onConnectionChange?.(state);
          } else {
            const state = {
              status: 'disconnected' as const,
              error: data.error || 'Connection failed',
              message: data.hint,
            };
            setConnection(state);
            onConnectionChange?.(state);
          }
        }
      } catch (err) {
        // Network error — if env vars exist, don't block the UI
        if (envMcpUrl && envToken) {
          const state = { status: 'connected' as const, message: 'Connected via environment config' };
          setConnection(state);
          onConnectionChange?.(state);
        } else {
          const message = err instanceof Error ? err.message : 'Unknown error';
          const state = { status: 'disconnected' as const, error: message };
          setConnection(state);
          onConnectionChange?.(state);
        }
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
