import { UIComponent } from '../lib/types';

interface MetricCardProps {
  component: UIComponent;
  provenanceLabel?: string;
  provenanceColor?: string;
}

export default function MetricCard({ component, provenanceLabel, provenanceColor }: MetricCardProps) {
  const priorityColor = component.priority === 'high' ? '#ef4444' : component.priority === 'medium' ? '#f59e0b' : '#22c55e';

  return (
    <div style={{ padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px', border: `1px solid ${priorityColor}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div style={{ fontSize: '0.875rem', color: '#888' }}>{component.title}</div>
        {provenanceLabel && (
          <span style={{
            fontSize: '0.65rem',
            backgroundColor: provenanceColor,
            color: 'white',
            padding: '2px 8px',
            borderRadius: '12px',
            fontWeight: 500,
            whiteSpace: 'nowrap'
          }}>
            {provenanceLabel}
          </span>
        )}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 600 }}>{component.value}</div>
      {component.reasoning && (
        <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.5rem' }}>{component.reasoning}</div>
      )}
    </div>
  );
}