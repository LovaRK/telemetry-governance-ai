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

export default function SplunkSettingsPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    url: '',
    hec_token: '',
    username: '',
    password: '',
    ssl_verify: true,
  });
  const [status, setStatus] = useState<SplunkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadStatus();
    loadConfig();
  }, []);

  const loadStatus = async () => {
    try {
      const response = await apiFetch('/api/splunk/status');
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to load status:', err);
    }
  };

  const loadConfig = async () => {
    try {
      const response = await apiFetch('/api/splunk/config');
      if (response.ok) {
        const data = await response.json();
        setFormData((prev) => ({
          ...prev,
          url: data.url || '',
          username: data.username || '',
          ssl_verify: data.ssl_verify !== false,
        }));
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setError('');
    setMessage('');

    try {
      const response = await apiFetch('/api/splunk/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(`Connection failed: ${data.message || data.error}`);
      } else {
        setMessage(`✓ Connection successful${data.details?.splunk_version ? ` (${data.details.splunk_version})` : ''}`);
        setStatus((prev) => ({
          ...(prev || { is_configured: false, last_test: null, test_status: 'success', test_error: null }),
          test_status: 'success',
          test_error: null,
        }));
      }
    } catch (err) {
      setError(`Error: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await apiFetch('/api/splunk/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(`Failed to save: ${data.message || data.error}`);
      } else {
        setMessage('✓ Splunk configuration saved successfully');
        setStatus(data);
      }
    } catch (err) {
      setError(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Splunk Configuration</h1>
        <p className="text-slate-600">Configure your Splunk connection for the governance dashboard</p>
      </div>

      {/* Status Card */}
      {status && (
        <div className="mb-6 p-4 rounded-lg border">
          {status.test_status === 'success' ? (
            <div className="bg-green-50 border-green-200 text-green-800">
              <p className="font-medium">✓ Splunk connection is active</p>
              <p className="text-sm mt-1">Last tested: {status.last_test ? new Date(status.last_test).toLocaleString() : 'Never'}</p>
            </div>
          ) : status.test_status === 'failed' ? (
            <div className="bg-red-50 border-red-200 text-red-800">
              <p className="font-medium">✗ Connection failed</p>
              <p className="text-sm mt-1">{status.test_error}</p>
            </div>
          ) : (
            <div className="bg-yellow-50 border-yellow-200 text-yellow-800">
              <p className="font-medium">⚠ Not configured</p>
              <p className="text-sm mt-1">Please configure your Splunk connection below</p>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
          {message}
        </div>
      )}

      {/* Form */}
      <form className="space-y-6 bg-white p-6 rounded-lg border border-slate-200">
        {/* Splunk URL */}
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-slate-700 mb-2">
            Splunk URL <span className="text-red-500">*</span>
          </label>
          <input
            id="url"
            type="url"
            name="url"
            placeholder="https://splunk.example.com:8089"
            value={formData.url}
            onChange={handleInputChange}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
          <p className="text-xs text-slate-500 mt-1">
            The base URL of your Splunk instance (e.g., https://splunk.example.com:8089)
          </p>
        </div>

        {/* HEC Token */}
        <div>
          <label htmlFor="hec_token" className="block text-sm font-medium text-slate-700 mb-2">
            HEC Token <span className="text-red-500">*</span>
          </label>
          <input
            id="hec_token"
            type="password"
            name="hec_token"
            placeholder="••••••••••••••••"
            value={formData.hec_token}
            onChange={handleInputChange}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            required
          />
          <p className="text-xs text-slate-500 mt-1">
            HTTP Event Collector token for data ingestion
          </p>
        </div>

        {/* Username (Optional) */}
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-slate-700 mb-2">
            Splunk Username (Optional)
          </label>
          <input
            id="username"
            type="text"
            name="username"
            placeholder="admin"
            value={formData.username}
            onChange={handleInputChange}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1">
            Required for API access to Splunk (index listing, queries)
          </p>
        </div>

        {/* Password (Optional) */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-2">
            Splunk Password (Optional)
          </label>
          <input
            id="password"
            type="password"
            name="password"
            placeholder="••••••••••••••••"
            value={formData.password}
            onChange={handleInputChange}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="text-xs text-slate-500 mt-1">
            Password for the Splunk username above
          </p>
        </div>

        {/* SSL Verification */}
        <div className="flex items-center space-x-3">
          <input
            id="ssl_verify"
            type="checkbox"
            name="ssl_verify"
            checked={formData.ssl_verify}
            onChange={handleInputChange}
            className="w-4 h-4 border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
          />
          <label htmlFor="ssl_verify" className="text-sm font-medium text-slate-700">
            Verify SSL Certificate
          </label>
        </div>
        <p className="text-xs text-slate-500 -mt-3">
          Uncheck this only if using self-signed certificates (not recommended for production)
        </p>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !formData.url || !formData.hec_token}
            className="px-6 py-2 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 text-slate-700 font-medium rounded-lg transition"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !formData.url || !formData.hec_token}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>

      {/* Help Section */}
      <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
        <h2 className="font-medium text-blue-900 mb-3">How to Configure Splunk</h2>
        <ol className="text-sm text-blue-900 space-y-2 list-decimal list-inside">
          <li>
            <strong>Create HEC Token:</strong> In Splunk, go to Settings → Data Inputs → HTTP Event Collector and create a new token
          </li>
          <li>
            <strong>Get Splunk URL:</strong> Your Splunk base URL (typically port 8089 for management API)
          </li>
          <li>
            <strong>Create API User:</strong> Create a Splunk user with API access for index listing and queries
          </li>
          <li>
            <strong>Test Connection:</strong> Click "Test Connection" to verify all settings are correct
          </li>
        </ol>
      </div>
    </div>
  );
}
