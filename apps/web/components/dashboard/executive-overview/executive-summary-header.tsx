'use client';

/**
 * ExecutiveSummaryHeader — D1 headline big numbers strip.
 * Pure visualization: receives all values as props, no data fetching.
 */

import React from 'react';
import { fmt$, fmtGB } from './utils';

interface ExecutiveSummaryHeaderProps {
  totalDailyGb: number;
  totalSourcetypes: number;
  totalLicenseSpend: number;
  storageSavingsPotential: number;
  securityGaps: number;
  operationalGaps: number;
}

export function ExecutiveSummaryHeader({
  totalDailyGb,
  totalSourcetypes,
  totalLicenseSpend,
  storageSavingsPotential,
  securityGaps,
  operationalGaps,
}: ExecutiveSummaryHeaderProps) {
  return (
    <div style={{
      display: 'flex', gap: '2rem', alignItems: 'center',
      padding: '1rem 1.5rem', background: '#0a1628',
      borderRadius: 10, border: '1px solid #1e293b', flexWrap: 'wrap'
    }}>
      <div>
        <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>
          {fmtGB(totalDailyGb)}
        </div>
        <div style={{
          fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase',
          letterSpacing: '0.06em', marginTop: '0.25rem'
        }}>
          Daily Ingest
        </div>
      </div>

      <Divider />

      <div>
        <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>
          {totalSourcetypes}
        </div>
        <div style={{
          fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase',
          letterSpacing: '0.06em', marginTop: '0.25rem'
        }}>
          Indexes
        </div>
      </div>

      <Divider />

      <div>
        <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>
          {fmt$(totalLicenseSpend)}
        </div>
        <div style={{
          fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase',
          letterSpacing: '0.06em', marginTop: '0.25rem'
        }}>
          Annual Spend
        </div>
      </div>

      <Divider />

      <div>
        <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#22c55e', lineHeight: 1 }}>
          {fmt$(storageSavingsPotential)}
        </div>
        <div style={{
          fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase',
          letterSpacing: '0.06em', marginTop: '0.25rem'
        }}>
          Savings Potential
        </div>
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem' }}>
        <GapBadge count={securityGaps} label="Sec. Gaps" critical />
        <GapBadge count={operationalGaps} label="Ops Gaps" />
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ color: '#1e293b', fontSize: '1.5rem', fontWeight: 300 }}>·</div>;
}

function GapBadge({ count, label, critical }: { count: number; label: string; critical?: boolean }) {
  const color = count > 0
    ? (critical ? '#ef4444' : '#f59e0b')
    : '#22c55e';

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, color }}>{count}</div>
      <div style={{
        fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em'
      }}>
        {label}
      </div>
    </div>
  );
}
