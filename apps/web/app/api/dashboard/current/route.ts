import { NextRequest } from 'next/server';
import { GET as getExecutiveSummary } from '@/app/api/executive-summary/route';

/**
 * Canonical published dashboard read endpoint.
 * Reads current published snapshot via existing executive-summary route.
 */
export async function GET(request: NextRequest) {
  return getExecutiveSummary(request);
}

