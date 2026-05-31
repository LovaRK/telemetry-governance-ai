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
  roiScore: number;
  gainScopeScore: number;
  licenseSpendLowValue: number;
  storageSavingsPotential: number;
  totalLicenseSpend: number;
  totalDailyGb: number;
  totalSourcetypes: number;
  securityGaps: number;
  operationalGaps: number;
  tierCounts: { critical: number; important: number; niceToHave: number; lowValue: number };
  avgUtilization: number;
  avgDetection: number;
  avgQuality: number;
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
  gainScopeScore,
  licenseSpendLowValue,
  storageSavingsPotential,
  totalLicenseSpend,
  totalDailyGb,
  totalSourcetypes,
  securityGaps,
  operationalGaps,
  tierCounts,
  avgUtilization,
  avgDetection,
  avgQuality,
  avgConfidencePct,
  agentReasoning = '',
  onOpenDrawer,
}: ROIPanelProps) {
  const open = (payload: DrawerPayload) => onOpenDrawer?.(payload);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>

      {/* ROI Score */}
      <div style={card}>
        {AIBadge}
        <div style={cardTitle}>ROI Score</div>
        <Gauge
          value={roiScore}
          label=""
          color="#22c55e"
          onClick={() => open({
            isOpen: true,
            metric: 'roi_score',
            value: roiScore,
            title: `ROI Score: ${roiScore.toFixed(0)}`,
            howCalculated: `ROI Score = (Total Savings Potential / Annual Spend) × 100\n\nCritical: ${tierCounts.critical}\nImportant: ${tierCounts.important}\nNice-to-Have: ${tierCounts.niceToHave}\nLow Value: ${tierCounts.lowValue}\n\nThe score combines tier distribution with potential cost savings.`,
            llmReasoning: agentReasoning,
            evidence: [
              `Savings potential: ${fmt$(storageSavingsPotential)}`,
              `Current annual spend: ${fmt$(totalLicenseSpend)}`,
              `${tierCounts.lowValue} low-value indexes identified`,
              `${tierCounts.critical + tierCounts.important} high-value indexes protected`,
            ],
            confidence: avgConfidencePct,
            rawData: { tierCounts, roiScore, storageSavingsPotential, totalLicenseSpend },
          })}
        />
      </div>

      {/* GainScope */}
      <div style={card}>
        {AIBadge}
        <div style={cardTitle}>GainScope</div>
        <Gauge
          value={gainScopeScore}
          label=""
          color="#3b82f6"
          onClick={() => open({
            isOpen: true,
            metric: 'gainscope_score',
            value: gainScopeScore,
            title: `GainScope Score: ${gainScopeScore.toFixed(0)}`,
            howCalculated: `GainScope Score = (Utilization + Detection + Quality) / 3\n\nUtilization: ${avgUtilization.toFixed(0)}%\nDetection Coverage: ${avgDetection.toFixed(0)}%\nData Quality: ${avgQuality.toFixed(0)}%\n\nMeasures overall data health and business impact.`,
            llmReasoning: agentReasoning,
            evidence: [
              `Average utilization score: ${avgUtilization.toFixed(0)}%`,
              `Average detection coverage: ${avgDetection.toFixed(0)}%`,
              `Average data quality: ${avgQuality.toFixed(0)}%`,
              `${totalSourcetypes} indexes analyzed`,
            ],
            confidence: avgConfidencePct,
            rawData: { gainScopeScore, avgUtilization, avgDetection, avgQuality },
          })}
        />
      </div>

      {/* Low-Value Spend */}
      <div style={card}>
        {AIBadge}
        <div style={cardTitle}>Low-Value Spend</div>
        <div style={{ cursor: 'pointer' }} onClick={() => open({
          isOpen: true,
          metric: 'license_spend_low_value',
          value: licenseSpendLowValue,
          title: `Low-Value Spend: ${fmt$(licenseSpendLowValue)}`,
          howCalculated: `Low-Value Spend = Annual cost of indexes classified as Low Value tier\n\nLow-Value indexes: ${tierCounts.lowValue}\nTotal annual spend: ${fmt$(totalLicenseSpend)}\nPercentage: ${totalLicenseSpend > 0 ? ((licenseSpendLowValue / totalLicenseSpend) * 100).toFixed(1) : 0}%`,
          llmReasoning: agentReasoning,
          evidence: [
            `${tierCounts.lowValue} indexes classified as low-value`,
            `Annual cost: ${fmt$(licenseSpendLowValue)}`,
            `Potential savings: ${fmt$(storageSavingsPotential)}`,
            `Recommended action: Archive or eliminate low-utilization indexes`,
          ],
          confidence: avgConfidencePct,
          rawData: { licenseSpendLowValue, lowValueCount: tierCounts.lowValue, totalLicenseSpend },
        })}>
          <SpendGauge amount={licenseSpendLowValue} total={totalLicenseSpend} label="" color="#ef4444" />
        </div>
      </div>

      {/* Savings Potential */}
      <div style={card}>
        {AIBadge}
        <div style={cardTitle}>Savings Potential</div>
        <div style={{ cursor: 'pointer' }} onClick={() => open({
          isOpen: true,
          metric: 'storage_savings_potential',
          value: storageSavingsPotential,
          title: `Savings Potential: ${fmt$(storageSavingsPotential)}`,
          howCalculated: `Savings Potential = Sum of cost reduction from optimization and elimination actions\n\nARCHIVE savings: Reduce retention on cold data\nELIMINATE savings: Remove unused indexes\nOPTIMIZE savings: Reduce daily ingest through deduplication`,
          llmReasoning: agentReasoning,
          evidence: [
            `Estimated annual savings: ${fmt$(storageSavingsPotential)}`,
            `Percentage of current spend: ${totalLicenseSpend > 0 ? ((storageSavingsPotential / totalLicenseSpend) * 100).toFixed(1) : 0}%`,
            `Low-value spend to reduce: ${fmt$(licenseSpendLowValue)}`,
            `${tierCounts.critical + tierCounts.important} high-value indexes remain protected`,
          ],
          confidence: avgConfidencePct,
          rawData: { storageSavingsPotential, totalLicenseSpend, licenseSpendLowValue },
        })}>
          <SpendGauge amount={storageSavingsPotential} total={totalLicenseSpend} label="" color="#22c55e" />
        </div>
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
          <div style={{ cursor: 'pointer' }} onClick={() => open({
            isOpen: true,
            metric: 'security_gaps',
            value: securityGaps,
            title: `Security Gaps: ${securityGaps}`,
            howCalculated: `Security Gaps = sourcetypes that have MITRE ATT&CK technique mappings but whose active alert count is < 25% of that potential.\n\nA gap of 0 means either:\n  ✓ All mapped detections are firing (good)\n  ⚠ No MITRE/Lantern mappings found for these sourcetypes\n\nCheck the Detail Analysis page for per-sourcetype detection scores.\nTotal indexes: ${totalSourcetypes} | Avg detection score: ${Math.round(avgDetection ?? 0)}%`,
            llmReasoning: agentReasoning,
            evidence: [
              `${securityGaps} indexes have unfired MITRE detection potential`,
              securityGaps === 0 && avgDetection < 40
                ? `⚠ Avg detection score ${Math.round(avgDetection ?? 0)}% — low scores may indicate missing MITRE/Lantern sourcetype mappings`
                : `${totalSourcetypes - securityGaps} of ${totalSourcetypes} indexes have active detections`,
              `See Detail Analysis → Security Detection Gaps for per-sourcetype breakdown`,
            ],
            confidence: avgConfidencePct,
            rawData: { securityGaps, totalSourcetypes },
          })}>
            <MiniGauge value={securityGaps} max={Math.max(totalSourcetypes, 1)} label="Security" color="#ef4444" />
          </div>
          <div style={{ cursor: 'pointer' }} onClick={() => open({
            isOpen: true,
            metric: 'operational_gaps',
            value: operationalGaps,
            title: `Operational Gaps: ${operationalGaps}`,
            howCalculated: `Operational Gaps = sourcetypes that have Splunk Lantern use-case mappings but zero active scheduled searches.\n\nA gap of 0 means either:\n  ✓ All Lantern use cases have active coverage (good)\n  ⚠ No Lantern domain mappings found for these sourcetypes\n\nTotal indexes: ${totalSourcetypes}`,
            llmReasoning: agentReasoning,
            evidence: [
              `${operationalGaps} indexes have Lantern use cases with no active coverage`,
              operationalGaps === 0
                ? `Operational gap analysis requires Splunk Lantern domain mappings`
                : `${totalSourcetypes - operationalGaps} of ${totalSourcetypes} indexes have operational coverage`,
            ],
            confidence: avgConfidencePct,
            rawData: { operationalGaps, totalSourcetypes },
          })}>
            <MiniGauge value={operationalGaps} max={Math.max(totalSourcetypes, 1)} label="Ops" color="#f59e0b" />
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
