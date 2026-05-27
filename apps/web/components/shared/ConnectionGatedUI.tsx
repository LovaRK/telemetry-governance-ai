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
        // Auth/context failures should not be interpreted as "not configured".
        // Let the page-level data flow decide the final UX state.
        if (res.status === 401 || res.status === 403) {
          const state = { status: 'disconnected' as const, message: 'Authentication required' };
          setConnection(state);
          onConnectionChange?.(state);
          return;
        }
        if (!res.ok) {
          const state = { status: 'disconnected' as const, message: 'Splunk status unavailable' };
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
        const state = { status: 'disconnected' as const, message: 'Splunk status unavailable' };
        setConnection(state);
        onConnectionChange?.(state);
      }
    };

    checkConnection();
  }, [onConnectionChange]);

  // Never hard-block dashboard rendering here. The main page handles
  // connection/config/empty states with richer context.
  if (connection.status === 'unconfigured' || connection.status === 'disconnected') {
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
