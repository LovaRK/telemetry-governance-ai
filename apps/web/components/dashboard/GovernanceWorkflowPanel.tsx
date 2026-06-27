'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api-client';

type RecStatus =
  | 'NEW' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'
  | 'DEFERRED' | 'ESCALATED' | 'IMPLEMENTED' | 'ROLLED_BACK';

interface Recommendation {
  id: string;
  index_name: string;
  status: RecStatus;
  tier: string;
  ai_action: string;
  confidence: number;
  confidence_score: number;
  recommendation: string;
  reasoning: string;
  estimated_savings: number;
  is_quick_win: boolean;
  candidate_reason: string[];
  actor_email: string | null;
  actor_role: string | null;
  action_note: string | null;
  updated_at: string;
}

interface AuditEntry {
  id: string;
  from_status: RecStatus | null;
  to_status: RecStatus;
  actor_email: string | null;
  note: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<RecStatus, { color: string; bg: string; label: string; icon: string }> = {
  NEW:          { color: '#6366f1', bg: 'rgba(99,102,241,0.15)',  label: 'New',           icon: '🔵' },
  UNDER_REVIEW: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: 'Under Review',  icon: '👁' },
  APPROVED:     { color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  label: 'Approved',      icon: '✅' },
  REJECTED:     { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  label: 'Rejected',      icon: '❌' },
  DEFERRED:     { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: 'Deferred',      icon: '⏸' },
  ESCALATED:    { color: '#f97316', bg: 'rgba(249,115,22,0.15)', label: 'Escalated',     icon: '🔺' },
  IMPLEMENTED:  { color: '#0ea5e9', bg: 'rgba(14,165,233,0.15)', label: 'Implemented',   icon: '🚀' },
  ROLLED_BACK:  { color: '#a855f7', bg: 'rgba(168,85,247,0.15)', label: 'Rolled Back',   icon: '↩' },
};

const ACTION_COLOR: Record<string, string> = {
  ELIMINATE: '#ef4444', ARCHIVE: '#f97316', OPTIMIZE: '#f59e0b',
  MONITOR: '#6366f1', KEEP: '#22c55e',
};

