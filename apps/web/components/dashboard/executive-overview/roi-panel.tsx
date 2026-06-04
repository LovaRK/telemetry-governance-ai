'use client';

/**
 * ROIPanel — Row 1 KPI gauges (gated by hasAgentDecisions).
 * Pure visualization — all values as props, openDrawer callback lifted to parent.
 */

import React from 'react';
import { fmt$, fmtGB } from './utils';
import { Gauge, MiniGauge, SpendGauge } from './kpi-gauges';

interface DrawerPayload {
  isOpen: boolean;
  metric: string;
  value: string | number;
  title: string;
  howCalculated: string;
  llmReasoning?: string;
  evidence?: string[];
  confidence?: number;
  tier?: string;
  action?: string;
  rawData?: Record<string, unknown>;
}

interface ROIPanelProps {
  roiScore: number | null;
  roiScoreClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  gainScopeScore: number | null;
  gainScopeScoreClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  licenseSpendLowValue: number | null;
  licenseSpendLowValueClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  storageSavingsPotential: number | null;
  storageSavingsPotentialClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  totalLicenseSpend: number | null;
  totalLicenseSpendClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  tier1SpendAnnual?: number | null;
  tier1SpendAnnualClassification?: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  tier2SpendAnnual?: number | null;
  tier2SpendAnnualClassification?: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  tier3SpendAnnual?: number | null;
  tier3SpendAnnualClassification?: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  tier4SpendAnnual?: number | null;
  tier4SpendAnnualClassification?: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  totalDailyGb: number;
  totalSourcetypes: number;
  securityGaps: number;
  operationalGaps: number;
  tierCounts: { critical: number; important: number; niceToHave: number; lowValue: number };
  avgUtilization: number | null;
  avgUtilizationClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  avgDetection: number | null;
  avgDetectionClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  avgQuality: number | null;
  avgQualityClassification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE';
  avgConfidencePct: number;
  agentReasoning?: string;
  onOpenDrawer?: (payload: DrawerPayload) => void;
}

const AIBadge = (
  <div style={{
    position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
    backgroundColor: '#8E44AD', color: 'white', padding: '2px 8px',
    borderRadius: '12px', fontWeight: 500
  }}>🤖 AI</div>
);

const FactBadge = (
  <div style={{
    position: 'absolute', top: '1rem', right: '1rem', fontSize: '0.65rem',
    backgroundColor: '#27AE60', color: 'white', padding: '2px 8px',
    borderRadius: '12px', fontWeight: 500
  }}>✓ FACT</div>
);

// Classification-aware rendering helper
const renderMetricByClassification = (
  value: number | null,
  classification: 'REAL' | 'EMPTY' | 'UNIMPLEMENTED' | 'BASELINE'
) => {
  if (classification === 'EMPTY') {
    return { text: 'No data available', className: 'text-gray-400', badgeColor: '#f59e0b' };
  }
  if (classification === 'UNIMPLEMENTED') {
    return { text: 'Not calculated', className: 'text-gray-400', badgeColor: '#6b7280' };
  }
  if (classification === 'BASELINE') {
    return { text: value !== null ? value.toFixed(1) : '--', className: 'text-blue-400', badgeColor: '#3b82f6' };
  }
  // REAL
  return { text: value !== null ? value.toFixed(0) : '--', className: 'text-green-400', badgeColor: '#10b981' };
};

const card: React.CSSProperties = {
  padding: '1.5rem', background: '#0f172a', borderRadius: 12,
  border: '1px solid #1e293b', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', position: 'relative',
};

const cardTitle: React.CSSProperties = {
  fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: '1rem', fontWeight: 600,
};

