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

const INITIAL_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 8;

/**
 * useGovernanceStream — subscribes to the SSE governance event stream.
 *
 * Automatically reconnects on disconnect with exponential backoff (STREAM-001).
 * Stops reconnecting after MAX_RECONNECT_ATTEMPTS or if auth is blocked (STREAM-002).
 * No unhandled promise rejections (STREAM-003).
 *
 * EventSource uses cookie auth for same-origin (STREAM-004: no-cors limits headers).
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
  const attemptRef = useRef(0);
  const authBlockedRef = useRef(false);
  const unmountedRef = useRef(false);

  const addEvent = useCallback((type: GovernanceStreamEvent['type'], data: Record<string, any>) => {
    setEvents(prev => [...prev.slice(-99), { type, data, receivedAt: new Date().toISOString() }]);
  }, []);

  const scheduleReconnect = useCallback((connectFn: () => void) => {
    if (authBlockedRef.current || unmountedRef.current) return;
    if (attemptRef.current >= MAX_RECONNECT_ATTEMPTS) return;

    const delay = Math.min(
      INITIAL_RECONNECT_MS * Math.pow(2, attemptRef.current),
      MAX_RECONNECT_MS
    );
    // Add jitter: ±25%
    const jittered = delay * (0.75 + Math.random() * 0.5);
    attemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(connectFn, jittered);
  }, []);

  const probeAuth = useCallback(async (): Promise<boolean> => {
    try {
      const probe = await apiFetch('/api/cache-status');
      if (probe.status === 401) {
        authBlockedRef.current = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || typeof window === 'undefined' || unmountedRef.current) return;
    if (authBlockedRef.current) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const es = new EventSource('/api/governance/stream');
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      attemptRef.current = 0;
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      // Probe auth independently of reconnection state (STREAM-002 fix)
      probeAuth().then((blocked) => {
        if (!blocked) scheduleReconnect(connect);
      });
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
      scheduleReconnect(connect);
    });
  }, [enabled, addEvent, onGovernance, onDecision, onDrift, scheduleReconnect, probeAuth]);

  useEffect(() => {
    unmountedRef.current = false;
    if (enabled) {
      connect();
    } else {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    }

    return () => {
      unmountedRef.current = true;
      esRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [enabled, connect]);

  return { connected, lastHeartbeat, events };
}
