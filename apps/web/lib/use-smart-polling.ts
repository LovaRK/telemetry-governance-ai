import { useEffect, useRef } from 'react';

/**
 * Smart polling hook for demo-safe, production-aware polling.
 *
 * Behavior:
 * - RUNNING/PARTIAL: Poll every 3 seconds (aggressive)
 * - READY/FAILED/IDLE: Poll every 60 seconds (idle)
 * - document.hidden: Pause polling entirely
 * - Tab visibility restore: Resume polling with correct interval
 * - AbortController: Cancel previous pending requests before new poll
 *
 * @param callback - Async function to call on each poll. Can receive AbortSignal for cancellation.
 * @param pipelineStatus - Current pipeline status (RUNNING | PARTIAL | READY | FAILED | IDLE)
 * @param enabled - Optional flag to enable/disable polling
 */
export function useSmartPolling(
  callback: (signal?: AbortSignal) => Promise<void>,
  pipelineStatus: string | null | undefined,
  enabled: boolean = true
) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastStatusRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Determine polling interval based on pipeline status
  const getPollInterval = (status: string | null | undefined): number | null => {
    if (!status) return null;

    const isActive = status === 'RUNNING' || status === 'PARTIAL';
    if (isActive) return 3000; // 3 seconds while active

    const isIdle = status === 'READY' || status === 'FAILED' || status === 'IDLE';
    if (isIdle) return 60000; // 60 seconds while idle

    return null; // Unknown status, don't poll
  };

  // Restart polling when status or visibility changes
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const isHidden = document.hidden;
    const interval = getPollInterval(pipelineStatus);

    // Stop polling if tab is hidden
    if (isHidden) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Stop polling if interval is null (unknown status)
    if (interval === null) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Clear existing interval if status changed
    if (lastStatusRef.current !== pipelineStatus) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      lastStatusRef.current = pipelineStatus || null;
    }

    // Start polling with appropriate interval
    const poll = async () => {
      try {
        // Abort previous request before starting new one
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();
        await callback(abortControllerRef.current.signal);
      } catch (err) {
        // Silently ignore polling errors and AbortError (same as current behavior)
        if (err instanceof Error && err.name !== 'AbortError') {
          // Log non-abort errors if needed in the future
        }
      }
    };

    intervalRef.current = setInterval(poll, interval);

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, pipelineStatus, callback]);

  // Monitor tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      // If tab becomes hidden, clear interval and abort pending requests
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        return;
      }

      // If tab becomes visible, restart polling with current status
      if (enabled && pipelineStatus) {
        const interval = getPollInterval(pipelineStatus);
        if (interval && !intervalRef.current) {
          const poll = async () => {
            try {
              // Abort previous request before starting new one
              if (abortControllerRef.current) {
                abortControllerRef.current.abort();
              }
              abortControllerRef.current = new AbortController();
              await callback(abortControllerRef.current.signal);
            } catch (err) {
              // Silently ignore polling errors and AbortError
              if (err instanceof Error && err.name !== 'AbortError') {
                // Log non-abort errors if needed in the future
              }
            }
          };
          intervalRef.current = setInterval(poll, interval);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, pipelineStatus, callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);
}
