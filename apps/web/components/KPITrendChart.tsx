'use client';

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface KPIHistoryPoint {
  date: string;
  roiScore: number;
  gainScopeScore: number;
  storageSavingsPotential: number;
  totalDailyGb: number;
  avgUtilization: number;
  avgQuality: number;
  avgConfidence: number;
}

interface KPITrendChartProps {
  metric: 'roi' | 'gainscope' | 'savings' | 'ingest' | 'utilization' | 'quality' | 'confidence';
  days?: 7 | 30 | 90;
  height?: number;
  title?: string;
}

export default function KPITrendChart({
  metric,
  days = 7,
  height = 300,
  title
}: KPITrendChartProps) {
  const [data, setData] = useState<KPIHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/kpi-history?days=${days}`);
        const result = await res.json();

        if (result.mode === 'DEMO_MODE') {
          setError('Database not available');
          setData([]);
          return;
        }

        setData(result.data || []);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load history');
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [days]);

  if (loading) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        Loading trend data…
      </div>
    );
  }

  if (error || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        {error || 'No historical data available'}
      </div>
    );
  }

  const getMetricConfig = () => {
    switch (metric) {
      case 'roi':
        return {
          key: 'roiScore',
          name: 'ROI Score',
          color: '#10b981',
          yAxisDomain: [0, 100],
        };
      case 'gainscope':
        return {
          key: 'gainScopeScore',
          name: 'GainScope Score',
          color: '#3b82f6',
          yAxisDomain: [0, 100],
        };
      case 'savings':
        return {
          key: 'storageSavingsPotential',
          name: 'Storage Savings Potential ($)',
          color: '#8b5cf6',
          yAxisDomain: 'auto',
          formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
        };
      case 'ingest':
        return {
          key: 'totalDailyGb',
          name: 'Daily Ingest (GB)',
          color: '#f59e0b',
          yAxisDomain: 'auto',
          formatter: (value: number) => `${value.toFixed(1)}GB`,
        };
      case 'utilization':
        return {
          key: 'avgUtilization',
          name: 'Avg Utilization',
          color: '#06b6d4',
          yAxisDomain: [0, 100],
          formatter: (value: number) => `${value.toFixed(0)}%`,
        };
      case 'quality':
        return {
          key: 'avgQuality',
          name: 'Avg Quality Score',
          color: '#ec4899',
          yAxisDomain: [0, 100],
          formatter: (value: number) => `${value.toFixed(0)}%`,
        };
      case 'confidence':
        return {
          key: 'avgConfidence',
          name: 'Avg Confidence',
          color: '#14b8a6',
          yAxisDomain: [0, 100],
          formatter: (value: number) => `${value.toFixed(0)}%`,
        };
      default:
        return {
          key: 'roiScore',
          name: 'ROI Score',
          color: '#10b981',
          yAxisDomain: [0, 100],
        };
    }
  };

  const config = getMetricConfig();
  const chartData = data.map((point) => ({
    date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    [config.key]: point[config.key as keyof KPIHistoryPoint] as number,
  }));

  return (
    <div style={{ width: '100%' }}>
      {title && (
        <div style={{ marginBottom: '1rem', fontSize: '0.9rem', fontWeight: 600, color: '#cbd5e1' }}>
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#64748b', fontSize: 12 }}
            stroke="#334155"
          />
          <YAxis
            domain={config.yAxisDomain as any}
            tick={{ fill: '#64748b', fontSize: 12 }}
            stroke="#334155"
          />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: 4,
            }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(value: number) => [
              config.formatter ? config.formatter(value) : value.toFixed(2),
              config.name,
            ]}
          />
          <Line
            type="monotone"
            dataKey={config.key}
            stroke={config.color}
            dot={{ fill: config.color, r: 3 }}
            activeDot={{ r: 5 }}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
        Last {days} days
      </div>
    </div>
  );
}
