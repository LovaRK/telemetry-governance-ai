'use client';

/**
 * Shared utilities for ExecutiveOverview sub-components.
 * Pure functions — no React, no side effects.
 */

export function fmt$(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  if (n >= 1) return `$${n.toFixed(0)}`;
  if (n > 0) return `$${n.toFixed(2)}`;
  return '$0';
}

export function fmtGB(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!isFinite(n) || n < 0.001) return '< 0.001 GB';
  if (n < 1) return `${(n * 1024).toFixed(1)} MB`;
  return `${n.toFixed(1)} GB`;
}

export const TIER_COLORS: Record<string, string> = {
  critical: '#ef4444',
  important: '#f59e0b',
  niceToHave: '#3b82f6',
  lowValue: '#64748b',
};

export const ACTION_COLORS: Record<string, string> = {
  KEEP: '#22c55e',
  OPTIMIZE: '#f59e0b',
  ARCHIVE: '#3b82f6',
  ELIMINATE: '#ef4444',
  INVESTIGATE: '#8b5cf6',
};

export const tierColor = (tier: string): string =>
  /critical/i.test(tier) ? '#ef4444' :
  /important/i.test(tier) ? '#f59e0b' :
  /nice/i.test(tier) ? '#3b82f6' : '#64748b';