export function ROIPanel({
  roiScore,
  roiScoreClassification,
  gainScopeScore,
  gainScopeScoreClassification,
  licenseSpendLowValue,
  licenseSpendLowValueClassification,
  storageSavingsPotential,
  storageSavingsPotentialClassification,
  totalLicenseSpend,
  totalLicenseSpendClassification,
  tier1SpendAnnual,
  tier1SpendAnnualClassification,
  tier2SpendAnnual,
  tier2SpendAnnualClassification,
  tier3SpendAnnual,
  tier3SpendAnnualClassification,
  tier4SpendAnnual,
  tier4SpendAnnualClassification,
  totalDailyGb,
  totalSourcetypes,
  securityGaps,
  operationalGaps,
  tierCounts,
  avgUtilization,
  avgUtilizationClassification,
  avgDetection,
  avgDetectionClassification,
  avgQuality,
  avgQualityClassification,
  avgConfidencePct,
  agentReasoning = '',
  onOpenDrawer,
}: ROIPanelProps) {
  const open = (payload: DrawerPayload) => onOpenDrawer?.(payload);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>

      {/* ROI Score */}
      <div style={card}>
        {roiScoreClassification === 'REAL' ? AIBadge : FactBadge}
        <div style={cardTitle}>ROI Score</div>
        {roiScoreClassification !== 'REAL' ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            {roiScoreClassification === 'EMPTY' && 'No data available'}
            {roiScoreClassification === 'UNIMPLEMENTED' && 'Not calculated'}
            {roiScoreClassification === 'BASELINE' && 'Baseline data'}
            <div style={{ fontSize: '0.65rem', marginTop: '0.5rem', color: '#475569' }}>
              [{roiScoreClassification}]
            </div>
          </div>
        ) : (
          <Gauge
            value={roiScore || 0}
            label=""
            color="#22c55e"
            onClick={() => open({
              isOpen: true,
              metric: 'roi_score',
              value: roiScore,
              title: `ROI Score: ${roiScore?.toFixed(0) || '--'}`,
              howCalculated: `ROI Score = (Total Savings Potential / Annual Spend) × 100\n\nCritical: ${tierCounts.critical}\nImportant: ${tierCounts.important}\nNice-to-Have: ${tierCounts.niceToHave}\nLow Value: ${tierCounts.lowValue}\n\nThe score combines tier distribution with potential cost savings.`,
              llmReasoning: agentReasoning,
              evidence: [
                `Savings potential: ${fmt$(storageSavingsPotential || 0)}`,
                `Current annual spend: ${fmt$(totalLicenseSpend || 0)}`,
                `${tierCounts.lowValue} low-value indexes identified`,
                `${tierCounts.critical + tierCounts.important} high-value indexes protected`,
              ],
              confidence: avgConfidencePct,
              rawData: { tierCounts, roiScore, storageSavingsPotential, totalLicenseSpend },
            })}
          />
        )}
      </div>

      {/* GainScope */}
      <div style={card}>
        {gainScopeScoreClassification === 'REAL' ? AIBadge : FactBadge}
        <div style={cardTitle}>GainScope</div>
        {gainScopeScoreClassification !== 'REAL' ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            {gainScopeScoreClassification === 'EMPTY' && 'No data available'}
            {gainScopeScoreClassification === 'UNIMPLEMENTED' && 'Not calculated'}
            {gainScopeScoreClassification === 'BASELINE' && 'Baseline data'}
            <div style={{ fontSize: '0.65rem', marginTop: '0.5rem', color: '#475569' }}>
              [{gainScopeScoreClassification}]
            </div>
          </div>
        ) : (
          <Gauge
            value={gainScopeScore || 0}
            label=""
            color="#3b82f6"
            onClick={() => open({
              isOpen: true,
              metric: 'gainscope_score',
              value: gainScopeScore,
              title: `GainScope Score: ${gainScopeScore?.toFixed(0) || '--'}`,
              howCalculated: `GainScope Score = (Utilization + Detection + Quality) / 3\n\nUtilization: ${(avgUtilization || 0).toFixed(0)}%\nDetection Coverage: ${(avgDetection || 0).toFixed(0)}%\nData Quality: ${(avgQuality || 0).toFixed(0)}%\n\nMeasures overall data health and business impact.`,
              llmReasoning: agentReasoning,
              evidence: [
                `Average utilization score: ${(avgUtilization || 0).toFixed(0)}%`,
                `Average detection coverage: ${(avgDetection || 0).toFixed(0)}%`,
                `Average data quality: ${(avgQuality || 0).toFixed(0)}%`,
                `${totalSourcetypes} indexes analyzed`,
              ],
              confidence: avgConfidencePct,
              rawData: { gainScopeScore, avgUtilization, avgDetection, avgQuality },
            })}
          />
        )}
      </div>

      {/* Low-Value Spend */}
      <div style={card}>
        {licenseSpendLowValueClassification === 'REAL' ? AIBadge : FactBadge}
        <div style={cardTitle}>Low-Value Spend</div>
        {licenseSpendLowValueClassification !== 'REAL' ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            {licenseSpendLowValueClassification === 'EMPTY' && 'No data available'}
            {licenseSpendLowValueClassification === 'UNIMPLEMENTED' && 'Not calculated'}
            {licenseSpendLowValueClassification === 'BASELINE' && 'Baseline data'}
            <div style={{ fontSize: '0.65rem', marginTop: '0.5rem', color: '#475569' }}>
              [{licenseSpendLowValueClassification}]
            </div>
          </div>
        ) : (
          <div style={{ cursor: 'pointer' }} onClick={() => open({
            isOpen: true,
            metric: 'license_spend_low_value',
            value: licenseSpendLowValue,
            title: `Low-Value Spend: ${fmt$(licenseSpendLowValue || 0)}`,
            howCalculated: `Low-Value Spend = Annual cost of indexes classified as Low Value tier\n\nLow-Value indexes: ${tierCounts.lowValue}\nTotal annual spend: ${fmt$(totalLicenseSpend || 0)}\nPercentage: ${(totalLicenseSpend || 0) > 0 ? (((licenseSpendLowValue || 0) / (totalLicenseSpend || 0)) * 100).toFixed(1) : 0}%`,
            llmReasoning: agentReasoning,
            evidence: [
              `${tierCounts.lowValue} indexes classified as low-value`,
              `Annual cost: ${fmt$(licenseSpendLowValue || 0)}`,
              `Potential savings: ${fmt$(storageSavingsPotential || 0)}`,
              `Recommended action: Archive or eliminate low-utilization indexes`,
            ],
            confidence: avgConfidencePct,
            rawData: { licenseSpendLowValue, lowValueCount: tierCounts.lowValue, totalLicenseSpend },
          })}>
            <SpendGauge amount={licenseSpendLowValue || 0} total={totalLicenseSpend || 0} label="" color="#ef4444" />
          </div>
        )}
      </div>

      {/* Savings Potential */}
      <div style={card}>
        {storageSavingsPotentialClassification === 'REAL' ? AIBadge : FactBadge}
        <div style={cardTitle}>Savings Potential</div>
        {storageSavingsPotentialClassification !== 'REAL' ? (
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            {storageSavingsPotentialClassification === 'EMPTY' && 'No data available'}
            {storageSavingsPotentialClassification === 'UNIMPLEMENTED' && 'Not calculated'}
            {storageSavingsPotentialClassification === 'BASELINE' && 'Baseline data'}
            <div style={{ fontSize: '0.65rem', marginTop: '0.5rem', color: '#475569' }}>
              [{storageSavingsPotentialClassification}]
            </div>
          </div>
        ) : (
          <div style={{ cursor: 'pointer' }} onClick={() => open({
            isOpen: true,
            metric: 'storage_savings_potential',
            value: storageSavingsPotential,
            title: `Savings Potential: ${fmt$(storageSavingsPotential || 0)}`,
            howCalculated: `Savings Potential = Sum of cost reduction from optimization and elimination actions\n\nARCHIVE savings: Reduce retention on cold data\nELIMINATE savings: Remove unused indexes\nOPTIMIZE savings: Reduce daily ingest through deduplication`,
            llmReasoning: agentReasoning,
            evidence: [
              `Estimated annual savings: ${fmt$(storageSavingsPotential || 0)}`,
              `Percentage of current spend: ${(totalLicenseSpend || 0) > 0 ? (((storageSavingsPotential || 0) / (totalLicenseSpend || 0)) * 100).toFixed(1) : 0}%`,
              `Low-value spend to reduce: ${fmt$(licenseSpendLowValue || 0)}`,
              `${tierCounts.critical + tierCounts.important} high-value indexes remain protected`,
            ],
            confidence: avgConfidencePct,
            rawData: { storageSavingsPotential, totalLicenseSpend, licenseSpendLowValue },
          })}>
            <SpendGauge amount={storageSavingsPotential || 0} total={totalLicenseSpend || 0} label="" color="#22c55e" />
          </div>
        )}
      </div>

      {/* Daily Ingest (fact card — no LLM) */}
      <div style={{
        ...card,
        alignItems: 'flex-start', justifyContent: 'flex-start',
        borderLeft: '4px solid #8b5cf6',
      }}>
        {FactBadge}
        <div style={cardTitle}>Daily Ingest</div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc' }}>{fmtGB(totalDailyGb)}</div>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>{totalSourcetypes} sourcetypes</div>
      </div>

      {/* Coverage Gaps (AI-classified) */}
      <div style={{
        ...card,
        alignItems: 'flex-start', justifyContent: 'flex-start',
        borderLeft: '4px solid #f59e0b',
      }}>
        {AIBadge}
        <div style={cardTitle}>Coverage Gaps</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem', alignItems: 'start' }}>
          {/* Security Gaps */}
          <div style={{ cursor: 'pointer' }} onClick={() => open({
            isOpen: true,
            metric: 'security_gaps',
            value: securityGaps,
            title: `Security Gaps: ${securityGaps}`,
            howCalculated: `Security Gaps = sourcetypes that have ≥15 MITRE ATT&CK technique mappings AND active alert coverage < 25%.\n\nCurrent avg detection score: ${Math.round(avgDetection ?? 0)}%\n\n${avgDetection === 0 ? '⚠ Detection score is 0% across all sourcetypes. This means MITRE ATT&CK and Lantern use-case mapping CSVs were not provided. Gap detection requires sourcetype_attack_mapping.csv to be loaded.' : 'Gap detection is active.'}`,
            llmReasoning: agentReasoning,
            evidence: [
              avgDetection === 0
                ? `⚠ MITRE mapping data not loaded — provide sourcetype_attack_mapping.csv to enable gap detection`
                : `${securityGaps} of ${totalSourcetypes} indexes have unfired MITRE detection potential`,
              `Avg detection score: ${Math.round(avgDetection ?? 0)}%`,
              `See Detail Analysis → Security Detection Gaps for per-sourcetype breakdown`,
            ],
            confidence: avgConfidencePct,
            rawData: { securityGaps, avgDetection, totalSourcetypes },
          })}>
            {avgDetection === 0 ? (
              <div style={{ fontSize: '0.7rem', color: '#f59e0b', lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, color: '#94a3b8' }}>Security Gaps</div>
                <div style={{ color: '#f59e0b', marginTop: 2 }}>⚠ No MITRE data</div>
                <div style={{ color: '#64748b', fontSize: '0.62rem', marginTop: 1 }}>Load MITRE mapping CSV</div>
              </div>
            ) : (
              <MiniGauge value={securityGaps} max={Math.max(totalSourcetypes, 1)} label="Security" color="#ef4444" />
            )}
          </div>

          {/* Operational Gaps */}
          <div style={{ cursor: 'pointer' }} onClick={() => open({
            isOpen: true,
            metric: 'operational_gaps',
            value: operationalGaps,
            title: `Operational Gaps: ${operationalGaps}`,
            howCalculated: `Operational Gaps = sourcetypes with ≥4 Splunk Lantern use-case mappings AND zero active scheduled searches.\n\n${avgDetection === 0 ? '⚠ Lantern domain mapping CSV (sourcetype_lantern_mapping.csv) was not provided. Operational gap detection is unavailable.' : 'Gap detection is active.'}`,
            llmReasoning: agentReasoning,
            evidence: [
              avgDetection === 0
                ? `⚠ Lantern mapping data not loaded — provide sourcetype_lantern_mapping.csv to enable gap detection`
                : `${operationalGaps} of ${totalSourcetypes} indexes have Lantern use cases with no coverage`,
              `See Detail Analysis → Operational Coverage for per-sourcetype breakdown`,
            ],
            confidence: avgConfidencePct,
            rawData: { operationalGaps, totalSourcetypes },
          })}>
            {avgDetection === 0 ? (
              <div style={{ fontSize: '0.7rem', color: '#f59e0b', lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, color: '#94a3b8' }}>Ops Gaps</div>
                <div style={{ color: '#f59e0b', marginTop: 2 }}>⚠ No Lantern data</div>
                <div style={{ color: '#64748b', fontSize: '0.62rem', marginTop: 1 }}>Load Lantern mapping CSV</div>
              </div>
            ) : (
              <MiniGauge value={operationalGaps} max={Math.max(totalSourcetypes, 1)} label="Ops" color="#f59e0b" />
            )}
          </div>
          <div
            style={{ cursor: 'pointer', gridColumn: '1 / -1' }}
            onClick={() => open({
              isOpen: true,
              metric: 'avg_confidence',
              value: Math.round(avgConfidencePct),
              title: `Confidence Score: ${Math.round(avgConfidencePct)}%`,
              howCalculated: `Confidence Score = Average confidence of LLM decisions across all indexes\n\nBased on:\n• Evidence quality (utilization data, detection patterns)\n• Classification agreement with tier patterns\n• Data completeness and freshness`,
              llmReasoning: agentReasoning,
              evidence: [
                `Overall LLM decision confidence: ${avgConfidencePct.toFixed(1)}%`,
                `Higher confidence indicates stronger classification signals`,
                `Low confidence suggests need for manual review of edge cases`,
              ],
              confidence: avgConfidencePct,
              rawData: { confidencePercent: Math.round(avgConfidencePct) },
            })}
          >
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <MiniGauge value={Math.round(avgConfidencePct)} max={100} label="Confidence" color="#22c55e" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
