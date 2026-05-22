'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserProvider, useUser } from '../../lib/user-context';
import { apiFetch } from '../../lib/api-client';

function SettingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || 'splunk';
  const { userName } = useUser();

  const [mcpUrl, setMcpUrl] = useState('');
  const [token, setToken] = useState('');
  const [disableSslVerify, setDisableSslVerify] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [userFullName, setUserFullName] = useState('');
  const [userSaved, setUserSaved] = useState(false);
  const [explainabilityMode, setExplainabilityMode] = useState(false);
  const [explainabilitySaved, setExplainabilitySaved] = useState(false);

  // Scoring weights state (must sum to 1.0)
  const [utilWeight, setUtilWeight] = useState(0.35);
  const [detWeight, setDetWeight] = useState(0.40);
  const [qualWeight, setQualWeight] = useState(0.25);
  const [weightsSaved, setWeightsSaved] = useState(false);
  const [weightsSaving, setWeightsSaving] = useState(false);
  const [weightsError, setWeightsError] = useState<string | null>(null);
  const weightsSum = Math.round((utilWeight + detWeight + qualWeight) * 100) / 100;

  useEffect(() => {
    const config = localStorage.getItem('splunk_config');
    if (config) {
      try {
        const parsed = JSON.parse(config);
        setMcpUrl(parsed.mcpUrl || '');
        setToken(parsed.token || '');
        setDisableSslVerify(parsed.disableSslVerify || false);
      } catch {
        // Invalid config, ignore
      }
    }

    const userConfig = localStorage.getItem('datasensai_user');
    if (userConfig) {
      try {
        const parsed = JSON.parse(userConfig);
        setUserFullName(parsed.name || '');
      } catch {
        // Invalid config, ignore
      }
    }

    apiFetch('/api/settings/explainability')
      .then(r => r.ok ? r.json() : null)
      .then(data => setExplainabilityMode(Boolean(data?.data?.explainabilityMode ?? false)))
      .catch(() => {});

    // Load scoring weights from API
    apiFetch('/api/settings/weights')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.weights) {
          setUtilWeight(data.weights.utilization ?? 0.35);
          setDetWeight(data.weights.detection ?? 0.40);
          setQualWeight(data.weights.quality ?? 0.25);
        }
      })
      .catch(() => {}); // Non-critical, use defaults
  }, []);

  const handleTestConnection = async () => {
    if (!mcpUrl || !token) {
      setTestResult({ success: false, message: 'MCP URL and token are required' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await apiFetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpUrl, token, disableSslVerify }),
      });

      const data = await res.json();
      setTestResult({
        success: res.ok,
        message: res.ok
          ? `✓ Connected in ${data.latencyMs}ms`
          : `✗ ${data.error}: ${data.hint}`,
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!mcpUrl || !token) {
      setTestResult({ success: false, message: 'MCP URL and token are required' });
      return;
    }

    localStorage.setItem(
      'splunk_config',
      JSON.stringify({ mcpUrl, token, disableSslVerify })
    );
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.push('/');
    }, 1500);
  };

  const handleSaveWeights = async () => {
    setWeightsError(null);
    if (Math.abs(weightsSum - 1.0) > 0.001) {
      setWeightsError(`Weights must sum to 1.00. Current sum: ${weightsSum.toFixed(2)}`);
      return;
    }
    setWeightsSaving(true);
    try {
      const res = await apiFetch('/api/settings/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utilization: utilWeight, detection: detWeight, quality: qualWeight }),
      });
      if (res.ok) {
        setWeightsSaved(true);
        setTimeout(() => setWeightsSaved(false), 2000);
      } else {
        const d = await res.json();
        setWeightsError(d.error || 'Failed to save weights');
      }
    } catch (e) {
      setWeightsError('Network error saving weights');
    } finally {
      setWeightsSaving(false);
    }
  };

  // Auto-balance remaining weight to the third slider when two change
  const handleUtilChange = (v: number) => { setUtilWeight(v); };
  const handleDetChange  = (v: number) => { setDetWeight(v);  };
  const handleQualChange = (v: number) => { setQualWeight(v); };

  const handleSaveUserSettings = () => {
    localStorage.setItem(
      'datasensai_user',
      JSON.stringify({ name: userFullName || 'Human Reviewer' })
    );
    setUserSaved(true);
    setTimeout(() => {
      setUserSaved(false);
    }, 1500);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', padding: '2rem' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ color: '#f8fafc', margin: 0 }}>Settings</h1>
          <p style={{ color: '#64748b', margin: '0.5rem 0 0 0' }}>Configure your Splunk connection</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #1e293b', paddingBottom: '1rem' }}>
          <button
            onClick={() => router.push('/settings?tab=splunk')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'splunk' ? '#1e293b' : 'transparent',
              color: activeTab === 'splunk' ? '#f8fafc' : '#64748b',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Splunk Configuration
          </button>
          <button
            onClick={() => router.push('/settings?tab=user')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'user' ? '#1e293b' : 'transparent',
              color: activeTab === 'user' ? '#f8fafc' : '#64748b',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            User Settings
          </button>
          <button
            onClick={() => router.push('/settings?tab=governance')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'governance' ? '#1e293b' : 'transparent',
              color: activeTab === 'governance' ? '#f8fafc' : '#64748b',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            🧭 AI / Governance
          </button>
          <button
            onClick={() => router.push('/settings?tab=scoring')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'scoring' ? '#1e293b' : 'transparent',
              color: activeTab === 'scoring' ? '#f8fafc' : '#64748b',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            ⚖️ Scoring Weights
          </button>
        </div>

        {/* Governance Tab */}
        {activeTab === 'governance' && (
          <div
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '2rem',
            }}
          >
            <h3 style={{ color: '#f8fafc', marginTop: 0 }}>Dashboard Explainability</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.86rem' }}>
              Toggle engineering/audit explainability overlays for this user.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', color: '#cbd5e1', marginTop: '1rem' }}>
              <input
                type="checkbox"
                checked={explainabilityMode}
                onChange={(e) => setExplainabilityMode(e.target.checked)}
              />
              Enable Explainability Mode
            </label>
            <ul style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.75rem', lineHeight: 1.6 }}>
              <li>Show formulas and KPI provenance</li>
              <li>Show confidence and source table origins</li>
              <li>Show historical changes and validation context</li>
            </ul>
            <button
              onClick={async () => {
                const res = await apiFetch('/api/settings/explainability', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ explainabilityMode }),
                });
                if (res.ok) {
                  setExplainabilitySaved(true);
                  setTimeout(() => setExplainabilitySaved(false), 1500);
                }
              }}
              style={{
                marginTop: '1rem',
                padding: '0.55rem 1rem',
                border: '1px solid #334155',
                borderRadius: 6,
                background: '#0f172a',
                color: '#f8fafc',
                cursor: 'pointer',
              }}
            >
              Save Explainability Mode
            </button>
            {explainabilitySaved ? (
              <div style={{ color: '#22c55e', marginTop: '0.65rem', fontSize: '0.82rem' }}>
                ✓ Explainability mode saved.
              </div>
            ) : null}
          </div>
        )}

        {/* Splunk Settings Tab */}
        {activeTab === 'splunk' && (
          <div
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '2rem',
            }}
          >
            {/* MCP URL Field */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                }}
              >
                Splunk MCP URL
              </label>
              <input
                type="text"
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                placeholder="http://localhost:8089 or https://splunk.example.com:8089"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              />
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.5rem 0 0 0' }}>
                Management port (usually 8089), not the web UI port (8000)
              </p>
            </div>

            {/* Token Field */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                }}
              >
                Splunk Authentication Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Bearer <your_token_here>"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              />
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.5rem 0 0 0' }}>
                Create in Splunk: Settings → Tokens → New Token. Requires "list_indexes" and "list_saved_searches" capabilities.
              </p>
            </div>

            {/* SSL Verify Option */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                id="ssl_verify"
                checked={disableSslVerify}
                onChange={(e) => setDisableSslVerify(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label
                htmlFor="ssl_verify"
                style={{
                  fontSize: '0.875rem',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  margin: 0,
                }}
              >
                Disable SSL certificate verification (for self-signed certs)
              </label>
            </div>

            {/* Test Result */}
            {testResult && (
              <div
                style={{
                  padding: '1rem',
                  background: testResult.success ? '#22c55e20' : '#ef444420',
                  border: `1px solid ${testResult.success ? '#22c55e' : '#ef4444'}`,
                  borderRadius: 6,
                  marginBottom: '1.5rem',
                  color: testResult.success ? '#22c55e' : '#ef4444',
                  fontSize: '0.875rem',
                }}
              >
                {testResult.message}
              </div>
            )}

            {/* Saved Notification */}
            {saved && (
              <div
                style={{
                  padding: '1rem',
                  background: '#22c55e20',
                  border: '1px solid #22c55e',
                  borderRadius: 6,
                  marginBottom: '1.5rem',
                  color: '#22c55e',
                  fontSize: '0.875rem',
                }}
              >
                ✓ Settings saved. Redirecting...
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={handleTestConnection}
                disabled={testing}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#3b82f6',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: testing ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  opacity: testing ? 0.7 : 1,
                }}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                onClick={handleSave}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#22c55e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Save & Return to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* User Settings Tab */}
        {activeTab === 'user' && (
          <div
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '2rem',
            }}
          >
            {/* Full Name Field */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                }}
              >
                Full Name
              </label>
              <input
                type="text"
                value={userFullName}
                onChange={(e) => setUserFullName(e.target.value)}
                placeholder="Enter your full name"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  color: '#f8fafc',
                  fontSize: '0.875rem',
                  boxSizing: 'border-box',
                }}
              />
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.5rem 0 0 0' }}>
                Your name will be recorded when you approve or reject governance decisions.
              </p>
            </div>

            {/* Saved Notification */}
            {userSaved && (
              <div
                style={{
                  padding: '1rem',
                  background: '#22c55e20',
                  border: '1px solid #22c55e',
                  borderRadius: 6,
                  marginBottom: '1.5rem',
                  color: '#22c55e',
                  fontSize: '0.875rem',
                }}
              >
                ✓ User settings saved.
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSaveUserSettings}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#22c55e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Save User Settings
              </button>
            </div>
          </div>
        )}
        {/* Scoring Weights Tab */}
        {activeTab === 'scoring' && (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: '2rem' }}>
            <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 1.5rem 0', lineHeight: 1.6 }}>
              These weights control how the deterministic scoring engine combines Utilization, Detection, and Data Quality into each sourcetype's Composite Score. Weights must sum to exactly 1.00. Changes take effect on the next Splunk refresh.
            </p>

            {/* Sum indicator */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem',
              fontSize: '0.8rem', fontWeight: 700,
              color: Math.abs(weightsSum - 1.0) < 0.001 ? '#22c55e' : '#ef4444',
            }}>
              Sum: {weightsSum.toFixed(2)} {Math.abs(weightsSum - 1.0) < 0.001 ? '✓' : '— must equal 1.00'}
            </div>

            {/* Utilization slider */}
            {[
              { label: 'Utilization', desc: 'Alerts, scheduled searches, dashboard panels, distinct users', value: utilWeight, set: handleUtilChange, color: '#6366f1' },
              { label: 'Detection Coverage', desc: 'MITRE ATT&CK technique coverage + active alert count', value: detWeight, set: handleDetChange, color: '#0ea5e9' },
              { label: 'Data Quality', desc: 'Parsing error density — lower issues = higher score', value: qualWeight, set: handleQualChange, color: '#22c55e' },
            ].map(({ label, desc, value, set, color }) => (
              <div key={label} style={{ marginBottom: '1.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#cbd5e1' }}>{label}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>{desc}</div>
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color, minWidth: 48, textAlign: 'right' }}>
                    {(value * 100).toFixed(0)}%
                  </div>
                </div>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={value}
                  onChange={e => set(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#475569', marginTop: 2 }}>
                  <span>0%</span><span>50%</span><span>100%</span>
                </div>
              </div>
            ))}

            {/* Quick preset profiles */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Quick Presets
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { name: 'Balanced', u: 0.35, d: 0.40, q: 0.25 },
                  { name: 'Security First', u: 0.25, d: 0.50, q: 0.25 },
                  { name: 'Operations First', u: 0.50, d: 0.25, q: 0.25 },
                  { name: 'Data Quality', u: 0.30, d: 0.30, q: 0.40 },
                ].map(p => (
                  <button
                    key={p.name}
                    onClick={() => { setUtilWeight(p.u); setDetWeight(p.d); setQualWeight(p.q); }}
                    style={{
                      padding: '0.4rem 0.85rem', fontSize: '0.72rem', fontWeight: 600,
                      background: (utilWeight === p.u && detWeight === p.d && qualWeight === p.q) ? '#334155' : '#0f172a',
                      border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer',
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Error / success */}
            {weightsError && (
              <div style={{ padding: '0.75rem 1rem', background: '#ef444420', border: '1px solid #ef4444', borderRadius: 6, color: '#ef4444', fontSize: '0.82rem', marginBottom: '1rem' }}>
                {weightsError}
              </div>
            )}
            {weightsSaved && (
              <div style={{ padding: '0.75rem 1rem', background: '#22c55e20', border: '1px solid #22c55e', borderRadius: 6, color: '#22c55e', fontSize: '0.82rem', marginBottom: '1rem' }}>
                ✓ Scoring weights saved. Takes effect on next Splunk refresh.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSaveWeights}
                disabled={weightsSaving || Math.abs(weightsSum - 1.0) > 0.001}
                style={{
                  padding: '0.75rem 1.5rem', background: '#6366f1', color: '#fff',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: '0.875rem',
                  opacity: (weightsSaving || Math.abs(weightsSum - 1.0) > 0.001) ? 0.5 : 1,
                }}
              >
                {weightsSaving ? 'Saving…' : 'Save Weights'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <UserProvider>
      <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading settings...</div>}>
        <SettingsPageContent />
      </Suspense>
    </UserProvider>
  );
}
