'use client';
import { apiFetch } from '../lib/api-client';

import React, { useState, useEffect } from 'react';

interface UserConfig {
  id: number;
  configKey: string;
  costPerGbPerDay: number;
  maxRetentionDays: number;
  maxParallel: number;
  decisionWeights: Record<string, number>;
  retentionPolicy: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ConfigPanel({ open, onClose }: Props) {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState(0.5);
  const [retentionDays, setRetentionDays] = useState(730);

  useEffect(() => {
    if (open) {
      fetchConfig();
    }
  }, [open]);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/config');
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      setConfig(data);
      setCost(parseFloat(data.costPerGbPerDay));
      setRetentionDays(parseInt(data.maxRetentionDays));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      const res = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          costPerGbPerDay: cost,
          maxRetentionDays: retentionDays,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
    }} onClick={onClose}>
      <div style={{
        background: '#1e293b',
        borderRadius: 12,
        padding: '1.5rem',
        width: '90%',
        maxWidth: 480,
        color: '#f8fafc',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700 }}>Decision Configuration</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.25rem' }}>×</button>
        </div>

        {loading ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>Loading...</div>
        ) : (
          <>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Cost per GB per day ($)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input
                  type="range"
                  min="0.10"
                  max="2.00"
                  step="0.05"
                  value={cost}
                  onChange={(e) => setCost(parseFloat(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: '0.875rem', fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
                  ${cost.toFixed(2)}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                Your Splunk license cost model for ROI calculations
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Max retention days
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <input
                  type="range"
                  min="30"
                  max="3650"
                  step="30"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(parseInt(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: '0.875rem', fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
                  {retentionDays} days
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                Default retention for cold/archived data
              </div>
            </div>

            {config?.retentionPolicy && (
              <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#0f172a', borderRadius: 8 }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>TIER RETENTION POLICY</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8125rem' }}>
                  {Object.entries(config.retentionPolicy).map(([tier, days]) => (
                    <div key={tier} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>{tier.replace('_', ' ')}</span>
                      <span style={{ color: '#f8fafc' }}>{days}d</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: '0.75rem', background: '#7f1d1d', borderRadius: 6, color: '#fecaca', fontSize: '0.8125rem', marginBottom: '1rem' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {config?.updatedAt && `Updated ${new Date(config.updatedAt).toLocaleString()}`}
              </div>
              <button
                onClick={saveConfig}
                disabled={saving}
                style={{
                  padding: '0.5rem 1.25rem',
                  background: saving ? '#334155' : '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save Config'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}