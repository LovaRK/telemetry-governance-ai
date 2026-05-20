import './globals.css';
import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'datasensAI — Executive ROI Overview',
  description: 'Splunk telemetry intelligence: LLM-driven tier classification, cost optimization, and security gap analysis'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="container">{children}</div>
        </Providers>
      </body>
    </html>
  );
}