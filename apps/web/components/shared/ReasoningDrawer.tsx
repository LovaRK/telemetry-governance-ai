'use client';

import { useState } from 'react';

export interface ReasoningDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  value?: string | number;
  howCalculated?: string;
  llmReasoning?: string;
  evidence?: string[];
  confidence?: number;
  tier?: string;
  action?: string;
  rawData?: Record<string, unknown>;
}

const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  S3_CANDIDATE: '#8b5cf6',
};

const TIER_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  IMPORTANT: '#f59e0b',
  NICE_TO_HAVE: '#3b82f6',
  LOW_VALUE: '#64748b',
};

export default function ReasoningDrawer({
  isOpen,
  onClose,
  title,
  value,
  howCalculated,
  llmReasoning,
  evidence = [],
  confidence,
  tier,
  action,
  rawData,
}: ReasoningDrawerProps) {
  const [rawExpanded, setRawExpanded] = useState(false);

  if (!isOpen) return null;

  const tierColor = tier ? (TIER_COLORS[tier] || '#64748b') : undefined;
  const actionColor = action ? (ACTION_COLORS[action] || '#94a3b8') : undefined;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 1000, backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
        background: '#0b1220', borderLeft: '1px solid #1e293b',
        zIndex: 1001, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
        animation: 'slideIn 0.2s ease-out',
        overflowY: 'auto',
      }}>
        <style>{`
          @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        `}</style>

        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid #1e293b',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          background: '#0f172a', position: 'sticky', top: 0, zIndex: 1,
        }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>
              LLM Decision Reasoning
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>{title}</div>
            {value !== undefined && (
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#38bdf8', marginTop: '0.15rem', lineHeight: 1 }}>
                {value}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
              width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
              fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >×</button>
        </div>

        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Tier + Action badges */}
          {(tier || action) && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {tier && (
                <span style={{
                  padding: '0.25rem 0.75rem', borderRadius: 9999,
                  background: `${tierColor}18`, border: `1px solid ${tierColor}40`,
                  color: tierColor, fontSize: '0.75rem', fontWeight: 600,
                }}>
                  Tier: {tier.replace('_', ' ')}
                </span>
              )}
              {action && (
                <span style={{
                  padding: '0.25rem 0.75rem', borderRadius: 9999,
                  background: `${actionColor}18`, border: `1px solid ${actionColor}40`,
                  color: actionColor, fontSize: '0.75rem', fontWeight: 600,
                }}>
                  Action: {action.replace('_', ' ')}
                </span>
              )}
              {confidence !== undefined && (
                <span style={{
                  padding: '0.25rem 0.75rem', borderRadius: 9999,
                  background: '#1e293b', border: '1px solid #334155',
                  color: confidence >= 70 ? '#22c55e' : confidence >= 40 ? '#f59e0b' : '#ef4444',
                  fontSize: '0.75rem', fontWeight: 600,
                }}>
                  Confidence: {confidence.toFixed(0)}%
                </span>
              )}
            </div>
          )}

          {/* Confidence bar */}
          {confidence !== undefined && (
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                Confidence Level
              </div>
              <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(confidence, 100)}%`, height: '100%', borderRadius: 4,
                  background: confidence >= 70 ? '#22c55e' : confidence >= 40 ? '#f59e0b' : '#ef4444',
                  transition: 'width 0.6s ease',
                }} />
              </div>
            </div>
          )}

          {/* How calculated */}
          {howCalculated && (
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                How This Was Calculated
              </div>
              <div style={{
                background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8,
                padding: '0.875rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem',
                color: '#93c5fd', lineHeight: 1.6,
                borderLeft: '3px solid #3b82f6',
              }}>
                {howCalculated}
              </div>
            </div>
          )}

          {/* LLM Reasoning */}
          {llmReasoning && (
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                🧠 LLM Reasoning
              </div>
              <div style={{
                background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
                padding: '0.875rem 1rem', fontSize: '0.825rem', color: '#e2e8f0',
                lineHeight: 1.65, maxHeight: 220, overflowY: 'auto',
              }}>
                {llmReasoning}
              </div>
            </div>
          )}

          {/* Evidence */}
          {evidence.length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                Evidence ({evidence.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {evidence.map((ev, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: '0.625rem', alignItems: 'flex-start',
                    padding: '0.5rem 0.75rem', background: '#111827',
                    border: '1px solid #1e293b', borderRadius: 6,
                  }}>
                    <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: '0.7rem', minWidth: 18, marginTop: '0.05rem' }}>
                      {i + 1}.
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.5 }}>{ev}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw data (collapsible) */}
          {rawData && Object.keys(rawData).length > 0 && (
            <div>
              <button
                onClick={() => setRawExpanded(!rawExpanded)}
                style={{
                  background: 'none', border: '1px solid #1e293b', color: '#64748b',
                  padding: '0.4rem 0.75rem', borderRadius: 6, cursor: 'pointer',
                  fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem',
                  width: '100%', justifyContent: 'space-between',
                }}
              >
                <span>Raw data sent to LLM</span>
                <span>{rawExpanded ? '▲' : '▼'}</span>
              </button>
              {rawExpanded && (
                <pre style={{
                  background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 6,
                  padding: '0.75rem', fontSize: '0.72rem', color: '#94a3b8',
                  overflowX: 'auto', marginTop: '0.5rem', lineHeight: 1.5,
                }}>
                  {JSON.stringify(rawData, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
