'use client';

import React, { useEffect } from 'react';

export interface ReasoningDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;                       // e.g. "ROI Score: 72"
  metric?: string;                      // e.g. "roi_score"
  value?: string | number;
  howCalculated?: string;              // Human-readable formula or explanation
  llmReasoning?: string;               // Full reasoning text from agent
  evidence?: string[];                 // Evidence array
  confidence?: number;                 // 0-100 for display
  tier?: string;                       // CRITICAL, IMPORTANT, etc.
  action?: string;                     // KEEP, OPTIMIZE, ARCHIVE, etc.
  candidateReason?: string[];          // Why this was selected for LLM processing
  rawData?: Record<string, unknown>;   // Raw numbers LLM saw
}

export default function ReasoningDrawer({
  isOpen,
  onClose,
  title,
  metric,
  value,
  howCalculated = 'Details about this metric',
  llmReasoning,
  evidence = [],
  confidence,
  tier,
  action,
  candidateReason = [],
  rawData,
}: ReasoningDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 999,
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: 420,
          background: '#0f172a',
          borderLeft: '1px solid #1e293b',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.5rem',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {metric}
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc', marginTop: '0.25rem' }}>
              {title}
            </div>
            {(tier || action) && (
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                {tier && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.25rem 0.5rem',
                      background: '#3b82f620',
                      color: '#3b82f6',
                      borderRadius: 4,
                      fontWeight: 600,
                    }}
                  >
                    {tier}
                  </span>
                )}
                {action && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.25rem 0.5rem',
                      background: '#8b5cf620',
                      color: '#8b5cf6',
                      borderRadius: 4,
                      fontWeight: 600,
                    }}
                  >
                    {action}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '1.5rem',
              cursor: 'pointer',
              padding: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable Content */}
        <div
          style={{
            overflow: 'auto',
            flex: 1,
            padding: '1.5rem',
          }}
        >
          {/* How Calculated */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              How This Was Calculated
            </div>
            <div
              style={{
                padding: '1rem',
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                color: '#cbd5e1',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {howCalculated}
            </div>
          </div>

          {/* Confidence */}
          {confidence !== undefined && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Confidence Score
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    background: '#334155',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${confidence}%`,
                      background: confidence >= 80 ? '#22c55e' : confidence >= 50 ? '#f59e0b' : '#ef4444',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#cbd5e1', minWidth: '3rem' }}>
                  {Math.round(confidence)}%
                </div>
              </div>
            </div>
          )}

          {/* Candidate Selection Reasons */}
          {candidateReason.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Why This Was Selected
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {candidateReason.map((reason, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0.5rem 0.75rem',
                      background: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: 6,
                      fontSize: '0.8rem',
                      color: '#cbd5e1',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span style={{ color: '#3b82f6', fontWeight: 600 }}>✓</span>
                    {reason.replace(/_/g, ' ')}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LLM Reasoning */}
          {llmReasoning && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                LLM Reasoning
              </div>
              <div
                style={{
                  padding: '1rem',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  color: '#cbd5e1',
                  lineHeight: 1.7,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {llmReasoning}
              </div>
            </div>
          )}

          {/* Evidence */}
          {evidence.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Evidence
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {evidence.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0.75rem',
                      background: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: 6,
                      fontSize: '0.8rem',
                      color: '#cbd5e1',
                    }}
                  >
                    <span style={{ color: '#64748b', marginRight: '0.5rem' }}>•</span>
                    {e}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw Data */}
          {rawData && Object.keys(rawData).length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <details
                style={{
                  cursor: 'pointer',
                }}
              >
                <summary
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#cbd5e1',
                    marginBottom: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    userSelect: 'none',
                  }}
                >
                  Raw Data LLM Received
                </summary>
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '1rem',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 8,
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    color: '#cbd5e1',
                    overflow: 'auto',
                  }}
                >
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify(rawData, null, 2)}
                  </pre>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
