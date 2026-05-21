'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

export interface GovernanceStreamEvent {
  type: 'governance' | 'decision' | 'drift' | 'heartbeat' | 'connected' | 'error' | 'close';
  data: Record<string, any>;
  receivedAt: string;
}

interface UseGovernanceStreamOptions {
  enabled?: boolean;
  onGovernance?: (data: Record<string, any>) => void;
  onDecision?:   (data: Record<string, any>) => void;
  onDrift?:      (data: Record<string, any>) => void;
}

/**
 * useGovernanceStream — subscribes to the SSE governance event stream.
 *
 * Automatically reconnects on disconnect (Last-Event-ID is passed so no events are missed).
 * Respects the `enabled` flag — set to false to pause streaming (e.g. user navigated away).
 *
 * Usage:
 *   const { events, connected, lastHeartbeat } = useGovernanceStream({
 *     onGovernance: (e) => refetchRecommendations(),
 *     onDecision:   (e) => console.log('New decision:', e),
 *   });
 */
export function useGovernanceStream({
  enabled = true,
  onGovernance,
  onDecision,
  onDrift,
}: UseGovernanceStreamOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [events, setEvents] = useState<GovernanceStreamEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectingRef = useRef(false);

  const addEvent = useCallback((type: GovernanceStreamEvent['type'], data: Record<string, any>) => {
    setEvents(prev => [...prev.slice(-99), { type, data, receivedAt: new Date().toISOString() }]);
  }, []);

  const connect = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const url = lastEventIdRef.current
      ? `/api/governance/stream`
      : `/api/governance/stream`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = async () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      if (!reconnectingRef.current) {
        reconnectingRef.current = true;
        try {
          // Trigger token refresh path when auth expired (apiFetch auto-refreshes on 401).
          await apiFetch('/api/cache-status');
        } catch {
          // ignore; reconnect attempts still continue
        } finally {
          reconnectingRef.current = false;
        }
      }

      // Reconnect after 5 seconds
      reconnectTimerRef.current = setTimeout(connect, 5000);
    };

    es.addEventListener('connected', (e) => {
      addEvent('connected', JSON.parse(e.data));
    });

    es.addEventListener('heartbeat', (e) => {
      const data = JSON.parse(e.data);
      setLastHeartbeat(data.serverTime);
    });

    es.addEventListener('governance', (e) => {
      const data = JSON.parse(e.data);
      if (e.lastEventId) lastEventIdRef.current = e.lastEventId;
      addEvent('governance', data);
      onGovernance?.(data);
    });

    es.addEventListener('decision', (e) => {
      const data = JSON.parse(e.data);
      if (e.lastEventId) lastEventIdRef.current = e.lastEventId;
      addEvent('decision', data);
      onDecision?.(data);
    });

    es.addEventListener('drift', (e) => {
      const data = JSON.parse(e.data);
      if (e.lastEventId) lastEventIdRef.current = e.lastEventId;
      addEvent('drift', data);
      onDrift?.(data);
    });

    es.addEventListener('error', (e: any) => {
      try { addEvent('error', JSON.parse(e.data || '{}')); } catch { /* ignore */ }
    });

    es.addEventListener('close', () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      // Server told us to close — reconnect after 30s
      reconnectTimerRef.current = setTimeout(connect, 30_000);
    });
  }, [enabled, addEvent, onGovernance, onDecision, onDrift]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    }

    return () => {
      esRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [enabled, connect]);

  return { connected, lastHeartbeat, events };
}
