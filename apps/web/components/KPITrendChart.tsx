'use client';

import React, { useState, useEffect, useLayoutEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../lib/api-client';

interface KPIHistoryPoint {
  date: string;
  roiScore: number;
  gainScopeScore: number;
  storageSavingsPotential: number;
  totalDailyGb: number;
  avgUtilization: number;
  avgDetection: number;
  avgQuality: number;
  avgConfidence: number;
}

interface KPITrendChartProps {
  metric: 'roi' | 'gainscope' | 'savings' | 'ingest' | 'utilization' | 'quality' | 'confidence';
  days?: 7 | 30 | 90;
  height?: number;
  title?: string;
  showPeriodToggle?: boolean;
}

export default function KPITrendChart({
  metric,
  days: initialDays = 7,
  height = 300,
  title,
  showPeriodToggle = false
}: KPITrendChartProps) {
  const [days, setDays] = useState<7 | 30 | 90>(initialDays);
  const [data, setData] = useState<KPIHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Keep local period in sync when parent controls days (showPeriodToggle=false path).
  useEffect(() => {
    setDays(initialDays);
  }, [initialDays]);

  // Measure container width for responsive chart sizing
  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const measureWidth = () => {
      const width = containerRef.current?.offsetWidth || 0;
      if (width > 0) setContainerWidth(width);
    };

    measureWidth();

    const resizeObserver = new ResizeObserver(measureWidth);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, [metric]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        setLoading(true);
        const res = await apiFetch(`/api/kpi-history?days=${days}`);
        const result = await res.json();

        // Unwrap nested response: result.data.mode and result.data.data
        if (result.data?.mode === 'DEMO_MODE') {
          setError('Database not available');
          setData([]);
          return;
        }

        setData(result.data?.data || []);
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

  const getMetricConfig = () => {
    switch (metric) {
      case 'roi':        return { key: 'roiScore',                name: 'ROI Score',                  color: '#10b981', yAxisDomain: [0, 100] as [number,number] };
      case 'gainscope':  return { key: 'gainScopeScore',          name: 'GainScope Score',            color: '#3b82f6', yAxisDomain: [0, 100] as [number,number] };
      case 'savings':    return { key: 'storageSavingsPotential', name: 'Storage Savings ($)',        color: '#8b5cf6', yAxisDomain: 'auto' as const, formatter: (v: number) => `$${(v/1000).toFixed(0)}k` };
      case 'ingest':     return { key: 'totalDailyGb',            name: 'Daily Ingest (GB)',          color: '#f59e0b', yAxisDomain: 'auto' as const, formatter: (v: number) => `${v.toFixed(1)}GB` };
      case 'utilization':return { key: 'avgUtilization',          name: 'Avg Utilization',            color: '#06b6d4', yAxisDomain: [0, 100] as [number,number], formatter: (v: number) => `${v.toFixed(0)}%` };
      case 'quality':    return { key: 'avgQuality',              name: 'Avg Quality Score',          color: '#ec4899', yAxisDomain: [0, 100] as [number,number], formatter: (v: number) => `${v.toFixed(0)}%` };
      case 'confidence': return { key: 'avgConfidence',           name: 'Avg Confidence',             color: '#14b8a6', yAxisDomain: [0, 100] as [number,number], formatter: (v: number) => `${v.toFixed(0)}%` };
      default:           return { key: 'roiScore',                name: 'ROI Score',                  color: '#10b981', yAxisDomain: [0, 100] as [number,number] };
    }
  };

  if (loading) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
        Loading trend data…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.8rem' }}>
        {error}
      </div>
    );
  }

  // Single data point — show a "current value" card instead of an empty chart
  if (data.length === 1) {
    const point = data[0];
    const config = getMetricConfig();
    const val = point[config.key as keyof KPIHistoryPoint] as number;
    const display = config.formatter ? config.formatter(val) : val.toFixed(1);
    return (
      <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 800, color: config.color }}>{display}</div>
        <div style={{ fontSize: '0.72rem', color: '#64748b', textAlign: 'center' }}>
          {new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.8rem' }}>
        No historical data yet
      </div>
    );
  }

  const config = getMetricConfig();

  // Deduplicate by date: keep only the first entry per date
  // (API returns multiple rows per date from test runs; keep only the first valid one)
  const uniqueByDate = new Map<string, KPIHistoryPoint>();
  data.forEach((point) => {
    const dateStr = new Date(point.date).toISOString().split('T')[0];
    if (!uniqueByDate.has(dateStr)) {
      uniqueByDate.set(dateStr, point);
    }
  });

  const chartData = Array.from(uniqueByDate.values()).map((point) => {
    // Parse ISO date string directly to avoid timezone shifts
    const dateStr = point.date.substring(0, 10); // "2026-05-23"
    const [year, month, day] = dateStr.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    const displayDate = localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return {
      date: displayDate,
      [config.key]: point[config.key as keyof KPIHistoryPoint] as number,
    };
  });

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          {title && (
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#cbd5e1' }}>
              {title}
            </div>
          )}
        </div>
        {showPeriodToggle && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[7, 30, 90].map((period) => (
              <button
                key={period}
                onClick={() => setDays(period as 7 | 30 | 90)}
                style={{
                  padding: '0.4rem 0.8rem',
                  background: days === period ? '#3b82f6' : '#1e293b',
                  color: days === period ? '#f8fafc' : '#64748b',
                  border: `1px solid ${days === period ? '#3b82f6' : '#334155'}`,
                  borderRadius: 4,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
                onMouseEnter={(e) => {
                  if (days !== period) {
                    (e.currentTarget as HTMLButtonElement).style.background = '#334155';
                  }
                }}
                onMouseLeave={(e) => {
                  if (days !== period) {
                    (e.currentTarget as HTMLButtonElement).style.background = '#1e293b';
                  }
                }}
              >
                {period}d
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={containerRef} style={{ width: '100%', height, background: '#1a1f2e', borderRadius: 4, position: 'relative', border: '1px solid #334155' }}>
        {(containerWidth > 0 || containerWidth === 0) && (
          <LineChart width={containerWidth || 500} height={height} data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
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
              dot={{ fill: config.color, r: 4 }}
              activeDot={{ r: 6 }}
              strokeWidth={3}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </div>
      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b', textAlign: 'center' }}>
        Last {days} days
      </div>
    </div>
  );
}
