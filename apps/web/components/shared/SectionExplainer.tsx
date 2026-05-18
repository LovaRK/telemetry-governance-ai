'use client';

import React, { useState } from 'react';

interface SectionExplainerProps {
  title: string;           // e.g. "ROI Score Calculation"
  summary: string;         // 1-2 sentences plain English
  dataInputs: string[];    // e.g. ["dailyAvgGb", "retentionDays", "lastEvent"]
  decisionLogic: string;   // What the LLM was asked to decide
  isCollapsed?: boolean;   // Default: true (collapsed by default)
}

export default function SectionExplainer({
  title,
  summary,
  dataInputs,
  decisionLogic,
  isCollapsed = true,
}: SectionExplainerProps) {
  const [expanded, setExpanded] = useState(!isCollapsed);

  return (
    <div
      style={{
        marginBottom: '1.5rem',
        padding: '1rem',
        background: '#1e3a5f20',
        border: '1px solid #3b82f640',
        borderRadius: 8,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: '#3b82f6',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '0.25rem',
            }}
          >
            ℹ️ How This Works
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#cbd5e1' }}>
            {title}
          </div>
        </div>
        <div
          style={{
            fontSize: '1.2rem',
            color: '#64748b',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            flexShrink: 0,
          }}
        >
          ▾
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #3b82f640' }}>
          {/* Summary */}
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.6 }}>
              {summary}
            </p>
          </div>

          {/* Data Inputs */}
          {dataInputs.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Data Inputs to LLM
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                {dataInputs.map((input, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.5rem',
                      background: '#3b82f620',
                      color: '#3b82f6',
                      borderRadius: 4,
                      fontFamily: 'monospace',
                    }}
                  >
                    {input}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Decision Logic */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Decision Logic
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1', lineHeight: 1.6 }}>
              {decisionLogic}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
