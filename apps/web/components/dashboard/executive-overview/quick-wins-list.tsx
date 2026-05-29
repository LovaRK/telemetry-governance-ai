'use client';

/**
 * QuickWinsList — one-click governance approval panel.
 * Pure visualization with action callbacks — no direct API calls (moved to parent).
 */

import React, { useState } from 'react';
import { fmt$, ACTION_COLORS } from './utils';

interface QuickWin {
  indexName: string;
  action: string;
  savings: number;
  tier?: string;
  reasoning?: string;
}

interface QuickWinsListProps {
  wins: QuickWin[];
  avgConfidencePct?: number;
  onApprove: (win: QuickWin) => Promise<void>;
  onOpenDrawer?: (win: QuickWin) => void;
}

export function QuickWinsList({
  wins,
  avgConfidencePct = 0,
  onApprove,
  onOpenDrawer,
}: QuickWinsListProps) {
  const [approvedWins, setApprovedWins] = useState<Set<string>>(new Set());
  const [approvingWin, setApprovingWin] = useState<string | null>(null);

  const approveWin = async (qw: QuickWin) => {
    const key = `${qw.indexName}::${qw.action}`;
    if (approvedWins.has(key) || approvingWin === key) return;

    setApprovingWin(key);
    try {
      await onApprove(qw);
      setApprovedWins(prev => {
        const next = new Set(Array.from(prev));
        next.add(key);
        return next;
      });
    } catch {
      // Caller handles error
    } finally {
      setApprovingWin(null);
    }
  };

  const approveAll = async () => {
    const pending = wins.filter(qw => !approvedWins.has(`${qw.indexName}::${qw.action}`));
    for (const qw of pending) {
      await approveWin(qw);
    }
  };

  const cardTitle: React.CSSProperties = {
    fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 0, fontWeight: 600
  };

  return (
    <div style={{
      padding: '1.5rem', background: '#0f172a', borderRadius: 12,
      border: '1px solid #1e293b', position: 'relative'
    }}>
      <div style={{
        position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
        backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
        borderRadius: '12px', fontWeight: 500
      }}>🤖 AI</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={cardTitle}>Quick Wins</div>
        {wins.length > 1 && approvedWins.size < wins.length && (
          <button
            onClick={approveAll}
            style={{
              padding: '0.25rem 0.7rem', background: '#22c55e20', color: '#22c55e',
              border: '1px solid #22c55e40', borderRadius: 5, fontSize: '0.65rem',
              fontWeight: 700, cursor: 'pointer'
            }}
          >
            ✓ Approve All
          </button>
        )}
      </div>

      {wins.length === 0 ? (
        <div style={{ color: '#475569', fontSize: '0.875rem' }}>No quick wins identified</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {wins.map((qw, i) => {
            const key = `${qw.indexName}::${qw.action}`;
            const approved = approvedWins.has(key);
            const approving = approvingWin === key;
            const color = ACTION_COLORS[qw.action] || '#3b82f6';

            return (
              <div
                key={i}
                style={{
                  background: '#0f172a', borderRadius: 6, padding: '0.6rem 0.75rem',
                  border: `1px solid ${approved ? '#22c55e40' : '#1e293b'}`,
                  transition: 'border-color 0.3s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: onOpenDrawer ? 'pointer' : 'default' }}
                    onClick={() => onOpenDrawer?.(qw)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569' }}>#{i + 1}</span>
                      <span style={{
                        fontSize: '0.8rem', fontWeight: 600, color: '#f8fafc',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                      }}>
                        {qw.indexName}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        padding: '0.1rem 0.35rem', borderRadius: 3, fontSize: '0.62rem',
                        background: `${color}20`, color, fontWeight: 600
                      }}>
                        {qw.action}
                      </span>
                      {qw.tier && (
                        <span style={{ fontSize: '0.62rem', color: '#475569' }}>{qw.tier}</span>
                      )}
                      <span style={{
                        fontSize: '0.75rem', color: '#22c55e', fontWeight: 700, marginLeft: 'auto'
                      }}>
                        {qw.savings > 0 ? fmt$(qw.savings) : '—'}
                      </span>
                    </div>
                    {qw.reasoning && (
                      <div style={{
                        fontSize: '0.65rem', color: '#475569', marginTop: 4,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                      }}>
                        {qw.reasoning.slice(0, 90)}{qw.reasoning.length > 90 ? '…' : ''}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => approveWin(qw)}
                    disabled={approved || approving}
                    style={{
                      flexShrink: 0, padding: '0.3rem 0.65rem', borderRadius: 5,
                      fontSize: '0.68rem', fontWeight: 700,
                      cursor: approved ? 'default' : 'pointer', border: 'none',
                      background: approved ? '#22c55e20' : approving ? '#1e293b' : '#22c55e',
                      color: approved ? '#22c55e' : approving ? '#64748b' : '#0f172a',
                      transition: 'all 0.2s', letterSpacing: '0.02em',
                    }}
                  >
                    {approved ? '✓ Approved' : approving ? '…' : '✓ Approve'}
                  </button>
                </div>
              </div>
            );
          })}

          {approvedWins.size > 0 && (
            <div style={{ fontSize: '0.7rem', color: '#22c55e', textAlign: 'center', marginTop: 2 }}>
              {approvedWins.size} quick win{approvedWins.size > 1 ? 's' : ''} approved this session
            </div>
          )}
        </div>
      )}
    </div>
  );
}
