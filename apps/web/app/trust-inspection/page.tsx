'use client';

import { useState } from 'react';
import { TrustInspectionPanel } from '../components/TrustInspectionPanel';

export default function TrustInspectionPage() {
  const [indexName, setIndexName] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);

  const handleInspect = (e: React.FormEvent) => {
    e.preventDefault();
    if (indexName.trim()) {
      setSelectedIndex(indexName.trim());
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '24px', color: '#2c3e50', fontFamily: 'monospace' }}>
        🔍 Trust Inspection Diagnostic
      </h1>

      <div style={{
        backgroundColor: '#fff',
        padding: '16px',
        borderRadius: '4px',
        marginBottom: '24px',
        border: '1px solid #bdc3c7',
      }}>
        <form onSubmit={handleInspect}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              color: '#2c3e50',
              fontWeight: 'bold',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>
              Index Name
            </label>
            <input
              type="text"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="e.g., security_telemetry_prod"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '12px',
                fontFamily: 'monospace',
                border: '1px solid #bdc3c7',
                borderRadius: '4px',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              padding: '8px 16px',
              backgroundColor: '#3498db',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '12px',
              fontWeight: 'bold',
            }}
          >
            Inspect
          </button>
        </form>
      </div>

      {selectedIndex && (
        <div>
          <h2 style={{
            marginBottom: '16px',
            color: '#2c3e50',
            fontFamily: 'monospace',
            fontSize: '14px',
          }}>
            Results
          </h2>
          <TrustInspectionPanel indexName={selectedIndex} />
        </div>
      )}

      {!selectedIndex && (
        <div style={{
          padding: '32px',
          backgroundColor: '#ecf0f1',
          borderRadius: '4px',
          color: '#7f8c8d',
          textAlign: 'center',
          fontFamily: 'monospace',
          fontSize: '12px',
        }}>
          Enter an index name above to inspect its governance state, drift status, confidence decomposition, reanalysis status, and audit selection criteria.
        </div>
      )}
    </div>
  );
}
