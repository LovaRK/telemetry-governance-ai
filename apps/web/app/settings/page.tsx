'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserProvider, useUser } from '../../lib/user-context';

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
  }, []);

  const handleTestConnection = async () => {
    if (!mcpUrl || !token) {
      setTestResult({ success: false, message: 'MCP URL and token are required' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/test-connection', {
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
        </div>

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
