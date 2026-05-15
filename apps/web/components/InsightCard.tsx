import { UIComponent } from '../lib/types';

interface InsightCardProps {
  component: UIComponent;
}

export default function InsightCard({ component }: InsightCardProps) {
  return (
    <div style={{ padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px', border: '1px solid #ef4444' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontWeight: 600 }}>{component.title}</span>
        <span style={{ padding: '0.25rem 0.5rem', background: '#ef4444', borderRadius: '4px', fontSize: '0.75rem' }}>HIGH</span>
      </div>
      <div style={{ fontSize: '0.875rem', color: '#ccc' }}>{component.reasoning}</div>
      {component.evidence && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#888' }}>
          <strong>Evidence:</strong> {component.evidence.join(', ')}
        </div>
      )}
    </div>
  );
}