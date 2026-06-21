'use client';

/**
 * ParserExplainabilityDrawer — Phase 9
 *
 * Slide-in panel that shows:
 *   1. SPL query text (syntax highlighted)
 *   2. Field resolution table (resolved vs unresolved)
 *   3. Confidence score gauge
 *   4. Unresolved field explanation + remediation hints
 *   5. Registry-registered fields that ARE present (reference)
 *
 * Pure visualization — receives all data as props, no fetch calls.
 * Opened by the parent via onOpenDrawer callback (same pattern as ReasoningDrawer).
 */

import React, { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirror parser-confidence-service — no direct import to avoid bundling
// server code into the client bundle)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedField {
  name: string;
  type: string;
  resolved: boolean;
  confidence: number;
  source: 'registry' | 'pattern_match' | 'cim' | 'unresolved';
}

export interface UnresolvedField {
  name: string;
  reason: string;
  raw_token: string;
}

export interface ParserAuditData {
  auditId?: string;
  spl_query: string;
  parsed_fields: ParsedField[];
  unresolved_fields: UnresolvedField[];
  confidence_score: number;               // 0.0–1.0
  confidence_band?: 'high_confidence' | 'moderate_confidence' | 'low_confidence';
  unresolved_reason: string | null;
  parser_version?: string;
  index_name?: string;
  created_at?: string;
}

export interface ParserExplainabilityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  data: ParserAuditData | null;
  indexName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function confidenceColor(score: number): string {
  if (score >= 0.7) return '#22c55e';
  if (score >= 0.5) return '#f59e0b';
  return '#ef4444';
}

function bandLabel(score: number): string {
  if (score >= 0.7) return 'High Confidence';
  if (score >= 0.5) return 'Moderate Confidence';
  return 'Low Confidence — Review Required';
}

function sourceLabel(source: ParsedField['source']): { label: string; color: string } {
  switch (source) {
    case 'cim':           return { label: 'CIM Standard',    color: '#22c55e' };
    case 'registry':      return { label: 'Registry',        color: '#3b82f6' };
    case 'pattern_match': return { label: 'Pattern Match',   color: '#f59e0b' };
    case 'unresolved':    return { label: 'Unresolved',      color: '#ef4444' };
    default:              return { label: 'Unknown',         color: '#64748b' };
  }
}

function remediationHint(fieldName: string): string {
  const f = fieldName.toLowerCase();
  if (/ip$|addr|address/.test(f))
    return 'Add this field to parser_spl_field_registry with expected_type="ip".';
  if (/port$|^port/.test(f))
    return 'Add to registry with expected_type="number". Verify Splunk field extraction.';
  if (/time$|^time|timestamp|_at$/.test(f))
    return 'Check that strptime extraction is configured for this sourcetype.';
  if (/user|account|actor/.test(f))
    return 'Map to CIM Authentication data model. Use eval to normalize field name.';
  if (/count|total|num_/.test(f))
    return 'Verify eval expression produces numeric type. Check for null coercion.';
  return 'Check field name spelling and verify it exists in the sourcetype schema. Consider adding it to the CIM field registry.';
}

