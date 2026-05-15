'use client';

import { useState, useEffect } from 'react';

interface HeaderProps {
  connectionStatus?: string;
}

export default function Header({ connectionStatus }: HeaderProps) {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    setTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'CONNECTED': return '#22c55e';
      case 'DEGRADED': return '#f59e0b';
      case 'AUTH_FAILED':
      case 'NO_INDEX_ACCESS': return '#ef4444';
      default: return '#666';
    }
  };

  return (
    <header style={{ padding: '1rem', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Agentic Telemetry Dashboard</h1>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: getStatusColor(connectionStatus) }} />
          <span style={{ fontSize: '0.875rem' }}>MCP: {connectionStatus || 'Not Connected'}</span>
        </div>
        <div style={{ fontSize: '0.875rem', color: '#888' }}>
          Ollama: Ready
        </div>
        <div style={{ fontSize: '0.875rem', color: '#888' }}>
          Last Refresh: {time || '--:--:--'}
        </div>
      </div>
    </header>
  );
}