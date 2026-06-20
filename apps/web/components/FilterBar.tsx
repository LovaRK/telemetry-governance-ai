'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { apiFetch } from '../lib/api-client';
import { fmt$ } from './dashboard/executive-overview/utils';

/**
 * FilterBar — live "what-if" recomputation (modeled on the Splunk v3/v4
 * reference dashboards).
 *
 * Changing Cost/GB/year, Storage $/GB/month, or the three scoring weights
 * POSTs to /api/kpi/recompute, which recomputes composite/tier/KPIs and
 * deterministic storage savings from the already-persisted raw sub-scores —
 * no pipeline run, no Splunk, no LLM.
 */

export interface RecomputeKpis {
  roiScore: number;
  gainScopeScore: number;
  licenseSpendLowValue: number;
  storageSavingsPotential: number;
  totalLicenseSpend: number;
  totalDailyGb: number;
  totalSourcetypes: number;
  tierCounts: { critical: number; important: number; niceToHave: number; lowValue: number };
  tierSpend: { critical: number; important: number; niceToHave: number; lowValue: number };
  securityGaps: number;
}

interface Props {
  defaultCostPerGbYear?: number;
  defaultStorageCostPerGbMonth?: number;
  defaultWeights?: { utilization: number; detection: number; quality: number };
  onRecompute?: (kpis: RecomputeKpis, ctx: { weights: any; costPerGbYear: number; storageCostPerGbMonth: number }) => void;
}

export default function FilterBar({
  defaultCostPerGbYear = 3650,
  defaultStorageCostPerGbMonth = 15,
  defaultWeights = { utilization: 0.35, detection: 0.40, quality: 0.25 },
  onRecompute,
}: Props) {
  const [cost, setCost] = useState(defaultCostPerGbYear);
  const [storageCost, setStorageCost] = useState(defaultStorageCostPerGbMonth);
  const [util, setUtil] = useState(defaultWeights.utilization);
  const [det, setDet] = useState(defaultWeights.detection);
  const [qual, setQual] = useState(defaultWeights.quality);
  const [kpis, setKpis] = useState<RecomputeKpis | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ok' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weightSum = Math.round((util + det + qual) * 100) / 100;
  const weightsValid = Math.abs(weightSum - 1.0) < 0.001;

  const recompute = useCallback(async () => {
    if (!weightsValid) return;
    setStatus('loading');
    setError(null);
    try {
      const res = await apiFetch('/api/kpi/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weights: { utilization: util, detection: det, quality: qual },
          costPerGbYear: cost,
          storageCostPerGbMonth: storageCost,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const data = json?.data || json;
      if (data?.empty) {
        setStatus('idle');
        setKpis(null);
        return;
      }
      setKpis(data.kpis);
      setStatus('ok');
      onRecompute?.(data.kpis, { weights: data.weights, costPerGbYear: cost, storageCostPerGbMonth: storageCost });
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  }, [util, det, qual, cost, storageCost, weightsValid, onRecompute]);

  // Debounced recompute on any input change
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(recompute, 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [recompute]);

  const applyAsDefault = useCallback(async () => {
    if (!weightsValid) return;
    setStatus('loading');
    try {
      const res = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          costPerGbPerDay: Math.round((cost / 365) * 10000) / 10000,
          decisionWeights: { utilization: util, detection: det, quality: qual },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('saved');
      setTimeout(() => setStatus('ok'), 2000);
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  }, [cost, util, det, qual, weightsValid]);

  const num = (setter: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) setter(v);
  };

  const field = (label: string, value: number, onChange: (e: any) => void, step: string, min = 0, max = 100000) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label style={{ fontSize: '0.62rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      <input
        type="number" value={value} step={step} min={min} max={max} onChange={onChange}
        style={{ width: 92, padding: '0.35rem 0.5rem', background: '#0b1220', color: '#e2e8f0',
          border: '1px solid #1e293b', borderRadius: 6, fontSize: '0.8rem' }}
      />
    </div>
  );

  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4, paddingBottom: 6 }}>
          ⚙ Live Filters
        </div>
        {field('Cost $/GB/yr', cost, num(setCost), '1', 0, 1_000_000)}
        {field('Storage $/GB/mo', storageCost, num(setStorageCost), '1', 0, 10_000)}
        {field('Utilization', util, num(setUtil), '0.05', 0, 1)}
        {field('Detection', det, num(setDet), '0.05', 0, 1)}
        {field('Quality', qual, num(setQual), '0.05', 0, 1)}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 2 }}>
          <span style={{ fontSize: '0.62rem', color: weightsValid ? '#22c55e' : '#ef4444' }}>
            Σ weights {weightSum.toFixed(2)} {weightsValid ? '✓' : '≠ 1.00'}
          </span>
          <button
            onClick={applyAsDefault}
            disabled={!weightsValid || status === 'loading'}
            style={{ padding: '0.4rem 0.8rem', background: weightsValid ? '#1d4ed8' : '#334155', color: '#fff',
              border: 'none', borderRadius: 6, fontSize: '0.72rem', cursor: weightsValid ? 'pointer' : 'not-allowed' }}
          >
            {status === 'saved' ? '✓ Saved' : 'Apply as default'}
          </button>
        </div>

        <div style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#64748b', paddingBottom: 6 }}>
          {status === 'loading' && 'Recomputing…'}
          {status === 'ok' && 'Live — no pipeline run'}
          {status === 'error' && <span style={{ color: '#ef4444' }}>Error: {error}</span>}
          {!weightsValid && <span style={{ color: '#ef4444' }}> · weights must sum to 1.00</span>}
        </div>
      </div>

      {kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
          {[
            { label: 'ROI Score', value: kpis.roiScore.toFixed(1), color: '#3b82f6' },
            { label: 'GainScope %', value: `${kpis.gainScopeScore.toFixed(1)}%`, color: '#22c55e' },
            { label: 'Savings Potential', value: fmt$(kpis.storageSavingsPotential), color: '#22c55e' },
            { label: 'Low-Value Spend', value: fmt$(kpis.licenseSpendLowValue), color: '#ef4444' },
            { label: 'Total Spend', value: fmt$(kpis.totalLicenseSpend), color: '#f59e0b' },
            { label: 'Critical', value: String(kpis.tierCounts.critical), color: '#22c55e' },
            { label: 'Low-Value', value: String(kpis.tierCounts.lowValue), color: '#ef4444' },
          ].map((k) => (
            <div key={k.label} style={{ background: '#0b1220', border: '1px solid #1e293b', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              <div style={{ fontSize: '0.6rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
