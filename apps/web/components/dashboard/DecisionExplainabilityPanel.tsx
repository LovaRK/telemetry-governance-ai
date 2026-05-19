'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface Decision {
  index: string;
  sourcetype?: string | null;
  tier: string;
  action: string;
  confidence: number;
  confidenceScore?: number;
  utilization?: number;
  detection?: number;
  quality?: number;
  risk?: number;
  savings?: number;
  reasoning: string;
  evidence: string[] | string;
  candidateReason: string[];
  recommendation?: string;
  // Governance lifecycle
  governanceStatus?: string;
  governanceNote?: string | null;
  governanceActor?: string | null;
  governanceUpdatedAt?: string | null;
}

interface Props {
  decisions: Decision[];
}

const ACTION_COLOR: Record<string, string> = {
  ELIMINATE: '#ef4444',
  ARCHIVE:   '#f97316',
  OPTIMIZE:  '#f59e0b',
  MONITOR:   '#6366f1',
  KEEP:      '#22c55e',
};

const TIER_COLOR: Record<string, string> = {
  'Critical':      '#ef4444',
  'Important':     '#f97316',
  'Nice-to-Have':  '#f59e0b',
  'Low-Value':     '#64748b',
};

const GOV_STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  NEW:          { label: 'Pending Review', color: '#64748b', icon: '⏳' },
  APPROVED:     { label: 'Approved',       color: '#22c55e', icon: '✅' },
  REJECTED:     { label: 'Rejected',       color: '#ef4444', icon: '❌' },
  UNDER_REVIEW: { label: 'Under Review',   color: '#f59e0b', icon: '👁' },
  DEFERRED:     { label: 'Deferred',       color: '#94a3b8', icon: '⏸' },
  ESCALATED:    { label: 'Escalated',      color: '#f97316', icon: '🔺' },
  IMPLEMENTED:  { label: 'Implemented',    color: '#0ea5e9', icon: '🚀' },
};

function GovernanceBadge({ status }: { status?: string }) {
  const cfg = GOV_STATUS_CONFIG[status || 'NEW'] || GOV_STATUS_CONFIG['NEW'];
  return (
    <span style={{
      fontSize: '0.62rem', fontWeight: 700, color: cfg.color,
      background: `${cfg.color}18`, padding: '2px 7px', borderRadius: 4,
      border: `1px solid ${cfg.color}35`, whiteSpace: 'nowrap',
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

const CANDIDATE_LABELS: Record<string, string> = {
  LONG_RETENTION:   'Long retention period',
  LOW_UTILIZATION:  'Low utilization',
  HIGH_COST:        'High cost relative to value',
  NO_DETECTIONS:    'No security detections',
  LOW_QUALITY:      'Low data quality',
  S3_CANDIDATE:     'S3 tiering candidate',
  QUICK_WIN:        'Quick win opportunity',
};

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '3px' }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{pct.toFixed(0)}</span>
      </div>
      <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

function parseEvidence(raw: string[] | string): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try { const p = JSON.parse(raw as string); return Array.isArray(p) ? p.filter(Boolean) : []; }
  catch { return typeof raw === 'string' && raw.length ? [raw] : []; }
}

function ConfidenceRing({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, Number(value) || 0));
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  const label = pct >= 80 ? 'HIGH' : pct >= 50 ? 'MEDIUM' : 'LOW';
  const r = 22, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={60} height={60} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={30} cy={30} r={r} fill="none" stroke="#1e293b" strokeWidth={5} />
        <circle cx={30} cy={30} r={r} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ marginTop: -44, fontSize: '0.9rem', fontWeight: 800, color, textAlign: 'center', lineHeight: 1 }}>
        {pct.toFixed(0)}
      </div>
      <div style={{ fontSize: '0.6rem', color, fontWeight: 700, letterSpacing: '0.05em', marginTop: 22 }}>
        {label}
      </div>
    </div>
  );
}

// ─── Audit Timeline ───────────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  from_status: string;
  to_status: string;
  actor_email: string | null;
  note: string | null;
  created_at: string;
}