function StatusBadge({ status }: { status: RecStatus }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.NEW;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: '0.65rem', fontWeight: 700, color: cfg.color,
      background: cfg.bg, border: `1px solid ${cfg.color}40`,
      padding: '2px 8px', borderRadius: 20,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

interface ActionModalProps {
  rec: Recommendation;
  onClose: () => void;
  onSubmit: (id: string, status: RecStatus, note: string, escalateTo?: string) => Promise<void>;
}

function ActionModal({ rec, onClose, onSubmit }: ActionModalProps) {
  const [selectedStatus, setSelectedStatus] = useState<RecStatus | ''>('');
  const [note, setNote] = useState('');
  const [escalateTo, setEscalateTo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const ACTIONS: { status: RecStatus; label: string; icon: string; desc: string; color: string }[] = [
    { status: 'APPROVED',     label: 'Approve',     icon: '✅', desc: 'Accept the AI recommendation',    color: '#22c55e' },
    { status: 'REJECTED',     label: 'Reject',      icon: '❌', desc: 'Reject — requires reason',         color: '#ef4444' },
    { status: 'UNDER_REVIEW', label: 'Mark Review', icon: '👁', desc: 'Flag for deeper analysis',          color: '#f59e0b' },
    { status: 'DEFERRED',     label: 'Defer',       icon: '⏸', desc: 'Postpone decision',                color: '#94a3b8' },
    { status: 'ESCALATED',    label: 'Escalate',    icon: '🔺', desc: 'Escalate to senior analyst',       color: '#f97316' },
    { status: 'IMPLEMENTED',  label: 'Implemented', icon: '🚀', desc: 'Mark as applied in Splunk',        color: '#0ea5e9' },
  ];

  const handleSubmit = async () => {
    if (!selectedStatus) return;
    if (selectedStatus === 'REJECTED' && !note.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit(rec.id, selectedStatus, note, escalateTo || undefined);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const needsNote = selectedStatus === 'REJECTED' || selectedStatus === 'DEFERRED';
  const needsEscalate = selectedStatus === 'ESCALATED';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 480, background: '#0f172a', border: '1px solid #334155', borderRadius: 14,
        zIndex: 1001, padding: '1.5rem', boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: '#f1f5f9' }}>{rec.index_name}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: ACTION_COLOR[rec.ai_action] || '#64748b', background: `${ACTION_COLOR[rec.ai_action] || '#64748b'}20`, padding: '2px 8px', borderRadius: 4 }}>
                {rec.ai_action}
              </span>
              <StatusBadge status={rec.status} />
            </div>
          </div>
          <button onClick={onClose} style={{ color: '#475569', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>✕</button>
        </div>

        {/* AI recommendation summary */}
        <div style={{ padding: '0.75rem', background: '#060f1e', borderRadius: 8, marginBottom: '1rem', border: '1px solid #1e293b' }}>
          <div style={{ fontSize: '0.65rem', color: '#6366f1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>AI Recommendation</div>
          <div style={{ fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.5 }}>{rec.recommendation}</div>
        </div>

        {/* Action selector */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '0.5rem' }}>Your Decision</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {ACTIONS.map((a) => (
              <button
                key={a.status}
                onClick={() => setSelectedStatus(a.status)}
                style={{
                  padding: '0.6rem 0.75rem', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${selectedStatus === a.status ? a.color : '#1e293b'}`,
                  background: selectedStatus === a.status ? `${a.color}15` : '#060f1e',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: selectedStatus === a.status ? a.color : '#94a3b8' }}>
                  {a.icon} {a.label}
                </div>
                <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2 }}>{a.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Note / feedback */}
        {(selectedStatus || needsNote) && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block', marginBottom: 4 }}>
              {needsNote ? 'Reason (required)' : 'Note (optional)'}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                selectedStatus === 'REJECTED' ? 'e.g. main index feeds compliance dashboards' :
                selectedStatus === 'DEFERRED' ? 'e.g. Revisit after Q3 audit' :
                'Optional context for this decision...'
              }
              style={{
                width: '100%', minHeight: 70, padding: '0.6rem', resize: 'vertical',
                background: '#060f1e', border: '1px solid #334155', borderRadius: 6,
                color: '#e2e8f0', fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Escalate to */}
        {needsEscalate && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, display: 'block', marginBottom: 4 }}>
              Escalate To (email or role)
            </label>
            <input
              value={escalateTo}
              onChange={(e) => setEscalateTo(e.target.value)}
              placeholder="e.g. manager@company.com or Senior Analyst"
              style={{
                width: '100%', padding: '0.6rem', background: '#060f1e', border: '1px solid #334155',
                borderRadius: 6, color: '#e2e8f0', fontSize: '0.78rem', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Submit */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.5rem 1rem', background: 'none', border: '1px solid #334155', borderRadius: 6, color: '#64748b', cursor: 'pointer', fontSize: '0.8rem' }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedStatus || submitting || (needsNote && !note.trim())}
            style={{
              padding: '0.5rem 1.25rem', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', border: 'none',
              background: selectedStatus ? (STATUS_CONFIG[selectedStatus]?.color || '#6366f1') : '#1e293b',
              color: selectedStatus ? '#fff' : '#475569',
              opacity: (!selectedStatus || (needsNote && !note.trim())) ? 0.5 : 1,
            }}
          >
            {submitting ? 'Submitting...' : `Confirm ${selectedStatus ? STATUS_CONFIG[selectedStatus]?.label : 'Decision'}`}
          </button>
        </div>
      </div>
    </>
  );
}

interface AuditTimelineProps {
  entries: AuditEntry[];
}

function AuditTimeline({ entries }: AuditTimelineProps) {
  if (entries.length === 0) return (
    <div style={{ color: '#475569', fontSize: '0.75rem', padding: '0.5rem 0' }}>No actions yet.</div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {entries.map((e, i) => {
        const toCfg = STATUS_CONFIG[e.to_status] || STATUS_CONFIG.NEW;
        return (
          <div key={e.id} style={{ display: 'flex', gap: 10, paddingBottom: i < entries.length - 1 ? '0.75rem' : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: toCfg.bg, border: `2px solid ${toCfg.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', flexShrink: 0 }}>
                {toCfg.icon}
              </div>
              {i < entries.length - 1 && <div style={{ width: 1, flex: 1, background: '#1e293b', marginTop: 2 }} />}
            </div>
            <div style={{ paddingTop: 2, paddingBottom: 6 }}>
              <div style={{ fontSize: '0.72rem', color: toCfg.color, fontWeight: 700 }}>
                {e.from_status ? `${STATUS_CONFIG[e.from_status]?.label || e.from_status} → ` : ''}
                {toCfg.label}
              </div>
              {e.actor_email && <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: 1 }}>by {e.actor_email}</div>}
              {e.note && <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 2, fontStyle: 'italic' }}>"{e.note}"</div>}
              <div style={{ fontSize: '0.6rem', color: '#334155', marginTop: 2 }}>
                {new Date(e.created_at).toLocaleString()}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  snapshotId?: string;
}

export default function GovernanceWorkflowPanel({ snapshotId }: Props) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeModal, setActiveModal] = useState<Recommendation | null>(null);
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [auditData, setAuditData] = useState<Record<string, AuditEntry[]>>({});
  const [filterStatus, setFilterStatus] = useState<RecStatus | 'ALL'>('ALL');

  const fetchRecommendations = useCallback(async () => {
    try {
      const url = snapshotId
        ? `/api/recommendations?snapshotId=${snapshotId}`
        : '/api/recommendations';
      const res = await apiFetch(url);
      if (res.ok) {
        const body = await res.json();
        // API wraps in { data: { recommendations: [...] }, meta: {...} }
        const recs = body?.data?.recommendations ?? body?.recommendations ?? [];
        setRecommendations(recs);
      }
    } catch (e) {
      console.error('[GovernanceWorkflowPanel] fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [snapshotId]);

  useEffect(() => { fetchRecommendations(); }, [fetchRecommendations]);

  const handleAction = async (id: string, status: RecStatus, note: string, escalateTo?: string) => {
    const user = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || '{}') : {};
    const actorEmail = user.email || null;

    // Optimistic update — immediately reflect in UI
    setRecommendations(prev => prev.map(r =>
      r.id === id
        ? { ...r, status, action_note: note || r.action_note, actor_email: actorEmail || r.actor_email, updated_at: new Date().toISOString() }
        : r
    ));

    // Add optimistic audit entry
    const optimisticEntry: AuditEntry = {
      id: `optimistic-${Date.now()}`,
      from_status: recommendations.find(r => r.id === id)?.status || null,
      to_status: status,
      actor_email: actorEmail,
      note: note || null,
      created_at: new Date().toISOString(),
    };
    setAuditData(prev => ({ ...prev, [id]: [...(prev[id] || []), optimisticEntry] }));

    try {
      const res = await apiFetch(`/api/recommendations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note, escalateTo, actorEmail }),
      });
      if (res.ok) {
        // Sync real audit trail after action
        const detail = await apiFetch(`/api/recommendations/${id}`);
        if (detail.ok) {
          const body = await detail.json();
          const trail = body?.data?.auditTrail ?? body?.auditTrail ?? [];
          setAuditData(prev => ({ ...prev, [id]: trail }));
          // Ensure audit is expanded to show the new entry
          setExpandedAudit(id);
        }
      }
    } catch (e) {
      // Revert optimistic update on failure
      console.error('[GovernanceWorkflowPanel] action error', e);
      await fetchRecommendations();
    }
  };

  const toggleAudit = async (id: string) => {
    if (expandedAudit === id) { setExpandedAudit(null); return; }
    setExpandedAudit(id);
    if (!auditData[id]) {
      try {
        const res = await apiFetch(`/api/recommendations/${id}`);
        if (res.ok) {
          const body = await res.json();
          const trail = body?.data?.auditTrail ?? body?.auditTrail ?? [];
          setAuditData(prev => ({ ...prev, [id]: trail }));
        }
      } catch {
        // Network error — audit trail stays empty; not critical
      }
    }
  };

  const filtered = filterStatus === 'ALL'
    ? recommendations
    : recommendations.filter(r => r.status === filterStatus);

  const statusCounts = recommendations.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div style={{ padding: '2rem', background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', color: '#475569', textAlign: 'center' }}>
        Loading governance workflow...
      </div>
    );
  }

  return (
    <div style={{ background: '#0a1628', borderRadius: 14, border: '1px solid #1e293b', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
              ⚖️ Governance Workflow
            </div>
            <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: 2 }}>
              {recommendations.length} recommendation{recommendations.length !== 1 ? 's' : ''} · Human approval required
            </div>
          </div>
          {/* Status summary chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(statusCounts).map(([s, count]) => {
              const cfg = STATUS_CONFIG[s as RecStatus];
              return (
                <span key={s} style={{ fontSize: '0.62rem', color: cfg.color, background: cfg.bg, padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                  {count} {cfg.label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['ALL', 'NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED', 'ESCALATED', 'IMPLEMENTED'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                fontSize: '0.62rem', fontWeight: 600, padding: '2px 10px', borderRadius: 20, cursor: 'pointer', border: 'none',
                background: filterStatus === s
                  ? (s === 'ALL' ? '#6366f1' : STATUS_CONFIG[s]?.color || '#6366f1')
                  : '#0f172a',
                color: filterStatus === s ? '#fff' : '#475569',
              }}
            >
              {s === 'ALL' ? 'All' : STATUS_CONFIG[s]?.label}
              {s !== 'ALL' && statusCounts[s] ? ` (${statusCounts[s]})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Recommendation rows */}
      <div>
        {filtered.length === 0 && (
          <div style={{ padding: '2rem', color: '#475569', textAlign: 'center', fontSize: '0.8rem' }}>
            No recommendations match this filter.
          </div>
        )}
        {filtered.map((rec) => {
          const statusCfg = STATUS_CONFIG[rec.status] || STATUS_CONFIG.NEW;
          const actionColor = ACTION_COLOR[rec.ai_action] || '#64748b';
          const confPct = Math.min(100, (rec.confidence_score || rec.confidence || 0) > 1
            ? (rec.confidence_score || rec.confidence)
            : (rec.confidence_score || rec.confidence) * 100);
          const isAuditOpen = expandedAudit === rec.id;

          return (
            <div key={rec.id} style={{ borderBottom: '1px solid #0f172a' }}>
              {/* Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '1rem 1.5rem', gap: 12 }}>
                <div>
                  {/* Index + tags */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>{rec.index_name}</span>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: actionColor, background: `${actionColor}20`, padding: '1px 8px', borderRadius: 4 }}>
                      {rec.ai_action}
                    </span>
                    <StatusBadge status={rec.status} />
                    {rec.is_quick_win && (
                      <span style={{ fontSize: '0.62rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                        ⚡ Quick Win
                      </span>
                    )}
                    <span style={{ fontSize: '0.62rem', color: '#475569' }}>
                      {confPct.toFixed(0)}% confidence
                    </span>
                  </div>

                  {/* Recommendation text */}
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4, marginBottom: 4 }}>
                    {rec.recommendation}
                  </div>

                  {/* Reviewer info — shown when a human has acted */}
                  {rec.status !== 'NEW' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                      {rec.actor_email && (
                        <span style={{ fontSize: '0.62rem', color: '#475569' }}>
                          👤 {rec.actor_email}
                        </span>
                      )}
                      <span style={{ fontSize: '0.6rem', color: '#334155' }}>
                        🕐 {new Date(rec.updated_at).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {/* Note if exists */}
                  {rec.action_note && (
                    <div style={{ fontSize: '0.7rem', color: '#475569', fontStyle: 'italic', marginTop: 4, padding: '4px 8px', background: '#060f1e', borderRadius: 4, borderLeft: `2px solid ${statusCfg.color}60` }}>
                      "{rec.action_note}"
                    </div>
                  )}

                  {/* Audit toggle */}
                  <button
                    onClick={() => toggleAudit(rec.id)}
                    style={{ marginTop: 6, fontSize: '0.62rem', color: '#475569', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    {isAuditOpen ? '▲ Hide history' : '▼ View audit trail'}
                  </button>
                </div>

                {/* Action button */}
                <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
                  <button
                    onClick={() => setActiveModal(rec)}
                    style={{
                      padding: '0.45rem 1rem', borderRadius: 8, fontSize: '0.75rem', fontWeight: 700,
                      cursor: 'pointer', border: `1px solid ${statusCfg.color}40`,
                      background: statusCfg.bg, color: statusCfg.color, whiteSpace: 'nowrap',
                    }}
                  >
                    {rec.status === 'NEW' ? '⚖ Take Action' : '✏ Update'}
                  </button>
                </div>
              </div>

              {/* Audit trail expansion */}
              {isAuditOpen && (
                <div style={{ padding: '0.75rem 1.5rem 1rem', background: '#060f1e', borderTop: '1px solid #0f172a' }}>
                  <div style={{ fontSize: '0.65rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Audit Trail
                  </div>
                  <AuditTimeline entries={auditData[rec.id] || []} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {activeModal && (
        <ActionModal
          rec={activeModal}
          onClose={() => setActiveModal(null)}
          onSubmit={handleAction}
        />
      )}
    </div>
  );
}
