'use client';
import { apiFetch } from '../lib/api-client';

import React, { useState } from 'react';

interface BulkActionResult {
  indexName: string;
  previousAction: string;
  newAction: string;
  success: boolean;
  message: string;
  timestamp: Date;
}

interface BulkActionsPanelProps {
  selectedIndexes: string[];
  onClose: () => void;
  onComplete?: (results: BulkActionResult[]) => void;
}

export default function BulkActionsPanel({
  selectedIndexes,
  onClose,
  onComplete
}: BulkActionsPanelProps) {
  const [action, setAction] = useState<'KEEP' | 'OPTIMIZE' | 'ARCHIVE' | 'ELIMINATE' | 'S3_CANDIDATE'>('ARCHIVE');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkActionResult[] | null>(null);

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiFetch('/api/bulk-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          indexNames: selectedIndexes,
          action,
          reason: reason || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to apply bulk action');
        return;
      }

      setResults(data.results);
      if (onComplete) onComplete(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (results) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ color: '#f8fafc', margin: '0 0 0.5rem 0' }}>Bulk Action Results</h3>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
            {results.filter(r => r.success).length} of {results.length} indexes updated successfully
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem', maxHeight: '300px', overflow: 'auto' }}>
          {results.map((result, i) => (
            <div
              key={i}
              style={{
                padding: '0.75rem',
                background: result.success ? '#064e3b20' : '#7f1d1d20',
                border: `1px solid ${result.success ? '#10b98150' : '#ef444450'}`,
                borderRadius: 6,
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '0.5rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#f8fafc', fontWeight: 600 }}>{result.indexName}</div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                    {result.previousAction} → {result.newAction}
                  </div>
                </div>
                <div style={{ color: result.success ? '#10b981' : '#ef4444' }}>
                  {result.success ? '✓' : '✕'}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              background: '#3b82f6',
              color: '#f8fafc',
              border: 'none',
              borderRadius: 6,
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <h3 style={{ color: '#f8fafc', margin: '0 0 1.5rem 0' }}>
        Bulk Actions ({selectedIndexes.length} indexes)
      </h3>

      {error && (
        <div
          style={{
            padding: '0.75rem',
            background: '#7f1d1d',
            color: '#fca5a5',
            borderRadius: 6,
            fontSize: '0.85rem',
            marginBottom: '1rem',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          Action
        </label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as any)}
          style={{
            width: '100%',
            padding: '0.75rem',
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            borderRadius: 6,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          <option value="KEEP">Keep</option>
          <option value="OPTIMIZE">Optimize</option>
          <option value="ARCHIVE">Archive</option>
          <option value="ELIMINATE">Eliminate</option>
          <option value="S3_CANDIDATE">S3 Candidate</option>
        </select>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          Reason (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g., Low utilization, redundant data, cost optimization"
          style={{
            width: '100%',
            padding: '0.75rem',
            background: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            borderRadius: 6,
            fontSize: '0.85rem',
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: '80px',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            background: '#334155',
            color: '#cbd5e1',
            border: 'none',
            borderRadius: 6,
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            background: '#ef4444',
            color: '#f8fafc',
            border: 'none',
            borderRadius: 6,
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Applying...' : `Apply to ${selectedIndexes.length} Indexes`}
        </button>
      </div>
    </div>
  );
}
