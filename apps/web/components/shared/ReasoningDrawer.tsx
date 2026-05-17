'use client';

import React, { useState } from 'react';

export interface ReasoningDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  metric?: string;
  value?: string | number;
  howCalculated?: string;
  llmReasoning?: string;
  evidence?: string[];
  confidence?: number;
  tier?: string;
  action?: string;
  rawData?: Record<string, unknown>;
}

export default function ReasoningDrawer({
  isOpen,
  onClose,
  title,
  metric,
  value,
  howCalculated,
  llmReasoning,
  evidence,
  confidence,
  tier,
  action,
  rawData,
}: ReasoningDrawerProps) {
  const [expandedRawData, setExpandedRawData] = useState(false);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 999,
          backdropFilter: 'blur(4px)',
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
          backgroundColor: '#0f172a',
          boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.4)',
          zIndex: 1000,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 0.3s ease-out',
        }}
      >
        <style>{`
          @keyframes slideInRight {
            from {
              transform: translateX(100%);
            }
            to {
              transform: translateX(0);
            }
          }
        `}</style>

        {/* Header */}
        <div
          style={{
            padding: '24px',
            borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: 600,
                color: '#f1f5f9',
              }}
            >
              {title}
            </h2>
            {value !== undefined && (
              <p
                style={{
                  margin: '8px 0 0 0',
                  fontSize: '24px',
                  fontWeight: 700,
                  color: '#00d9ff',
                }}
              >
                {value}
              </p>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '24px',
              cursor: 'pointer',
              padding: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#cbd5e1')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
          }}
        >
          {/* Tier & Action */}
          {(tier || action) && (
            <div style={{ display: 'flex', gap: '12px' }}>
              {tier && (
                <div
                  style={{
                    display: 'inline-block',
                    padding: '4px 12px',
                    backgroundColor: getTierColor(tier),
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Tier: {tier}
                </div>
              )}
              {action && (
                <div
                  style={{
                    display: 'inline-block',
                    padding: '4px 12px',
                    backgroundColor: getActionColor(action),
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Action: {action}
                </div>
              )}
            </div>
          )}

          {/* How Calculated */}
          {howCalculated && (
            <div>
              <h3
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                How This Was Calculated
              </h3>
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(51, 65, 85, 0.5)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#cbd5e1',
                  lineHeight: '1.6',
                  fontFamily: 'monospace',
                }}
              >
                {howCalculated}
              </div>
            </div>
          )}

          {/* Confidence */}
          {confidence !== undefined && (
            <div>
              <h3
                style={{
                  margin: '0 0 8px 0',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Confidence
              </h3>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: '8px',
                    backgroundColor: 'rgba(51, 65, 85, 0.5)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, confidence * 100)}%`,
                      backgroundColor: getConfidenceColor(confidence),
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: '13px',
                    color: '#94a3b8',
                    minWidth: '40px',
                  }}
                >
                  {Math.round(confidence * 100)}%
                </span>
              </div>
            </div>
          )}

          {/* LLM Reasoning */}
          {llmReasoning && (
            <div>
              <h3
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                LLM Reasoning
              </h3>
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(51, 65, 85, 0.5)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#cbd5e1',
                  lineHeight: '1.7',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '300px',
                  overflow: 'auto',
                }}
              >
                {llmReasoning}
              </div>
            </div>
          )}

          {/* Evidence */}
          {evidence && evidence.length > 0 && (
            <div>
              <h3
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Evidence
              </h3>
              <ul
                style={{
                  margin: 0,
                  padding: '0 0 0 20px',
                  listStyle: 'disc',
                }}
              >
                {evidence.map((item, idx) => (
                  <li
                    key={idx}
                    style={{
                      fontSize: '13px',
                      color: '#cbd5e1',
                      marginBottom: '8px',
                      lineHeight: '1.6',
                    }}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Raw Data (Optional, Expandable) */}
          {rawData && (
            <div>
              <button
                onClick={() => setExpandedRawData(!expandedRawData)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#00d9ff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '12px',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    transition: 'transform 0.2s ease',
                    transform: expandedRawData ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                >
                  ▶
                </span>
                Raw Data LLM Received
              </button>

              {expandedRawData && (
                <pre
                  style={{
                    padding: '12px',
                    backgroundColor: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(51, 65, 85, 0.5)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: '#cbd5e1',
                    overflow: 'auto',
                    margin: 0,
                    fontFamily: 'monospace',
                    lineHeight: '1.5',
                  }}
                >
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

// Helper functions for colors
function getTierColor(tier: string): string {
  switch (tier?.toUpperCase()) {
    case 'CRITICAL':
      return '#dc2626';
    case 'IMPORTANT':
      return '#f97316';
    case 'NICE_TO_HAVE':
      return '#eab308';
    case 'LOW_VALUE':
      return '#64748b';
    default:
      return '#64748b';
  }
}

function getActionColor(action: string): string {
  switch (action?.toUpperCase()) {
    case 'KEEP':
      return '#059669';
    case 'OPTIMIZE':
      return '#0891b2';
    case 'ARCHIVE':
      return '#7c3aed';
    case 'ELIMINATE':
      return '#dc2626';
    case 'S3_CANDIDATE':
      return '#6366f1';
    default:
      return '#64748b';
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return '#10b981';
  if (confidence >= 0.6) return '#f59e0b';
  return '#ef4444';
}
