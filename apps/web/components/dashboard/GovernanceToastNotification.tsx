'use client';

import React, { useCallback } from 'react';
import { useToast, Toast } from '../../lib/toast-context';

interface ToastManagerProps {
  maxVisible?: number; // default 3
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

/**
 * GovernanceToastNotification — displays SSE event notifications
 *
 * Shows governance approvals, rejections, decisions, and drift alerts.
 * Auto-dismisses after 5s, but user can dismiss manually.
 * Max 3 visible toasts at once.
 */
export function GovernanceToastNotification({
  maxVisible = 3,
  position = 'top-right',
}: ToastManagerProps) {
  const { toasts, dismissToast } = useToast();

  // Only show max N toasts (most recent)
  const visibleToasts = toasts.slice(-maxVisible);

  // Position styles
  const positionStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 50,
    ...(position === 'top-right' && { top: 20, right: 20 }),
    ...(position === 'top-left' && { top: 20, left: 20 }),
    ...(position === 'bottom-right' && { bottom: 20, right: 20 }),
    ...(position === 'bottom-left' && { bottom: 20, left: 20 }),
  };

  return (
    <div style={positionStyle}>
      {visibleToasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: () => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const severityColors: Record<string, { bg: string; border: string; icon: string; title: string }> = {
    critical: { bg: '#ef444410', border: '#ef444440', icon: '🔴', title: '#ef4444' },
    warning: { bg: '#f59e0b10', border: '#f59e0b40', icon: '🟡', title: '#f59e0b' },
    info: { bg: '#3b82f610', border: '#3b82f640', icon: '🔵', title: '#3b82f6' },
    success: { bg: '#22c55e10', border: '#22c55e40', icon: '✅', title: '#22c55e' },
  };

  const colors = severityColors[toast.severity] || severityColors.info;

  // Type-based icons
  const typeIcons: Record<string, string> = {
    governance: '📋',
    decision: '🤖',
    drift: '📊',
    error: '⚠️',
  };

  const typeIcon = typeIcons[toast.type] || '📌';

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 12,
        minWidth: 300,
        maxWidth: 400,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        animation: 'slideIn 0.3s ease-out',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: '1.2em' }}>{typeIcon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: colors.title, marginBottom: 4 }}>
            {toast.title}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {toast.message}
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '1.2rem',
            padding: 0,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Hook to create toast notifications from SSE events
 *
 * Usage in a component:
 *   const toastManager = useGovernanceToastManager();
 *   // Subscribe to SSE events
 *   const { ... } = useGovernanceStream({
 *     onGovernance: (e) => {
 *       toastManager.onGovernanceEvent(e);
 *     },
 *   });
 */
export function useGovernanceToastManager() {
  const { addToast } = useToast();

  const onGovernanceEvent = useCallback((event: any) => {
    const status = event.status || event.mutationType || 'UPDATED';
    const isApproved = status === 'APPROVED';
    const isRejected = status === 'REJECTED';

    const severity = isApproved ? 'success' : isRejected ? 'critical' : 'warning';
    const action = isApproved ? '✓ Approved' : isRejected ? '✗ Rejected' : `${status}`;

    addToast({
      type: 'governance',
      severity,
      title: `Governance: ${action}`,
      message: `${event.indexName || 'Unknown'} · ${event.actorEmail || 'System'} ${event.note || ''}`.slice(0, 100),
      duration: 5000,
    });
  }, [addToast]);

  const onDecisionEvent = useCallback((event: any) => {
    const tier = event.tier || 'UNKNOWN';
    const action = event.action || 'ANALYZED';

    addToast({
      type: 'decision',
      severity: 'info',
      title: `Decision: ${action}`,
      message: `${event.indexName || 'Unknown'} · Tier: ${tier} · Score: ${(event.compositeScore * 100).toFixed(0)}%`,
      duration: 4000,
    });
  }, [addToast]);

  const onDriftEvent = useCallback((event: any) => {
    const severity = event.driftSeverity === 'SEVERE' ? 'critical' : event.driftSeverity === 'DEGRADED' ? 'warning' : 'info';

    addToast({
      type: 'drift',
      severity,
      title: `Cache Drift: ${event.driftSeverity || 'DETECTED'}`,
      message: `${event.indexName || 'Unknown'} · Coherence: ${(event.coherenceScore * 100).toFixed(0)}%`,
      duration: 6000,
    });
  }, [addToast]);

  const onError = useCallback((message: string) => {
    addToast({
      type: 'error',
      severity: 'critical',
      title: 'Error',
      message,
      duration: 7000,
    });
  }, [addToast]);

  return {
    onGovernanceEvent,
    onDecisionEvent,
    onDriftEvent,
    onError,
  };
}
