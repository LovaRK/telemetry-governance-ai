/**
 * Settings → AI Configuration Page
 *
 * Allows customers to:
 * 1. Configure Ollama (URL, model, health check)
 * 2. Configure Anthropic API key (encrypted storage)
 * 3. Select AI provider mode (LOCAL_ONLY, LOCAL_THEN_ANTHROPIC, ANTHROPIC_ONLY)
 * 4. Test connections to both providers
 * 5. Save configuration to database
 */

'use client';

import React, { useState, useEffect } from 'react';

type AIProviderMode = 'local_only' | 'local_then_anthropic' | 'anthropic_only';

interface AIConfig {
  mode: AIProviderMode;
  ollamaUrl: string;
  ollamaModel: string;
  anthropicApiKey?: string;
  anthropicModel: string;
}

interface ConnectionStatus {
  ollama: 'checking' | 'healthy' | 'unhealthy' | 'unknown';
  anthropic: 'checking' | 'healthy' | 'unhealthy' | 'unknown';
}

export default function AISettingsPage() {
  const [config, setConfig] = useState<AIConfig>({
    mode: 'local_only',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'gemma2:9b',
    anthropicApiKey: '',
    anthropicModel: 'claude-3-5-sonnet-20241022',
  });

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    ollama: 'unknown',
    anthropic: 'unknown',
  });

  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [error, setError] = useState('');

  // Test Ollama connection
  const testOllama = async () => {
    setConnectionStatus(prev => ({ ...prev, ollama: 'checking' }));
    try {
      const response = await fetch(`${config.ollamaUrl}/api/tags`);
      if (response.ok) {
        setConnectionStatus(prev => ({ ...prev, ollama: 'healthy' }));
      } else {
        setConnectionStatus(prev => ({ ...prev, ollama: 'unhealthy' }));
      }
    } catch (e) {
      setConnectionStatus(prev => ({ ...prev, ollama: 'unhealthy' }));
    }
  };

  // Test Anthropic connection
  const testAnthropic = async () => {
    if (!config.anthropicApiKey) {
      setConnectionStatus(prev => ({ ...prev, anthropic: 'unhealthy' }));
      return;
    }

    setConnectionStatus(prev => ({ ...prev, anthropic: 'checking' }));
    try {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${config.anthropicApiKey}`,
        },
      });
      if (response.ok) {
        setConnectionStatus(prev => ({ ...prev, anthropic: 'healthy' }));
      } else {
        setConnectionStatus(prev => ({ ...prev, anthropic: 'unhealthy' }));
      }
    } catch (e) {
      setConnectionStatus(prev => ({ ...prev, anthropic: 'unhealthy' }));
    }
  };

  // Save configuration
  const saveConfig = async () => {
    setSaving(true);
    setError('');
    setSavedMessage('');

    try {
      const response = await fetch('/api/config/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error('Failed to save configuration');
      }

      setSavedMessage('✓ Configuration saved successfully');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (e) {
      setError(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const getModeDescription = (mode: AIProviderMode): string => {
    switch (mode) {
      case 'local_only':
        return 'Use local Ollama model only. No fallback. Demo/development mode.';
      case 'local_then_anthropic':
        return 'Try local Ollama first. If unavailable, fall back to Anthropic API. Recommended for production.';
      case 'anthropic_only':
        return 'Use Anthropic API only. Requires valid API key. Fastest, most reliable.';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">AI Provider Settings</h1>
          <p className="text-lg text-slate-600">
            Configure which AI provider to use for recommendations
          </p>
        </div>

        {/* Status Messages */}
        {savedMessage && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-800">{savedMessage}</p>
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Provider Mode Selection */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Provider Mode</h2>
          <div className="space-y-4">
            {(['local_only', 'local_then_anthropic', 'anthropic_only'] as AIProviderMode[]).map(mode => (
              <div
                key={mode}
                className={`p-4 border-2 rounded-lg cursor-pointer transition ${
                  config.mode === mode
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => setConfig(prev => ({ ...prev, mode }))}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    <input
                      type="radio"
                      name="mode"
                      value={mode}
                      checked={config.mode === mode}
                      onChange={() => {}}
                      className="w-4 h-4"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="font-semibold text-slate-900 capitalize block">
                      {mode.replace(/_/g, ' ')}
                    </label>
                    <p className="text-slate-600 mt-1">{getModeDescription(mode)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Local Model (Ollama) Configuration */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Local Model (Ollama)</h2>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  connectionStatus.ollama === 'healthy'
                    ? 'bg-green-500'
                    : connectionStatus.ollama === 'unhealthy'
                    ? 'bg-red-500'
                    : 'bg-slate-300'
                }`}
              />
              <span className="text-sm font-medium capitalize">
                {connectionStatus.ollama === 'healthy' && 'Connected'}
                {connectionStatus.ollama === 'unhealthy' && 'Disconnected'}
                {connectionStatus.ollama === 'checking' && 'Checking...'}
                {connectionStatus.ollama === 'unknown' && 'Unknown'}
              </span>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Ollama URL
              </label>
              <input
                type="text"
                value={config.ollamaUrl}
                onChange={e => setConfig(prev => ({ ...prev, ollamaUrl: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="http://localhost:11434"
              />
              <p className="text-xs text-slate-500 mt-1">Default: http://localhost:11434</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Model Name
              </label>
              <input
                type="text"
                value={config.ollamaModel}
                onChange={e => setConfig(prev => ({ ...prev, ollamaModel: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="gemma2:9b"
              />
              <p className="text-xs text-slate-500 mt-1">E.g., gemma2:9b, llama2, mistral</p>
            </div>
          </div>

          <button
            onClick={testOllama}
            disabled={connectionStatus.ollama === 'checking'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 transition"
          >
            {connectionStatus.ollama === 'checking' ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {/* Anthropic Configuration */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-slate-900">Anthropic API (Optional)</h2>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  connectionStatus.anthropic === 'healthy'
                    ? 'bg-green-500'
                    : connectionStatus.anthropic === 'unhealthy'
                    ? 'bg-red-500'
                    : 'bg-slate-300'
                }`}
              />
              <span className="text-sm font-medium capitalize">
                {connectionStatus.anthropic === 'healthy' && 'Connected'}
                {connectionStatus.anthropic === 'unhealthy' && 'Disconnected'}
                {connectionStatus.anthropic === 'checking' && 'Checking...'}
                {connectionStatus.anthropic === 'unknown' && 'Not configured'}
              </span>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                API Key (Encrypted)
              </label>
              <input
                type="password"
                value={config.anthropicApiKey || ''}
                onChange={e => setConfig(prev => ({ ...prev, anthropicApiKey: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="sk-ant-..."
              />
              <p className="text-xs text-slate-500 mt-1">
                Get your API key from console.anthropic.com
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Model Name
              </label>
              <input
                type="text"
                value={config.anthropicModel}
                onChange={e => setConfig(prev => ({ ...prev, anthropicModel: e.target.value }))}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled
                placeholder="claude-3-5-sonnet-20241022"
              />
              <p className="text-xs text-slate-500 mt-1">Fixed to latest recommended model</p>
            </div>
          </div>

          <button
            onClick={testAnthropic}
            disabled={!config.anthropicApiKey || connectionStatus.anthropic === 'checking'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 transition"
          >
            {connectionStatus.anthropic === 'checking' ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {/* Decision Table Preview */}
        <div className="bg-slate-50 rounded-lg p-6 mb-8 border border-slate-200">
          <h3 className="font-semibold text-slate-900 mb-3">How This Works</h3>
          <div className="space-y-2 text-sm text-slate-700">
            <p>
              <strong>LOCAL_ONLY:</strong> Uses Ollama only. If Ollama is down, recommendations unavailable.
            </p>
            <p>
              <strong>LOCAL_THEN_ANTHROPIC:</strong> Tries Ollama first. If down and you have an Anthropic key, falls back automatically. If no key, skips AI (data still available).
            </p>
            <p>
              <strong>ANTHROPIC_ONLY:</strong> Uses Anthropic API only. Requires valid API key. Ollama status ignored.
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex gap-4">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-slate-400 transition"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
          <button
            onClick={() => window.location.href = '/settings'}
            className="px-6 py-3 bg-slate-200 text-slate-900 font-semibold rounded-lg hover:bg-slate-300 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
