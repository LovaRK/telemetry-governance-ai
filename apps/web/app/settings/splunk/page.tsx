'use client';
import { apiFetch } from '../../../lib/api-client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface SplunkStatus {
  is_configured: boolean;
  last_test: string | null;
  test_status: 'success' | 'failed' | 'not_tested' | null;
  test_error: string | null;
}

interface Diagnostics {
  api: string; hec: string; mcp: string;
  rest_auth: string; hec_auth: string;
  api_latency_ms: number | null; hec_latency_ms: number | null;
  indexes: number; saved_searches: number;
  all_pass: boolean;
}

export default function SplunkSettingsPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    apiUrl: '', hecUrl: '', mcpUrl: '',
    hec_token: '', restAuthType: 'JWT', restAuthSecret: '',
    username: '', password: '',
    ssl_verify: true,
  });
  const [status, setStatus] = useState<SplunkStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningDiag, setRunningDiag] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { loadStatus(); loadConfig(); }, []);

  const loadStatus = async () => {
    try { const r = await apiFetch('/api/splunk/status'); if (r.ok) setStatus(await r.json()); }
    catch { /* ignore */ }
  };

  const loadConfig = async () => {
    try {
      const r = await apiFetch('/api/splunk/config');
      if (r.ok) {
        const data = await r.json();
        setFormData(prev => ({
          ...prev,
          apiUrl: data.apiUrl || data.url || '',
          hecUrl: data.hecUrl || data.url || '',
          mcpUrl: data.mcpUrl || '',
          username: data.username || '',
          ssl_verify: data.ssl_verify !== false,
          restAuthType: data.restAuthType || 'JWT',
        }));
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleTestHec = async () => {
    setTesting(true); setError(''); setMessage('');
    try {
      const r = await apiFetch('/api/splunk/test-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: formData.apiUrl, hecUrl: formData.hecUrl, hec_token: formData.hec_token, ssl_verify: formData.ssl_verify,
        }),
      });
      const data = await r.json();
      if (!r.ok) setError(`HEC: ${data.message || data.error}`);
      else setMessage(`✓ HEC: ${data.message}`);
    } catch (err) { setError(`HEC Error: ${(err as Error).message}`); }
    finally { setTesting(false); }
  };

  const handleTestRest = async () => {
    setTesting(true); setError(''); setMessage('');
    try {
      const r = await apiFetch('/api/test-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: formData.apiUrl, mcpUrl: formData.mcpUrl,
          authType: formData.restAuthType === 'JWT' ? 'token' : 'basic',
          bearerToken: formData.restAuthSecret, username: formData.username, password: formData.password,
          disableSslVerify: !formData.ssl_verify,
        }),
      });
      const data = await r.json();
      if (!r.ok) setError(`REST API: ${data.error}`);
      else setMessage(`✓ REST API: ${data.data?.message}`);
    } catch (err) { setError(`REST API Error: ${(err as Error).message}`); }
    finally { setTesting(false); }
  };

  const handleRunDiagnostics = async () => {
    setRunningDiag(true); setDiagnostics(null);
    try {
      const r = await apiFetch('/api/splunk/diagnostics');
      if (r.ok) setDiagnostics(await r.json());
      else setError('Diagnostics failed');
    } catch (err) { setError(`Diagnostics Error: ${(err as Error).message}`); }
    finally { setRunningDiag(false); }
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const r = await apiFetch('/api/splunk/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await r.json();
      if (!r.ok) setError(`Failed to save: ${data.message || data.error}`);
      else { setMessage('✓ Configuration saved'); setStatus(data); }
    } catch (err) { setError(`Error: ${(err as Error).message}`); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-8"><div className="animate-pulse">Loading settings...</div></div>;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Splunk Configuration</h1>
        <p className="text-slate-600">Configure separate API, HEC, and MCP endpoints</p>
      </div>

      {status && (
        <div className="mb-6 p-4 rounded-lg border">
          {status.test_status === 'success' ? (
            <div className="bg-green-50 border-green-200 text-green-800 p-3 rounded">
              <p className="font-medium">✓ Splunk connection is active</p>
              <p className="text-sm mt-1">Last tested: {status.last_test ? new Date(status.last_test).toLocaleString() : 'Never'}</p>
            </div>
          ) : status.test_status === 'failed' ? (
            <div className="bg-red-50 border-red-200 text-red-800 p-3 rounded">
              <p className="font-medium">✗ Connection failed</p>
              <p className="text-sm mt-1">{status.test_error}</p>
            </div>
          ) : (
            <div className="bg-yellow-50 border-yellow-200 text-yellow-800 p-3 rounded">
              <p className="font-medium">⚠ Not configured</p>
              <p className="text-sm mt-1">Configure your Splunk connection below</p>
            </div>
          )}
        </div>
      )}

      {diagnostics && (
        <div className="mb-6 p-4 rounded-lg border border-slate-200 bg-slate-50">
          <h3 className="font-medium text-slate-800 mb-2">Diagnostics</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(diagnostics).filter(([k]) => !['timestamp'].includes(k)).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-slate-600">{k}:</span>
                <span className={typeof v === 'string' && (v === 'healthy' || v === 'valid' || v === 'reachable' || v === true) ? 'text-green-600 font-medium' : typeof v === 'string' && (v === 'down' || v === 'invalid' || v === 'unreachable' || v === false) ? 'text-red-600 font-medium' : 'text-slate-800'}>{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
      {message && <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{message}</div>}

      <form className="space-y-6 bg-white p-6 rounded-lg border border-slate-200">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">API URL <span className="text-red-500">*</span></label>
          <input type="url" name="apiUrl" placeholder="https://splunk.example.com:8089" value={formData.apiUrl} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500" required />
          <p className="text-xs text-slate-500 mt-1">Splunk REST API (port 8089 by default)</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">HEC URL <span className="text-red-500">*</span></label>
          <input type="url" name="hecUrl" placeholder="https://splunk.example.com:8088" value={formData.hecUrl} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500" required />
          <p className="text-xs text-slate-500 mt-1">HTTP Event Collector (port 8088 by default)</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">MCP URL</label>
          <input type="url" name="mcpUrl" placeholder="https://splunk.example.com:8089/services/mcp" value={formData.mcpUrl} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-slate-500 mt-1">MCP endpoint for AI features (auto-derived if left empty)</p>
        </div>

        <hr className="border-slate-200" />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">REST API Auth Type</label>
          <select name="restAuthType" value={formData.restAuthType} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500">
            <option value="JWT">JWT / Bearer Token</option>
            <option value="BASIC">Basic Auth (Username + Password)</option>
            <option value="TOKEN">Splunk Token</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">REST Auth Secret</label>
          <input type="password" name="restAuthSecret" placeholder="Enter JWT or token (sent once, encrypted on save)" value={formData.restAuthSecret} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
          <p className="text-xs text-slate-500 mt-1">Encrypted server-side. Never stored in frontend. Leave empty to keep existing.</p>
        </div>

        {formData.restAuthType === 'BASIC' && (
          <>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Username</label>
              <input type="text" name="username" placeholder="admin" value={formData.username} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
              <input type="password" name="password" placeholder="••••••••" value={formData.password} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
          </>
        )}

        <hr className="border-slate-200" />

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">HEC Token <span className="text-red-500">*</span></label>
          <input type="password" name="hec_token" placeholder="••••••••••••••••" value={formData.hec_token} onChange={handleInputChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500" required />
          <p className="text-xs text-slate-500 mt-1">HTTP Event Collector token (for HEC endpoint)</p>
        </div>

        <div className="flex items-center space-x-3">
          <input id="ssl_verify" type="checkbox" name="ssl_verify" checked={formData.ssl_verify} onChange={handleInputChange} className="w-4 h-4 border-slate-300 rounded focus:ring-2 focus:ring-blue-500" />
          <label htmlFor="ssl_verify" className="text-sm font-medium text-slate-700">Verify SSL Certificate</label>
        </div>

        <div className="flex gap-3 pt-4 border-t border-slate-200 flex-wrap">
          <button type="button" onClick={handleTestHec} disabled={testing || !formData.hecUrl || !formData.hec_token} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 text-slate-700 font-medium rounded-lg transition text-sm">
            {testing ? 'Testing...' : 'Test HEC'}
          </button>
          <button type="button" onClick={handleTestRest} disabled={testing || !formData.apiUrl} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 text-slate-700 font-medium rounded-lg transition text-sm">
            {testing ? 'Testing...' : 'Test REST API'}
          </button>
          <button type="button" onClick={handleRunDiagnostics} disabled={runningDiag} className="px-4 py-2 bg-purple-200 hover:bg-purple-300 disabled:bg-slate-100 text-purple-700 font-medium rounded-lg transition text-sm">
            {runningDiag ? 'Running...' : 'Run Diagnostics'}
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !formData.apiUrl || !formData.hecUrl || !formData.hec_token} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
