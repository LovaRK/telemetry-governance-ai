'use client';

import React, { useState, useEffect } from 'react';
import type { UserConfig } from '../../app/api/config/route';

interface ConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ConfigPanel({ isOpen, onClose }: ConfigPanelProps) {
  const [config, setConfig] = useState<UserConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [formState, setFormState] = useState({
    costPerGbPerDay: 0.5,
    maxIndexesPerRun: 1000,
    llmTimeoutMs: 30000,
  });

  // Load config on mount
  useEffect(() => {
    if (isOpen && !config) {
      loadConfig();
    }
  }, [isOpen, config]);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Failed to load configuration');
      const data = await response.json();
      setConfig(data);
      setFormState({
        costPerGbPerDay: data.costPerGbPerDay,
        maxIndexesPerRun: data.maxIndexesPerRun,
        llmTimeoutMs: data.llmTimeoutMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to load config: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formState),
      });
      if (!response.ok) throw new Error('Failed to save configuration');
      const data = await response.json();
      setConfig(data);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to save config: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '2rem',
          width: '90%',
          maxWidth: 500,
          boxShadow: '0 20px 25px rgba(0, 0, 0, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, color: '#e2e8f0', fontSize: '1.25rem' }}>Configuration</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Last Updated */}
        {lastUpdated && (
          <div style={{ marginBottom: '1rem', fontSize: '0.75rem', color: '#64748b' }}>
            ✓ Config saved at {lastUpdated}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem',
              backgroundColor: '#7f1d1d',
              color: '#fca5a5',
              borderRadius: 4,
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem 0' }}>
            Loading configuration...
          </div>
        ) : (
          <>
            {/* Cost Per GB/Day */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.5rem' }}>
                License Cost ($/GB/day)
              </label>
              <input
                type="range"
                min="0.1"
                max="2"
                step="0.05"
                value={formState.costPerGbPerDay}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    costPerGbPerDay: parseFloat(e.target.value),
                  }))
                }
                style={{ width: '100%', marginBottom: '0.5rem' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
                <span>$0.10</span>
                <span style={{ fontWeight: 600, color: '#3b82f6' }}>
                  ${formState.costPerGbPerDay.toFixed(2)}
                </span>
                <span>$2.00</span>
              </div>
            </div>

            {/* Max Indexes Per Run */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.5rem' }}>
                Max Indexes Per Run
              </label>
              <input
                type="number"
                min="10"
                max="5000"
                step="100"
                value={formState.maxIndexesPerRun}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    maxIndexesPerRun: parseInt(e.target.value, 10),
                  }))
                }
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  color: '#e2e8f0',
                  fontSize: '0.875rem',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Prevents runaway pipeline execution
              </div>
            </div>

            {/* LLM Timeout */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.5rem' }}>
                LLM Timeout (milliseconds)
              </label>
              <input
                type="number"
                min="5000"
                max="120000"
                step="5000"
                value={formState.llmTimeoutMs}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    llmTimeoutMs: parseInt(e.target.value, 10),
                  }))
                }
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  color: '#e2e8f0',
                  fontSize: '0.875rem',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                {(formState.llmTimeoutMs / 1000).toFixed(1)}s per LLM batch
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: 'transparent',
                  border: '1px solid #334155',
                  color: '#cbd5e1',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: saving ? 'wait' : 'pointer',
                  fontSize: '0.875rem',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
