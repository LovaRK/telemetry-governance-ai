'use client';

import React, { useState, useMemo } from 'react';

interface Props {
  isOpen: boolean;
  indexNames: string[];
  onClose: () => void;
  onApply: (action: string, reason?: string) => Promise<void>;
}

const ACTION_OPTIONS = [
  { value: 'KEEP', label: 'Keep', color: '#22c55e', description: 'Retain index as-is' },
  { value: 'OPTIMIZE', label: 'Optimize', color: '#f59e0b', description: 'Reduce fields or retention' },
  { value: 'ARCHIVE', label: 'Archive', color: '#3b82f6', description: 'Move to cold storage' },
  { value: 'ELIMINATE', label: 'Eliminate', color: '#ef4444', description: 'Delete index' },
  { value: 'S3_CANDIDATE', label: 'S3 Candidate', color: '#06b6d4', description: 'Consider AWS S3 migration' },
];

export default function BulkActionsModal({ isOpen, indexNames, onClose, onApply }: Props) {
  const [selectedAction, setSelectedAction] = useState('OPTIMIZE');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async () => {
    setLoading(true);
    setError(null);
    try {
      await onApply(selectedAction, reason);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply bulk action');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const selectedActionOption = ACTION_OPTIONS.find(a => a.value === selectedAction);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f172a',
          borderRadius: 12,
          border: '1px solid #1e293b',
          padding: '2rem',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.25rem', fontWeight: 700 }}>
            Bulk Action: {indexNames.length} Indexes
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '1.5rem',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Selected Indexes List */}
        <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#1e293b', borderRadius: 8 }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Selected Indexes
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem', maxHeight: '150px', overflow: 'auto' }}>
            {indexNames.slice(0, 20).map(name => (
              <div
                key={name}
                style={{
                  padding: '0.5rem',
                  background: '#0f172a',
                  borderRadius: 4,
                  fontSize: '0.8125rem',
                  color: '#cbd5e1',
                  fontFamily: 'monospace',
                  border: '1px solid #334155',
                }}
              >
                {name}
              </div>
            ))}
          </div>
          {indexNames.length > 20 && (
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.5rem' }}>
              +{indexNames.length - 20} more indexes
            </div>
          )}
        </div>

        {/* Action Selection */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Select Action
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {ACTION_OPTIONS.map(option => (
              <button
                key={option.value}
                onClick={() => setSelectedAction(option.value)}
                style={{
                  padding: '1rem',
                  background: selectedAction === option.value ? option.color + '20' : '#1e293b',
                  border: `2px solid ${selectedAction === option.value ? option.color : '#334155'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  color: selectedAction === option.value ? option.color : '#cbd5e1',
                  fontWeight: selectedAction === option.value ? 600 : 500,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontWeight: 600 }}>{option.label}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Reason/Notes */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Reason (optional)
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why are you applying this action? E.g., 'Cost reduction initiative', 'Compliance requirement', etc."
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
              color: '#f8fafc',
              fontSize: '0.875rem',
              fontFamily: 'inherit',
              minHeight: '80px',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div style={{ padding: '0.75rem', background: '#ef444420', color: '#ef4444', borderRadius: 6, marginBottom: '1rem', fontSize: '0.8125rem' }}>
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              opacity: loading ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={loading}
            style={{
              padding: '0.75rem 1.5rem',
              background: selectedActionOption?.color || '#3b82f6',
              border: 'none',
              color: '#ffffff',
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Applying...' : `Apply ${selectedActionOption?.label} to ${indexNames.length} Indexes`}
          </button>
        </div>
      </div>
    </div>
  );
}
