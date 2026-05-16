'use client';

import React, { useState } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export default function Tooltip({ content, children, position = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  const positionStyles = {
    top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '8px' },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '8px' },
    left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: '8px' },
    right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: '8px' },
  };

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div style={{
          ...positionStyles[position],
          position: 'absolute',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          fontSize: '0.75rem',
          color: '#f8fafc',
          whiteSpace: 'pre-wrap',
          maxWidth: '280px',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          lineHeight: 1.5,
        }}>
          {content}
          <div style={{
            position: 'absolute',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '6px solid #334155',
            ...(position === 'top' ? { bottom: '-6px', left: '50%', transform: 'translateX(-50%)' } : {}),
            ...(position === 'bottom' ? { top: '-6px', left: '50%', transform: 'translateX(-50%)', borderTop: 'none', borderBottom: '6px solid #334155' } : {}),
          }} />
        </div>
      )}
    </div>
  );
}

export const TOOLTIPS = {
  roiScore: `ROI Score (0-100): How much money you can save.
• Based on: low-value index costs × optimization potential
• Calculation: LLM analyzes daily GB × retention × cost model
• Higher = more savings opportunity`,

  gainScopeScore: `GainScope Score (0-100): Potential value unlock.
• Based on: utilization + detection coverage + quality
• Calculation: weighted average of all index scores
• Higher = more room for improvement`,

  utilizationScore: `Utilization Score (0-100): How actively searched.
• Based on: search frequency, dashboard usage, alerts
• < 20% = likely candidates for archive/eliminate
• > 60% = actively used, keep priority`,

  detectionScore: `Detection Score (0-100): Security coverage.
• Based on: MITRE ATT&CK technique coverage
• Higher = better threat detection coverage
• Low = security gap requiring attention`,

  qualityScore: `Quality Score (0-100): Data health.
• Based on: parse errors, timestamp issues, field coverage
• < 50% = data quality problems need fixing
• > 80% = clean, well-structured data`,

  riskScore: `Risk Score (0-100): Operational risk level.
• Based on: unused high-cost indexes, orphan searches
• > 70 = critical - immediate action needed
• 30-70 = medium - plan optimization
• < 30 = low risk`,

  confidenceScore: `Confidence Score (0-1): How sure the LLM is.
• Based on: evidence quality, data completeness
• < 0.5 = low certainty - verify manually
• 0.5-0.7 = medium - review recommended
• > 0.7 = high confidence in decision`,

  tierCritical: `CRITICAL Tier: Essential operations.
• Characteristics: High utilization, security-focused, compliance required
• Actions: Keep, optimize retention if needed
• Check: Monthly usage trends`,

  tierImportant: `IMPORTANT Tier: Regular operations.
• Characteristics: Regular use, moderate value
• Actions: Keep, consider optimization
• Check: Quarterly cost review`,

  tierNiceToHave: `NICE-TO-HAVE Tier: Low priority.
• Characteristics: Occasional use, limited business impact
• Actions: Optimize retention, consider archive
• Check: Reduce retention to 30 days`,

  tierLowValue: `LOW-VALUE Tier: Waste candidates.
• Characteristics: Rarely/never used, high cost
• Actions: Eliminate, archive to S3, or reduce retention
• Check: Zero searches in last 30 days = eliminate`,

  savingsStaircase: `Savings Staircase: Cost reduction phases.
• Current Spend: Today's annual license cost
• After Ingest Actions: Reduce unnecessary data
• After Retention Tuning: Shorten old data
• After Archive: Move cold data to cheap storage
• Optimized Target: Final cost after all actions`,

  annualCost: `Annual License Cost: Daily GB × 365 × cost/GB.
• Uses your configured cost model (default $0.50/GB/day)
• Can be changed in Config panel
• Shows yearly cost per index/sourcetype`,

  estimatedSavings: `Estimated Savings: Potential cost reduction.
• ELIMINATE = full cost savings
• ARCHIVE = 70% savings (cold storage)
• OPTIMIZE = 40% savings (retention/field reduction)`,
};