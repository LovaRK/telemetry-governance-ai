'use client';

import React, { useMemo, useState } from 'react';
import { ExecutiveKPIs, KPIExplainabilityRecord } from '@/lib/types';
import ProvenanceCard from './ProvenanceCard';
import FormulaDrawer from './FormulaDrawer';

interface Props {
  records: KPIExplainabilityRecord[];
  kpis?: ExecutiveKPIs | null;
  snapshotDate?: string | null;
}

const KPI_KEYS = [
  { id: 'roi', label: 'ROI' },
  { id: 'gainscope', label: 'GainScope' },
  { id: 'detection', label: 'Detection' },
  { id: 'savings', label: 'Savings' },
  { id: 'daily_ingest', label: 'Daily Ingest' },
  { id: 'low_value_spend', label: 'Low-Value Spend' },
  { id: 'security_gaps', label: 'Security Gaps' },
  { id: 'operational_gaps', label: 'Operational Gaps' },
  { id: 'confidence', label: 'Confidence' },
  { id: 'utilization', label: 'Utilization' },
] as const;

function fallbackRecord(metricId: string, label: string, kpis?: ExecutiveKPIs | null, snapshotDate?: string | null): KPIExplainabilityRecord {
  const now = snapshotDate || new Date().toISOString();
  const valMap: Record<string, number> = {
    roi: Number(kpis?.roiScore ?? 0),
    gainscope: Number(kpis?.gainScopeScore ?? 0),
    detection: Number(kpis?.avgDetection ?? 0),
    savings: Number(kpis?.storageSavingsPotential ?? 0),
    daily_ingest: Number(kpis?.totalDailyGb ?? 0),
    low_value_spend: Number(kpis?.licenseSpendLowValue ?? 0),
    security_gaps: Number(kpis?.securityGaps ?? 0),
    operational_gaps: Number(kpis?.operationalGaps ?? 0),
    confidence: Number((kpis?.avgConfidence ?? 0) * 100),
    utilization: Number(kpis?.avgUtilization ?? 0),
  };

  return {
    metricId: metricId.toUpperCase() as any,
    value: valMap[metricId] ?? 0,
    formulaId: 'UNKNOWN',
    formulaExpression: 'Unavailable',
    inputs: [],
    computedValue: NaN,
    sourceTable: 'Unknown',
    sourceRunId: 'Unknown',
    sourceSnapshotId: 'Unknown',
    updatedAt: now,
    confidence: 'LOW',
    sourceOrigin: 'Unknown',
    variance: 'Not computed',
    displayLabel: label,
  };
}

export default function KPIExplanationPanel({ records, kpis, snapshotDate }: Props) {
  const [selected, setSelected] = useState<KPIExplainabilityRecord | null>(null);

  const merged = useMemo(() => {
    const byId = new Map(records.map((r) => [String(r.metricId).toLowerCase(), r]));
    return KPI_KEYS.map(({ id, label }) => {
      const found = byId.get(id);
      if (found) return { ...found, displayLabel: label };
      return fallbackRecord(id, label, kpis, snapshotDate);
    });
  }, [records, kpis, snapshotDate]);

  const traced = merged.filter((m) => m.formulaExpression !== 'Unavailable').length;

  return (
    <div style={{ background: '#08111f', border: '1px solid #1e293b', borderRadius: 10, padding: '0.9rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '0.9rem' }}>KPI Explainability</h4>
        <span style={{ fontSize: '0.72rem', color: '#64748b' }} data-testid="explainability-coverage">ExplainabilityCoverage: {traced}/{merged.length} widgets expandable</span>
      </div>
      <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {merged.map((r) => (
          <ProvenanceCard key={`${r.metricId}-${r.displayLabel || ''}`} record={r} onOpen={setSelected} />
        ))}
      </div>
      <FormulaDrawer record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
