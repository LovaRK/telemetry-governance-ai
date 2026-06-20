import { fmt$, formatUsd } from '../../apps/web/components/dashboard/executive-overview/utils';

describe('fmt$ / formatUsd – magnitude-aware dollar formatter', () => {
  test('formatUsd is an alias for fmt$', () => {
    expect(formatUsd).toBe(fmt$);
  });

  test('millions', () => {
    expect(fmt$(2_500_000)).toBe('$2.5M');
    expect(fmt$(1_000_000)).toBe('$1.0M');
  });

  test('thousands', () => {
    expect(fmt$(9_999)).toBe('$10k');
    expect(fmt$(1_500)).toBe('$2k');
    expect(fmt$(1_000)).toBe('$1k');
  });

  test('whole dollars', () => {
    expect(fmt$(592)).toBe('$592');
    expect(fmt$(93)).toBe('$93');
    expect(fmt$(1)).toBe('$1');
  });

  test('sub-dollar (the $0k bug fix — $93.67 must NOT become $0k)', () => {
    expect(fmt$(93.67)).toBe('$94');
    expect(fmt$(0.50)).toBe('$0.50');
    expect(fmt$(0.01)).toBe('$0.01');
  });

  test('zero and negative edge cases', () => {
    expect(fmt$(0)).toBe('$0');
    expect(fmt$(-5)).toBe('$0');
  });

  test('accepts string, null, undefined', () => {
    expect(fmt$('592')).toBe('$592');
    expect(fmt$(null)).toBe('$0');
    expect(fmt$(undefined)).toBe('$0');
    expect(fmt$('garbage')).toBe('$0');
  });
});
