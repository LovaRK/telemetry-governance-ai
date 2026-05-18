'use client';

import { useEffect, useState } from 'react';

interface JobProgress {
  batch?: number;
  totalBatches?: number;
  decisionsWritten?: number;
  message?: string;
}

interface JobStatusToastProps {
  jobId: string;
  onComplete?: () => void;
}

type JobStatus = 'pending' | 'running' | 'partial' | 'complete' | 'failed' | 'not_found' | 'error';

export default function JobStatusToast({ jobId, onComplete }: JobStatusToastProps) {
  const [status, setStatus] = useState<JobStatus>('pending');
  const [progress, setProgress] = useState<JobProgress>({});
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!jobId) return;

    const url = `/api/job-stream?jobId=${encodeURIComponent(jobId)}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setStatus(data.status);
        if (data.progress) setProgress(data.progress);
        if (data.status === 'complete') {
          es.close();
          onComplete?.();
          setTimeout(() => setDismissed(true), 4000);
        }
        if (data.status === 'failed' || data.status === 'not_found') {
          es.close();
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
    };

    return () => es.close();
  }, [jobId, onComplete]);

  if (dismissed) return null;

  const label = () => {
    if (status === 'pending') return 'AI analysis queued...';
    if (status === 'running' || status === 'partial') {
      const { batch, totalBatches, decisionsWritten } = progress;
      if (batch && totalBatches) {
        return `AI analyzing: batch ${batch}/${totalBatches} — ${decisionsWritten ?? 0} decisions written`;
      }
      return progress.message || 'AI analyzing...';
    }
    if (status === 'complete') return `AI decisions ready (${progress.decisionsWritten ?? 0} decisions)`;
    if (status === 'failed') return 'AI analysis failed. Raw data still available.';
    return 'AI analysis queued...';
  };

  const colors = {
    pending: 'bg-blue-900/90 border-blue-700 text-blue-100',
    running: 'bg-indigo-900/90 border-indigo-700 text-indigo-100',
    partial: 'bg-indigo-900/90 border-indigo-700 text-indigo-100',
    complete: 'bg-green-900/90 border-green-700 text-green-100',
    failed: 'bg-red-900/90 border-red-700 text-red-100',
    not_found: 'bg-gray-900/90 border-gray-700 text-gray-100',
    error: 'bg-red-900/90 border-red-700 text-red-100',
  };

  const icon = {
    pending: '📊',
    running: '🧠',
    partial: '🧠',
    complete: '✅',
    failed: '⚠️',
    not_found: '❓',
    error: '⚠️',
  };

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg max-w-sm transition-all ${colors[status]}`}
    >
      <span className="text-lg">{icon[status]}</span>
      <span className="text-sm font-medium">{label()}</span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-auto text-current opacity-60 hover:opacity-100 text-xs"
      >
        ✕
      </button>
    </div>
  );
}
