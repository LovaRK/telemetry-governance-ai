import { DashboardData, FormData } from './types';

export async function runPipeline(formData: FormData): Promise<DashboardData> {
  const response = await fetch('/api/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });

  if (!response.ok) {
    throw new Error('Pipeline failed');
  }

  return response.json();
}