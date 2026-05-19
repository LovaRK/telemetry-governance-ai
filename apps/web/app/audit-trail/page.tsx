'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuthGuard } from '../../lib/use-auth-guard';

interface AuditEvent {
  id: string;
  indexName: string;
  sourcetype: string | null;
  status: string;
  actorEmail: string | null;
  actionNote: string | null;
  updatedAt: string;
}

/**
 * Audit Trail Page — searchable log of governance decisions and actions
 *
 * Features:
 * - Search by index name or actor email
 * - Filter by status (APPROVED, REJECTED, DEFERRED, ESCALATED)
 * - Date range filtering
 * - Export to CSV
 * - Chronological display
 */
export default function AuditTrailPage() {
  useAuthGuard();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filteredEvents, setFilteredEvents] = useState<AuditEvent[]>([]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/governance/mutations?limit=500');
      if (!res.ok) throw new Error('Failed to fetch audit events');

      const json = await res.json();
      setEvents(json.mutations || []);
    } catch (e) {
      console.error('Audit trail fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Apply filters
  useEffect(() => {
    let filtered = [...events];

    // Search filter (index name or actor email)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        (e.indexName?.toLowerCase() || '').includes(query) ||
        (e.actorEmail?.toLowerCase() || '').includes(query) ||
        (e.actionNote?.toLowerCase() || '').includes(query)
      );
    }

    // Status filter
    if (statusFilter) {
      filtered = filtered.filter(e => e.status === statusFilter);
    }

    // Date range filter
    if (dateFrom) {
      const fromTime = new Date(dateFrom).getTime();
      filtered = filtered.filter(e => new Date(e.updatedAt).getTime() >= fromTime);
    }
    if (dateTo) {
      const toTime = new Date(dateTo).getTime();
      filtered = filtered.filter(e => new Date(e.updatedAt).getTime() <= toTime);
    }

    // Sort by date descending (most recent first)
    filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    setFilteredEvents(filtered);
  }, [events, searchQuery, statusFilter, dateFrom, dateTo]);

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Index', 'Sourcetype', 'Status', 'Actor', 'Notes'];
    const rows = filteredEvents.map(e => [
      new Date(e.updatedAt).toLocaleString(),
      e.indexName,
      e.sourcetype || '—',
      e.status,
      e.actorEmail || 'System',
      e.actionNote || '—',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColors: Record<string, string> = {
    APPROVED: '#22c55e',
    REJECTED: '#ef4444',
    DEFERRED: '#8b5cf6',
    ESCALATED: '#f97316',
    PENDING: '#f59e0b',
    UNDER_REVIEW: '#3b82f6',
  };

  const statusIcons: Record<string, string> = {
    APPROVED: '✓',
    REJECTED: '✕',
    DEFERRED: '⏸',
    ESCALATED: '⬆',
    PENDING: '⏳',
    UNDER_REVIEW: '👁',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#050a14', padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ maxWidth: 1200, margin: '0 auto', marginBottom: '2rem' }}>
        <Link href="/" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '0.8rem', marginBottom: '1rem', display: 'inline-block' }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.5rem' }}>
          📋 Governance Audit Trail
        </h1>
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
          Complete history of all governance decisions, approvals, and actions
        </p>
      </div>

      {/* Filters */}
      <div style={{ maxWidth: 1200, margin: '0 auto', marginBottom: '1.5rem' }}>
        <div style={{
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: 10,
          padding: '1.25rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}>
          {/* Search */}
          <input
            type="text"
            placeholder="Search by index, actor, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              padding: '0.75rem',
              background: '#0a0f1a',
              border: '1px solid #1e293b',
              borderRadius: 6,
              color: '#f8fafc',
              fontSize: '0.85rem',
              gridColumn: 'span 2',
            }}
          />

          {/* Status Filter */}
          <select
            value={statusFilter || ''}
            onChange={(e) => setStatusFilter(e.target.value || null)}
            style={{
              padding: '0.75rem',
              background: '#0a0f1a',
              border: '1px solid #1e293b',
              borderRadius: 6,
              color: '#f8fafc',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <option value="">All Statuses</option>
            <option value="APPROVED">✓ Approved</option>
            <option value="REJECTED">✕ Rejected</option>
            <option value="DEFERRED">⏸ Deferred</option>
            <option value="ESCALATED">⬆ Escalated</option>
            <option value="PENDING">⏳ Pending</option>
            <option value="UNDER_REVIEW">👁 Under Review</option>
          </select>

          {/* Date From */}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              padding: '0.75rem',
              background: '#0a0f1a',
              border: '1px solid #1e293b',
              borderRadius: 6,
              color: '#f8fafc',
              fontSize: '0.85rem',
            }}
          />

          {/* Date To */}
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              padding: '0.75rem',
              background: '#0a0f1a',
              border: '1px solid #1e293b',
              borderRadius: 6,
              color: '#f8fafc',
              fontSize: '0.85rem',
            }}
          />

          {/* Export Button */}
          <button
            onClick={exportToCSV}
            disabled={filteredEvents.length === 0}
            style={{
              padding: '0.75rem',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 600,
              opacity: filteredEvents.length === 0 ? 0.5 : 1,
            }}
          >
            ↓ Export CSV ({filteredEvents.length})
          </button>
        </div>
      </div>

      {/* Events Table */}
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
            Loading audit trail...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
            No events found matching your filters
          </div>
        ) : (
          <div style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* Events List */}
            <div style={{ display: 'grid', gap: '0.75rem', padding: '1rem' }}>
              {filteredEvents.map(event => {
                const color = statusColors[event.status] || '#64748b';
                return (
                  <div
                    key={event.id}
                    style={{
                      padding: '0.75rem',
                      background: `${color}10`,
                      border: `1px solid ${color}40`,
                      borderRadius: 6,
                      fontSize: '0.8rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                      <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{event.indexName}</div>
                      <span style={{ color, fontWeight: 700 }}>{statusIcons[event.status] || '•'}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', color: '#94a3b8', fontSize: '0.75rem' }}>
                      <div>📅 {new Date(event.updatedAt).toLocaleString()}</div>
                      <div>👤 {event.actorEmail || 'System'}</div>
                      <div>📂 {event.sourcetype || '—'}</div>
                      <div style={{ color }}>{event.status}</div>
                    </div>
                    {event.actionNote && (
                      <div style={{ marginTop: '0.4rem', padding: '0.3rem 0.4rem', background: '#0a0f1a', borderRadius: 3, color: '#64748b', fontSize: '0.7rem' }}>
                        {event.actionNote}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
