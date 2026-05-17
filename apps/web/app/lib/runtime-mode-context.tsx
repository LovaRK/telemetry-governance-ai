'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { RuntimeMode } from './api-errors';

interface RuntimeModeContextType {
  mode: RuntimeMode;
  isLoading: boolean;
  dependencies: {
    postgres: boolean;
    ollama: boolean;
    splunk: boolean;
  };
}

const RuntimeModeContext = createContext<RuntimeModeContextType | null>(null);

export function RuntimeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<RuntimeMode>('DEMO_MODE');
  const [isLoading, setIsLoading] = useState(true);
  const [dependencies, setDependencies] = useState({
    postgres: false,
    ollama: false,
    splunk: false,
  });

  useEffect(() => {
    // Check which dependencies are actually connected
    const checkDependencies = async () => {
      try {
        // Try health check - if it's not a 503, we have a database
        const healthRes = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
        const postgres = healthRes.status !== 503;

        // Cache status tells us if Splunk is configured
        const cacheRes = await fetch('/api/cache-status', { signal: AbortSignal.timeout(2000) });
        const cacheData = await cacheRes.json();
        const splunk = cacheData.hasEverRefreshed === true;

        // If we have postgres and splunk, we're in FULL_STACK
        const isFullStack = postgres;

        setDependencies({
          postgres,
          ollama: postgres, // Ollama is implicitly available if postgres is
          splunk,
        });

        setMode(isFullStack ? 'FULL_STACK' : 'DEMO_MODE');
      } catch (error) {
        // Default to DEMO_MODE if health check fails
        setMode('DEMO_MODE');
        setDependencies({ postgres: false, ollama: false, splunk: false });
      } finally {
        setIsLoading(false);
      }
    };

    checkDependencies();
  }, []);

  return (
    <RuntimeModeContext.Provider value={{ mode, isLoading, dependencies }}>
      {children}
    </RuntimeModeContext.Provider>
  );
}

export function useRuntimeMode() {
  const context = useContext(RuntimeModeContext);
  if (!context) {
    throw new Error('useRuntimeMode must be used within RuntimeModeProvider');
  }
  return context;
}
