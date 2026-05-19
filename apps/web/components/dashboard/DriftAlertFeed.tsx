'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api-client';

interface DriftEvent {
  id: string;
  indexName: string;
  driftSeverity: string;
  coherenceScore: number;
  timestamp: string;
}

interface GovernanceEvent {
  id: string;
  indexName: string;
  sourcetype?: string;
  status: string;
  actorEmail?: string;
  note?: string;
  timestamp: string;
}

interface AlertItem {
  id: string;
  kind: 'drift' | 'governance' | 'decision';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  subtitle: string;
  timestamp: string;
  dismissed?: boolean;
}

const SEVERITY_STYLE: Record<string, { bg: string; border: string; dot: string; icon: string }> = {
  critical: { bg: '#ef444410', border: '#ef444440', dot: '#ef4444', icon: '🔴' },
  warning:  { bg: '#f59e0b10', border: '#f59e0b40', dot: '#f59e0b', icon: '🟡' },
  info:     { bg: '#3b82f610', border: '#3b82f640', dot: '#3b82f6', icon: '🔵' },
};

function driftSeverityToAlert(s: string): 'critical' | 'warning' | 'info' {
  if (s === 'SEVERE' || s === 'critical') return 'critical';
  if (s === 'DEGRADED' || s === 'STALE') return 'warning';
  return 'info';
}

function govStatusToSeverity(status: string): 'critical' | 'warning' | 'info' {
  if (status === 'REJECTED') return 'critical';
  if (status === 'PENDING' || status === 'UNDER_REVIEW') return 'warning';
  return 'info';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DriftAlertFeed() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const loadAlerts = useCallback(async () => {
    try {
      const items: AlertItem[] = [];

      // 1. Drift events
      const driftRes = await apiFetch('/api/governance/cache-coherence');
      if (driftRes.ok) {
        const driftData = await driftRes.json();
        const records: DriftEvent[] = (driftData.records || []).slice(0, 10);
        for (const r of records) {
          if (r.driftSeverity && r.driftSeverity !== 'NOMINAL') {
            items.push({
              id: `drift-${r.id}`,
              kind: 'drift',
              severity: driftSeverityToAlert(r.driftSeverity),
              title: `Cache drift detected — ${r.indexName}`,
              subtitle: `Severity: ${r.driftSeverity} · Coherence: ${(r.coherenceScore * 100).toFixed(0)}%`,
              timestamp: r.timestamp,
            });
          }
        }
      }

      // 2. Recent governance events from stream (via mutation journal)
      const mutRes = await apiFetch('/api/governance/mutations?limit=10');
      if (mutRes.ok) {
        const mutData = await mutRes.json();
        const mutations = mutData.mutations || mutData.data || [];
        for (const m of mutations.slice(0, 8)) {
          items.push({
            id: `gov-${m.id || m.idempotencyKey || Math.random()}`,
            kind: 'governance',
            severity: govStatusToSeverity(m.mutationType || m.status || ''),
            title: `Governance: ${m.mutationType || m.action || 'UPDATE'} — ${m.indexName || 'unknown'}`,
            subtitle: `${m.actorEmail || 'System'} · ${m.actionNote || m.note || ''}`.slice(0, 80),
            timestamp: m.recordedAt || m.createdAt || m.updatedAt || new Date().toISOString(),
          });
        }
      }

      // Sort by timestamp descending
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAlerts(items.slice(0, 20));
    } catch (e) {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 15_000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  const dismiss = (id: string) => setDismissed(prev => { const n = new Set(Array.from(prev)); n.add(id); return n; });
  const dismissAll = () => setDismissed(new Set(alerts.map(a => a.id)));

  const visible = alerts.filter(a => !dismissed.has(a.id));
  const criticalCount = visible.filter(a => a.severity === 'critical').length;

  return (
    <div style={{ background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', padding: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>Alert Feed</span>
          {criticalCount > 0 && (
            <span style={{ padding: '0.1rem 0.5rem', borderRadius: 10, background: '#ef444420', color: '#ef4444', fontSize: '0.68rem', fontWeight: 700 }}>
              {criticalCount} critical
            </span>
          )}
          {loading && <span style={{ fontSize: '0.65rem', color: '#475569' }}>updating…</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={loadAlerts} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}>↻</button>
          {visible.length > 0 && (
            <button onClick={dismissAll} style={{ background: 'none', border: '1px solid #1e293b', borderRadius: 4, color: '#475569', cursor: 'pointer', fontSize: '0.68rem', padding: '0.2rem 0.5rem' }}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: '#334155', fontSize: '0.8rem' }}>
          {loading ? 'Loading alerts…' : '✓ No active alerts'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 320, overflowY: 'auto' }}>
          {visible.map(alert => {
            const s = SEVERITY_STYLE[alert.severity];
            return (
              <div key={alert.id} style={{ display: 'flex', gap: 10, padding: '0.6rem 0.75rem', background: s.bg, borderRadius: 6, border: `1px solid ${s.border}`, alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0, fontSize: '0.75rem', marginTop: 1 }}>{s.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.title}</div>
                  {alert.subtitle && (
                    <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{alert.subtitle}</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: '0.62rem', color: '#475569', whiteSpace: 'nowrap' }}>{timeAgo(alert.timestamp)}</span>
                  <button onClick={() => dismiss(alert.id)} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: '0.65rem', padding: 0 }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
