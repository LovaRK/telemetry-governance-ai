'use client';

import { UserProvider } from '@/lib/user-context';
import { ExplainabilityProvider } from '@/lib/explainability-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <ExplainabilityProvider>{children}</ExplainabilityProvider>
    </UserProvider>
  );
}
