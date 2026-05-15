interface AgentSummaryProps {
  summary: {
    totalIndexes: number;
    anomaliesDetected: number;
    wasteIdentified: string;
    recommendationsGenerated: number;
  };
}

export default function AgentSummary({ summary }: AgentSummaryProps) {
  const items = [
    { label: 'Analyzed indexes', value: summary.totalIndexes },
    { label: 'Detected anomalies', value: summary.anomaliesDetected },
    { label: 'Identified waste', value: summary.wasteIdentified },
    { label: 'Generated recommendations', value: summary.recommendationsGenerated }
  ];

  return (
    <div style={{ margin: '2rem 0', padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px' }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1.125rem' }}>Agent Summary</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        {items.map((item, index) => (
          <div key={index} style={{ padding: '1rem', background: '#0a0a0a', borderRadius: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#3b82f6' }}>{item.value}</div>
            <div style={{ fontSize: '0.875rem', color: '#888', marginTop: '0.25rem' }}>{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}