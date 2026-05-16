'use client';

import React, { useState } from 'react';

interface SectionExplainerProps {
  title: string;
  summary: string;
  dataInputs?: string[];
  decisionLogic?: string;
  isCollapsed?: boolean;
}

export default function SectionExplainer({
  title,
  summary,
  dataInputs = [],
  decisionLogic,
  isCollapsed = true,
}: SectionExplainerProps) {
  const [expanded, setExpanded] = useState(!isCollapsed);

  return (
    <div
      style={{
        marginBottom: '24px',
        padding: '16px',
        backgroundColor: 'rgba(6, 182, 212, 0.05)',
        border: '1px solid rgba(6, 182, 212, 0.2)',
        borderRadius: '8px',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          color: '#06b6d4',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: '100%',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            transition: 'transform 0.2s ease',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: '12px',
          }}
        >
          ▶
        </span>
        <span style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {expanded ? '▼' : '▶'} How {title} is Calculated
        </span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: '12px',
            paddingTop: '12px',
            borderTop: '1px solid rgba(6, 182, 212, 0.15)',
          }}
        >
          {/* Summary */}
          <p
            style={{
              margin: '0 0 16px 0',
              fontSize: '13px',
              color: '#cbd5e1',
              lineHeight: '1.6',
            }}
          >
            {summary}
          </p>

          {/* Data Inputs */}
          {dataInputs.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h4
                style={{
                  margin: '0 0 8px 0',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Data Inputs
              </h4>
              <ul
                style={{
                  margin: 0,
                  padding: '0 0 0 20px',
                  listStyle: 'disc',
                }}
              >
                {dataInputs.map((input, idx) => (
                  <li
                    key={idx}
                    style={{
                      fontSize: '12px',
                      color: '#cbd5e1',
                      marginBottom: '4px',
                    }}
                  >
                    <code
                      style={{
                        backgroundColor: 'rgba(15, 23, 42, 0.8)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontFamily: 'monospace',
                        fontSize: '11px',
                      }}
                    >
                      {input}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decision Logic */}
          {decisionLogic && (
            <div>
              <h4
                style={{
                  margin: '0 0 8px 0',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#94a3b8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Decision Logic
              </h4>
              <div
                style={{
                  padding: '8px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(51, 65, 85, 0.3)',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#cbd5e1',
                  lineHeight: '1.5',
                }}
              >
                {decisionLogic}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
