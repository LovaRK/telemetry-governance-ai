'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api-client';

interface ExplainabilityContextType {
  enabled: boolean;
  loading: boolean;
  setEnabled: (next: boolean) => Promise<void>;
}

const ExplainabilityContext = createContext<ExplainabilityContextType | null>(null);

export function ExplainabilityProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch('/api/settings/explainability');
        if (!res.ok) return;
        const body = await res.json();
        if (alive) setEnabledState(Boolean(body?.data?.explainabilityMode ?? false));
      } catch {
        // Keep default false
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    setEnabledState(next);
    try {
      await apiFetch('/api/settings/explainability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ explainabilityMode: next }),
      });
    } catch {
      // optimistic UI: do not throw
    }
  }, []);

  const value = useMemo(() => ({ enabled, loading, setEnabled }), [enabled, loading, setEnabled]);

  return <ExplainabilityContext.Provider value={value}>{children}</ExplainabilityContext.Provider>;
}

export function useExplainability() {
  const ctx = useContext(ExplainabilityContext);
  if (!ctx) throw new Error('useExplainability must be used within ExplainabilityProvider');
  return ctx;
}
