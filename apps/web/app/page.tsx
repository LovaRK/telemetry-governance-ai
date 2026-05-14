'use client';

import { useState } from 'react';
import Header from '../components/Header';
import AgentTimeline from '../components/AgentTimeline';
import AgentSummary from '../components/AgentSummary';
import DynamicComponents from '../components/DynamicComponents';
import WhyThisWasShown from '../components/WhyThisWasShown';
import RecommendationCard from '../components/RecommendationCard';
import { DashboardData, FormData } from '../lib/types';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [formData, setFormData] = useState<FormData>({ mcp_url: '', token: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Pipeline failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <Header connectionStatus={data?.connection?.status} />

      <div style={{ padding: '1rem' }}>
        {!data && (
          <form onSubmit={handleSubmit} style={{ marginBottom: '2rem', padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '1rem' }}>Connect to Splunk MCP</h2>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="MCP URL"
                value={formData.mcp_url}
                onChange={e => setFormData({ ...formData, mcp_url: e.target.value })}
                style={{ flex: 1, minWidth: '200px', padding: '0.75rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }}
                required
              />
              <input
                type="password"
                placeholder="Token"
                value={formData.token}
                onChange={e => setFormData({ ...formData, token: e.target.value })}
                style={{ flex: 1, minWidth: '200px', padding: '0.75rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }}
                required
              />
              <button
                type="submit"
                disabled={loading}
                style={{ padding: '0.75rem 1.5rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                {loading ? 'Running Pipeline...' : 'Run Agentic Analysis'}
              </button>
            </div>
          </form>
        )}

        {data?.timeline && <AgentTimeline events={data.timeline} />}
        {data?.summary && <AgentSummary summary={data.summary} />}

        {data?.summary && (
          <div style={{ margin: '1rem 0', padding: '1rem', background: '#1a1a1a', borderRadius: '8px' }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
              <div><span style={{ color: '#22c55e' }}>●</span> KEEP: {data.summary.keep || 0}</div>
              <div><span style={{ color: '#f59e0b' }}>●</span> OPTIMIZE: {data.summary.optimize || 0}</div>
              <div><span style={{ color: '#3b82f6' }}>●</span> ARCHIVE: {data.summary.archive || 0}</div>
              <div><span style={{ color: '#ef4444' }}>●</span> ELIMINATE: {data.summary.eliminate || 0}</div>
              <div><span style={{ color: '#8b5cf6' }}>●</span> INVESTIGATE: {data.summary.investigate || 0}</div>
            </div>
            {data.summary.totalPotentialSavings > 0 && (
              <div style={{ marginTop: '1rem', fontWeight: 600, color: '#22c55e' }}>
                Total Potential Savings: ${(data.summary.totalPotentialSavings / 1000).toFixed(0)}k/year
              </div>
            )}
          </div>
        )}

        {data?.telemetry_assets && data.telemetry_assets.length > 0 && (
          <div style={{ margin: '2rem 0' }}>
            <h2 style={{ marginBottom: '1rem', fontSize: '1.125rem' }}>
              Telemetry Recommendations ({data.telemetry_assets.length})
            </h2>
            {data.telemetry_assets.map((asset, index) => (
              <RecommendationCard key={index} asset={asset} />
            ))}
          </div>
        )}

        {data?.components && <DynamicComponents components={data.components} />}
        {data?.components && <WhyThisWasShown components={data.components} />}
      </div>
    </main>
  );
}