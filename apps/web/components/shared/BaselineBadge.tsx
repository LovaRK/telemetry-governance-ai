'use client';

import React, { useState } from 'react';

interface BaselineBadgeProps {
  title: string; // "MITRE" or "Lantern"
  onLearnMore?: () => void;
}

export default function BaselineBadge({ title, onLearnMore }: BaselineBadgeProps) {
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const disclaimerText = {
    MITRE: 'Demo uses baseline reference values for MITRE ATT&CK technique coverage. Production will integrate with the real MITRE ATT&CK API for live threat framework data.',
    Lantern: 'Demo uses baseline reference values for Splunk Lantern use case coverage. Production will integrate with the real Splunk Lantern API for live use case detection.',
  };

  return (
    <>
      <div
        onClick={() => setShowDisclaimer(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
          borderRadius: 6,
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid #f59e0b',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#f59e0b',
          cursor: 'pointer',
        }}
        title="Click to learn more about baseline values"
      >
        <span>⚙️ Baseline Coverage Model</span>
        <span style={{ opacity: 0.7 }}>ⓘ</span>
      </div>

      {/* Disclaimer Modal */}
      {showDisclaimer && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1001,
          }}
          onClick={() => setShowDisclaimer(false)}
        >
          <div
            style={{
              background: '#0f172a',
              borderRadius: 12,
              border: '1px solid #1e293b',
              padding: '2rem',
              maxWidth: '500px',
              width: '90%',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1rem 0', color: '#f8fafc', fontSize: '1.125rem', fontWeight: 700 }}>
              {title} Baseline Coverage Model
            </h3>
            <p style={{ margin: '0 0 1.5rem 0', color: '#cbd5e1', lineHeight: 1.6 }}>
              {disclaimerText[title as keyof typeof disclaimerText]}
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => setShowDisclaimer(false)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: 6,
                  border: '1px solid #1e293b',
                  background: '#1e293b',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