function AuditTimeline({ indexName, sourcetype }: { indexName: string; sourcetype?: string | null }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ index: indexName });
      if (sourcetype) params.set('sourcetype', sourcetype);
      const res = await fetch(`/api/recommendations/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.audit || []);
      }
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  }, [indexName, sourcetype]);

  const handleToggle = () => {
    if (!open && entries.length === 0) fetchAudit();
    setOpen(o => !o);
  };

  const govCfg = (s: string) => GOV_STATUS_CONFIG[s] || GOV_STATUS_CONFIG['NEW'];

  return (
    <div style={{ marginTop: '1rem' }}>
      <button
        onClick={handleToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          cursor: 'pointer', fontSize: '0.65rem', color: '#6366f1', fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.07em', padding: 0,
        }}
      >
        <span style={{ fontSize: '0.8rem' }}>{open ? '▾' : '▸'}</span>
        📋 Audit History {entries.length > 0 && `(${entries.length})`}
      </button>

      {open && (
        <div style={{ marginTop: '0.6rem', paddingLeft: 8, borderLeft: '2px solid #1e293b' }}>
          {loading && <div style={{ fontSize: '0.72rem', color: '#475569', padding: '0.5rem 0' }}>Loading…</div>}
          {!loading && entries.length === 0 && (
            <div style={{ fontSize: '0.72rem', color: '#475569', padding: '0.5rem 0', fontStyle: 'italic' }}>
              No governance actions taken yet.
            </div>
          )}
          {entries.map((e, i) => {
            const cfg = govCfg(e.to_status);
            return (
              <div key={e.id} style={{ display: 'flex', gap: 10, marginBottom: '0.75rem', position: 'relative' }}>
                {/* Timeline dot */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', background: cfg.color,
                  flexShrink: 0, marginTop: 4, boxShadow: `0 0 6px ${cfg.color}60`,
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                      {e.from_status}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: '#334155' }}>→</span>
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, color: cfg.color }}>
                      {cfg.icon} {cfg.label}
                    </span>
                    {e.actor_email && (
                      <span style={{ fontSize: '0.62rem', color: '#475569' }}>by {e.actor_email}</span>
                    )}
                    <span style={{ fontSize: '0.6rem', color: '#334155', marginLeft: 'auto' }}>
                      {new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {e.note && (
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic', marginTop: 3, paddingLeft: 2 }}>
                      "{e.note}"
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function DecisionExplainabilityPanel({ decisions }: Props) {
  const [selected, setSelected] = useState<number>(0);
  const [lineageOpen, setLineageOpen] = useState(false);

  if (!decisions || decisions.length === 0) {
    return (
      <div style={{ padding: '2rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', color: '#475569', textAlign: 'center' }}>
        ⏳ LLM decisions not yet generated. Run a Splunk refresh to populate.
      </div>
    );
  }

  const d = decisions[selected];
  const evidence = parseEvidence(d.evidence);
  const actionColor = ACTION_COLOR[d.action?.toUpperCase()] || '#64748b';
  const tierColor = Object.entries(TIER_COLOR).find(([k]) => d.tier?.toLowerCase().includes(k.toLowerCase()))?.[1] || '#64748b';
  const confidencePct = Math.min(100, Math.max(0, (d.confidenceScore || d.confidence || 0) > 1
    ? (d.confidenceScore || d.confidence || 0)
    : (d.confidenceScore || d.confidence || 0) * 100));

  return (
    <div style={{ background: '#0a1628', borderRadius: 14, border: '1px solid #1e293b', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
            🧠 AI Decision Explainability
          </div>
          <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: 2 }}>
            {decisions.length} index{decisions.length !== 1 ? 'es' : ''} analyzed by LLM
          </div>
        </div>
        <button
          onClick={() => setLineageOpen(!lineageOpen)}
          style={{ fontSize: '0.72rem', color: '#6366f1', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '0.35rem 0.75rem', cursor: 'pointer', fontWeight: 600 }}
        >
          {lineageOpen ? '↑ Hide' : '↓ Show'} Lineage
        </button>
      </div>

      {/* Decision Lineage Trail */}
      {lineageOpen && (
        <div style={{ padding: '1rem 1.5rem', background: '#060f1e', borderBottom: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem', fontWeight: 700 }}>
            Decision Lineage — {d.index}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0', overflowX: 'auto', paddingBottom: 4 }}>
            {[
              { icon: '📡', label: 'Splunk Telemetry', sub: `${d.index} index data`, color: '#0ea5e9' },
              { icon: '⚙️', label: 'Aggregation', sub: 'GovernanceTelemetryService', color: '#6366f1' },
              { icon: '🤖', label: 'LLM Analysis', sub: 'gemma2:9b → Ollama', color: '#8b5cf6' },
              { icon: '📊', label: 'Score Synthesis', sub: `util·det·qual·risk`, color: '#f59e0b' },
              { icon: '✅', label: 'Recommendation', sub: d.action, color: actionColor },
            ].map((step, i, arr) => (
              <React.Fragment key={i}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: `${step.color}20`, border: `2px solid ${step.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>
                    {step.icon}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 700, textAlign: 'center', marginTop: 4, lineHeight: 1.2 }}>{step.label}</div>
                  <div style={{ fontSize: '0.58rem', color: '#475569', textAlign: 'center', marginTop: 2, lineHeight: 1.2 }}>{step.sub}</div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ flex: 1, height: 2, background: `linear-gradient(90deg, ${step.color}40, ${arr[i+1].color}40)`, marginTop: 17, minWidth: 20 }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', minHeight: 400 }}>

        {/* Index selector */}
        <div style={{ borderRight: '1px solid #1e293b', overflowY: 'auto', maxHeight: 500 }}>
          {decisions.map((dec, i) => {
            const ac = ACTION_COLOR[dec.action?.toUpperCase()] || '#64748b';
            const confPct = Math.min(100, (dec.confidenceScore || dec.confidence || 0) > 1
              ? (dec.confidenceScore || dec.confidence)
              : (dec.confidenceScore || dec.confidence) * 100);
            return (
              <div
                key={i}
                onClick={() => setSelected(i)}
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid #0f172a',
                  cursor: 'pointer',
                  background: selected === i ? '#0f172a' : 'transparent',
                  borderLeft: selected === i ? `3px solid ${ac}` : '3px solid transparent',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: selected === i ? '#f1f5f9' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dec.index}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, color: ac, background: `${ac}20`, padding: '1px 6px', borderRadius: 4 }}>
                    {dec.action}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: '#475569' }}>
                    {confPct.toFixed(0)}%
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  <GovernanceBadge status={dec.governanceStatus} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Decision detail */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', maxHeight: 500 }}>

          {/* Index header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f1f5f9' }}>{d.index}</div>
              {d.sourcetype && <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 2 }}>sourcetype: {d.sourcetype}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: actionColor, background: `${actionColor}20`, padding: '3px 10px', borderRadius: 6, border: `1px solid ${actionColor}40` }}>
                  {d.action}
                </span>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: tierColor, background: `${tierColor}15`, padding: '3px 10px', borderRadius: 6, border: `1px solid ${tierColor}30` }}>
                  {d.tier}
                </span>
                {d.candidateReason?.map((r, i) => (
                  <span key={i} style={{ fontSize: '0.65rem', color: '#94a3b8', background: '#1e293b', padding: '3px 8px', borderRadius: 6 }}>
                    {CANDIDATE_LABELS[r] || r}
                  </span>
                ))}
              </div>
            </div>
            <ConfidenceRing value={confidencePct} />
          </div>

          {/* Governance status card */}
          {(() => {
            const govCfg = GOV_STATUS_CONFIG[d.governanceStatus || 'NEW'] || GOV_STATUS_CONFIG['NEW'];
            const isActioned = d.governanceStatus && d.governanceStatus !== 'NEW';
            return (
              <div style={{
                marginBottom: '1rem', padding: '0.75rem 1rem',
                background: `${govCfg.color}10`, borderRadius: 8,
                border: `1px solid ${govCfg.color}35`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: govCfg.color, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>
                    {govCfg.icon} Governance Status
                  </div>
                  <GovernanceBadge status={d.governanceStatus} />
                </div>
                {isActioned && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {d.governanceActor && (
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                        <span style={{ color: '#64748b' }}>Reviewed by </span>
                        <span style={{ color: govCfg.color, fontWeight: 600 }}>{d.governanceActor}</span>
                        {d.governanceUpdatedAt && (
                          <span style={{ color: '#475569' }}> · {new Date(d.governanceUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                      </div>
                    )}
                    {d.governanceNote && (
                      <div style={{ fontSize: '0.75rem', color: '#cbd5e1', fontStyle: 'italic', borderLeft: `2px solid ${govCfg.color}60`, paddingLeft: 8, marginTop: 2 }}>
                        "{d.governanceNote}"
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Score bars */}
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.5rem', fontWeight: 700 }}>Score Breakdown</div>
            <ScoreBar label="Utilization" value={d.utilization ?? 0} color="#6366f1" />
            <ScoreBar label="Detection Coverage" value={d.detection ?? 0} color="#0ea5e9" />
            <ScoreBar label="Data Quality" value={d.quality ?? 0} color="#22c55e" />
            <ScoreBar label="Risk" value={d.risk ?? 0} color="#ef4444" />
          </div>

          {/* Recommendation card */}
          {d.recommendation && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: `${actionColor}10`, borderRadius: 8, border: `1px solid ${actionColor}30` }}>
              <div style={{ fontSize: '0.65rem', color: actionColor, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: '0.35rem' }}>
                📋 Recommended Action
              </div>
              <div style={{ fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.5 }}>{d.recommendation}</div>
              {(Number(d.savings) > 0) && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#22c55e', fontWeight: 700 }}>
                  Est. savings: ${Number(d.savings).toFixed(2)}/yr
                </div>
              )}
            </div>
          )}

          {/* LLM Reasoning */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: '0.5rem' }}>
              🤖 LLM Reasoning
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.65, padding: '0.75rem', background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b', borderLeft: `3px solid #6366f1` }}>
              {d.reasoning || 'No reasoning captured for this index.'}
            </div>
          </div>

          {/* Evidence */}
          {evidence.length > 0 && (
            <div>
              <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: '0.5rem' }}>
                🔎 Supporting Evidence
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {evidence.map((e, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.78rem', color: '#94a3b8', padding: '0.4rem 0.6rem', background: '#0f172a', borderRadius: 6, border: '1px solid #1e293b' }}>
                    <span style={{ color: '#6366f1', marginTop: 1, flexShrink: 0 }}>›</span>
                    <span>{typeof e === 'object' ? JSON.stringify(e) : e}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audit Timeline */}
          <AuditTimeline indexName={d.index} sourcetype={d.sourcetype} />

        </div>
      </div>
    </div>
  );
}
