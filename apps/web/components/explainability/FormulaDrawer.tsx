'use client';

import React, { useState } from 'react';
import { KPIExplainabilityRecord } from '@/lib/types';
import { apiFetch } from '@/lib/api-client';

interface Props {
  record: KPIExplainabilityRecord | null;
  onClose: () => void;
}

export default function FormulaDrawer({ record, onClose }: Props) {
  const [history, setHistory] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  if (!record) return null;
  const inputs = record.inputs || [];

  const loadHistory = async () => {
    const id = String(record.metricId || '').toLowerCase();
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/kpi/history/${encodeURIComponent(id)}`);
      if (!res.ok) {
        setHistory({ error: 'Unavailable' });
      } else {
        const body = await res.json();
        setHistory(body?.data || null);
      }
    } catch {
      setHistory({ error: 'Unavailable' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.75)', zIndex: 60 }} onClick={onClose}>
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 'min(520px, 92vw)',
          height: '100%',
          background: '#0b1220',
          borderLeft: '1px solid #1e293b',
          padding: '1rem',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ color: '#f8fafc', margin: 0 }}>{record.displayLabel || record.metricId} Explainability</h3>
          <button onClick={onClose} style={{ background: '#1e293b', color: '#e2e8f0', border: 0, borderRadius: 6, padding: '0.4rem 0.6rem' }}>Close</button>
        </div>
        <div style={{ marginTop: '1rem', color: '#cbd5e1', fontSize: '0.9rem' }}>
          <div><b>Formula:</b> {record.formulaExpression || 'Unavailable'}</div>
          <div><b>Displayed Value:</b> {Number(record.value || 0).toFixed(2)}</div>
          <div><b>Computed Value:</b> {Number.isFinite(record.computedValue) ? Number(record.computedValue).toFixed(2) : 'Not computed'}</div>
          <div><b>Source Origin:</b> {record.sourceOrigin || 'Unknown'}</div>
          <div><b>Source Table:</b> {record.sourceTable || 'Unknown'}</div>
          <div><b>Source Run:</b> {record.sourceRunId || 'Unknown'}</div>
          <div><b>Source Snapshot:</b> {record.sourceSnapshotId || 'Unknown'}</div>
          <div><b>Timestamp:</b> {record.updatedAt ? new Date(record.updatedAt).toLocaleString() : 'Unknown'}</div>
          <div><b>Confidence:</b> {record.confidence || 'Unknown'}</div>
          <div><b>Variance:</b> {record.variance || 'Not computed'}</div>
        </div>

        <div style={{ marginTop: '0.85rem' }}>
          <button data-testid="why-changed" onClick={loadHistory} style={{ background: '#1d4ed8', color: '#fff', border: 0, borderRadius: 6, padding: '0.4rem 0.6rem', cursor: 'pointer' }}>
            Why changed?
          </button>
          {loading ? <div style={{ marginTop: 8, color: '#94a3b8' }}>Loading history…</div> : null}
          {history ? (
            <div style={{ marginTop: 10, padding: '0.6rem', border: '1px solid #1e293b', borderRadius: 8 }} data-testid="kpi-history-block">
              <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}><b>Before:</b> {history.before ?? 'Unavailable'}</div>
              <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}><b>After:</b> {history.after ?? 'Unavailable'}</div>
              <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}><b>Delta:</b> {history.delta ?? 'Not computed'}</div>
              <div style={{ color: '#cbd5e1', fontSize: '0.85rem' }}><b>Reason:</b> {history.reason || history.error || 'Unavailable'}</div>
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: '1rem' }}>
          <div style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Inputs</div>
          {inputs.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Unavailable</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {inputs.map((i) => (
                <div key={i.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0.6rem', border: '1px solid #1e293b', borderRadius: 8, color: '#e2e8f0' }}>
                  <span>{i.key}</span>
                  <span>{Number(i.value).toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
