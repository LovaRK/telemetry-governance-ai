'use client';

import { useState } from 'react';

interface SectionExplainerProps {
  summary: string;
  dataInputs?: string[];
  decisionLogic?: string;
  defaultOpen?: boolean;
}

export default function SectionExplainer({
  summary,
  dataInputs = [],
  decisionLogic,
  defaultOpen = false,
}: SectionExplainerProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      marginBottom: '1rem', border: '1px solid #1e3a5f', borderRadius: 8,
      background: '#0a1628', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.625rem 1rem', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '0.8rem', color: '#38bdf8' }}>🤖</span>
        <span style={{ fontSize: '0.75rem', color: '#93c5fd', flex: 1 }}>
          How was this calculated?
        </span>
        <span style={{ fontSize: '0.65rem', color: '#475569' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 1rem 0.875rem', borderTop: '1px solid #1e293b' }}>
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.6 }}>
            {summary}
          </p>

          {dataInputs.length > 0 && (
            <div style={{ marginTop: '0.625rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#475569', marginBottom: '0.35rem' }}>
                Data inputs from Splunk:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {dataInputs.map((inp) => (
                  <code key={inp} style={{
                    padding: '0.1rem 0.5rem', background: '#1e293b', borderRadius: 4,
                    fontSize: '0.7rem', color: '#7dd3fc', fontFamily: 'monospace',
                  }}>
                    {inp}
                  </code>
                ))}
              </div>
            </div>
          )}

          {decisionLogic && (
            <div style={{
              marginTop: '0.625rem', padding: '0.5rem 0.75rem',
              background: '#111827', borderLeft: '2px solid #3b82f6',
              borderRadius: '0 4px 4px 0', fontSize: '0.75rem',
              color: '#cbd5e1', lineHeight: 1.55,
            }}>
              {decisionLogic}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