/** Minimal SPL syntax highlight — colours keywords, strings, field names. */
function SplHighlight({ spl }: { spl: string }) {
  const KEYWORDS = /\b(tstats|stats|eval|where|by|as|rename|rex|search|index|sourcetype|earliest|latest|head|tail|dedup|fields|table|sort|lookup|join|append|summariesonly|count|sum|avg|min|max|values|list|dc|first|last)\b/gi;
  const STRING   = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  const PIPE     = /(\|)/g;
  const NUMBER   = /\b(\d+(?:\.\d+)?)\b/g;
  const CAPTURE  = /(\(\?<[a-zA-Z_][a-zA-Z0-9_]*>)/g;

  // Simple sequential tokeniser — produces spans
  let remaining = spl;
  const tokens: React.ReactNode[] = [];
  let key = 0;

  while (remaining.length > 0) {
    let earliestMatch: RegExpExecArray | null = null;
    let matchType = '';
    const regexes: [RegExp, string][] = [
      [KEYWORDS, 'keyword'],
      [STRING,   'string'],
      [PIPE,     'pipe'],
      [NUMBER,   'number'],
      [CAPTURE,  'capture'],
    ];

    for (const [re, type] of regexes) {
      re.lastIndex = 0;
      const m = re.exec(remaining);
      if (m && (earliestMatch === null || m.index < earliestMatch.index)) {
        earliestMatch = m;
        matchType = type;
      }
    }

    if (!earliestMatch) {
      tokens.push(<span key={key++} style={{ color: '#cbd5e1' }}>{remaining}</span>);
      break;
    }

    // Text before match
    if (earliestMatch.index > 0) {
      tokens.push(
        <span key={key++} style={{ color: '#cbd5e1' }}>
          {remaining.substring(0, earliestMatch.index)}
        </span>,
      );
    }

    const color = matchType === 'keyword' ? '#38bdf8'
                : matchType === 'string'  ? '#86efac'
                : matchType === 'pipe'    ? '#f59e0b'
                : matchType === 'number'  ? '#fbbf24'
                : matchType === 'capture' ? '#c084fc'
                : '#cbd5e1';

    tokens.push(
      <span key={key++} style={{ color }}>
        {earliestMatch[0]}
      </span>,
    );

    remaining = remaining.substring(earliestMatch.index + earliestMatch[0].length);
  }

  return (
    <pre style={{
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: '0.78rem',
      lineHeight: 1.6,
      background: '#020817',
      border: '1px solid #1e293b',
      borderRadius: 8,
      padding: '0.875rem 1rem',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      margin: 0,
    }}>
      {tokens}
    </pre>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Gauge (semicircle)
// ─────────────────────────────────────────────────────────────────────────────

function ConfidenceGauge({ score }: { score: number }) {
  const pct   = Math.min(Math.max(score, 0), 1);
  const angle = pct * 180;
  const r = 50, cx = 65, cy = 65;
  const rad   = ((angle - 180) * Math.PI) / 180;
  const end   = { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  const large = angle > 90 ? 1 : 0;
  const color = confidenceColor(score);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={130} height={75} viewBox="0 0 130 75">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#1e293b" strokeWidth={12} strokeLinecap="round"
        />
        {pct > 0 && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`}
            fill="none" stroke={color} strokeWidth={12} strokeLinecap="round"
          />
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#f8fafc" fontSize={18} fontWeight={700}>
          {Math.round(pct * 100)}%
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize={9}>
          confidence
        </text>
      </svg>
      <div style={{
        fontSize: '0.68rem', fontWeight: 700, color,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2,
      }}>
        {bandLabel(score)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Drawer
// ─────────────────────────────────────────────────────────────────────────────

export function ParserExplainabilityDrawer({
  isOpen,
  onClose,
  data,
  indexName,
}: ParserExplainabilityDrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen || !data) return null;

  const resolvedCount    = data.parsed_fields.filter(f => f.resolved).length;
  const unresolvedCount  = data.unresolved_fields.length;
  const totalFields      = data.parsed_fields.length;
  const color            = confidenceColor(data.confidence_score);

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(2, 8, 23, 0.7)',
          zIndex: 9998,
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(660px, 92vw)',
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRight: 'none',
        zIndex: 9999,
        overflowY: 'auto',
        padding: '1.5rem',
        display: 'flex', flexDirection: 'column', gap: '1.25rem',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.65rem', backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                🔍 SPL Explainability
              </span>
              {data.parser_version && (
                <span style={{ fontSize: '0.6rem', color: '#475569' }}>parser v{data.parser_version}</span>
              )}
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
              Parser Confidence Audit
            </div>
            {(indexName ?? data.index_name) && (
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                Index: <span style={{ color: '#94a3b8', fontWeight: 600 }}>{indexName ?? data.index_name}</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid #334155', borderRadius: 6,
              color: '#64748b', cursor: 'pointer', fontSize: '0.875rem',
              padding: '0.3rem 0.6rem', flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Summary row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.5rem', alignItems: 'center' }}>
          <ConfidenceGauge score={data.confidence_score} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <StatRow label="Total fields extracted"  value={String(totalFields)}    color="#94a3b8" />
            <StatRow label="Resolved (CIM / registry)"  value={String(resolvedCount)}  color="#22c55e" />
            <StatRow label="Unresolved"               value={String(unresolvedCount)} color={unresolvedCount > 0 ? '#ef4444' : '#22c55e'} />
            {data.created_at && (
              <StatRow label="Audited at" value={new Date(data.created_at).toLocaleString()} color="#64748b" />
            )}
          </div>
        </div>

        {/* Unresolved reason */}
        {data.unresolved_reason && (
          <div style={{
            background: '#1c0a0a', border: '1px solid #ef444430',
            borderLeft: '4px solid #ef4444',
            borderRadius: 8, padding: '0.75rem 1rem',
          }}>
            <div style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 700, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ⚠ Resolution Issues
            </div>
            <div style={{ fontSize: '0.8rem', color: '#fca5a5', lineHeight: 1.5 }}>
              {data.unresolved_reason}
            </div>
          </div>
        )}

        {/* SPL Query */}
        <div>
          <SectionTitle>SPL Query</SectionTitle>
          <SplHighlight spl={data.spl_query} />
        </div>

        {/* Field Resolution Table */}
        {data.parsed_fields.length > 0 && (
          <div>
            <SectionTitle>Field Resolution ({totalFields} fields)</SectionTitle>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e293b' }}>
                    {['Field', 'Type', 'Source', 'Confidence'].map(h => (
                      <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.parsed_fields.map((f, i) => {
                    const srcStyle = sourceLabel(f.source);
                    return (
                      <tr key={f.name} style={{ borderBottom: '1px solid #0f172a', background: i % 2 ? '#ffffff04' : 'transparent' }}>
                        <td style={{ padding: '0.4rem 0.75rem', color: f.resolved ? '#f8fafc' : '#ef4444', fontFamily: 'monospace', fontWeight: 600 }}>
                          {f.resolved ? '' : '⚠ '}{f.name}
                        </td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#94a3b8' }}>
                          <span style={{ padding: '0.1rem 0.35rem', background: '#1e293b', borderRadius: 3, fontSize: '0.7rem' }}>
                            {f.type}
                          </span>
                        </td>
                        <td style={{ padding: '0.4rem 0.75rem' }}>
                          <span style={{ color: srcStyle.color, fontSize: '0.7rem', fontWeight: 600 }}>
                            {srcStyle.label}
                          </span>
                        </td>
                        <td style={{ padding: '0.4rem 0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {(() => {
                              const confPct = f.confidence <= 1 ? f.confidence * 100 : f.confidence;
                              return (
                                <>
                                  <div style={{ flex: 1, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden', minWidth: 40 }}>
                                    <div style={{
                                      height: '100%',
                                      width: `${Math.round(confPct)}%`,
                                      background: confidenceColor(f.confidence),
                                      borderRadius: 2,
                                    }} />
                                  </div>
                                  <span style={{ color: confidenceColor(f.confidence), fontSize: '0.68rem', fontWeight: 600, minWidth: 28 }}>
                                    {Math.round(confPct)}%
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Unresolved Fields — Remediation Guide */}
        {data.unresolved_fields.length > 0 && (
          <div>
            <SectionTitle>Remediation Guide ({unresolvedCount} unresolved)</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {data.unresolved_fields.map(f => (
                <div key={f.name} style={{
                  background: '#0f172a', border: '1px solid #1e293b',
                  borderLeft: '3px solid #ef4444',
                  borderRadius: 6, padding: '0.75rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#ef4444', fontSize: '0.82rem' }}>
                      {f.name}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: '#475569', background: '#1e293b', padding: '1px 6px', borderRadius: 3 }}>
                      {f.reason}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5 }}>
                    <span style={{ color: '#64748b' }}>💡 Fix: </span>
                    {remediationHint(f.name)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Register custom field action hint */}
        {data.unresolved_fields.length > 0 && (
          <div style={{
            background: '#0a1628', border: '1px solid #1e3a5f',
            borderRadius: 8, padding: '0.75rem 1rem',
            fontSize: '0.75rem', color: '#60a5fa', lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Register Custom Fields</div>
            To permanently resolve these fields, call
            {' '}<code style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 3, fontSize: '0.72rem' }}>
              registerCustomField(sourcetype, fieldName, type)
            </code>{' '}
            from <code style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 3, fontSize: '0.72rem' }}>
              parser-confidence-service.ts
            </code>, or insert directly into the{' '}
            <code style={{ background: '#1e293b', padding: '1px 6px', borderRadius: 3, fontSize: '0.72rem' }}>
              parser_spl_field_registry
            </code>{' '}table.
          </div>
        )}

        {/* Audit ID footer */}
        {data.auditId && (
          <div style={{ fontSize: '0.65rem', color: '#334155', textAlign: 'right', marginTop: 'auto', paddingTop: '0.5rem', borderTop: '1px solid #1e293b' }}>
            Audit ID: <span style={{ fontFamily: 'monospace' }}>{data.auditId}</span>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase',
      letterSpacing: '0.06em', fontWeight: 600, marginBottom: '0.625rem',
    }}>
      {children}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
