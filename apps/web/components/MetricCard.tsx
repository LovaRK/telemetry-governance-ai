import { UIComponent } from '../lib/types';

interface MetricCardProps {
  component: UIComponent;
}

export default function MetricCard({ component }: MetricCardProps) {
  const priorityColor = component.priority === 'high' ? '#ef4444' : component.priority === 'medium' ? '#f59e0b' : '#22c55e';

  return (
    <div style={{ padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px', border: `1px solid ${priorityColor}` }}>
      <div style={{ fontSize: '0.875rem', color: '#888', marginBottom: '0.5rem' }}>{component.title}</div>
      <div style={{ fontSize: '2rem', fontWeight: 600 }}>{component.value}</div>
      {component.reasoning && (
        <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.5rem' }}>{component.reasoning}</div>
      )}
    </div>
  );
}