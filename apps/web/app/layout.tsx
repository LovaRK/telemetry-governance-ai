import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Aetheris Sentinel — Agentic Telemetry OS',
  description: 'Production-grade Splunk-native telemetry analytics with explainable AI, aggregated data caching, and decision traceability'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}