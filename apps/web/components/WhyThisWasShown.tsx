import { UIComponent } from '../lib/types';

interface WhyThisWasShownProps {
  components: UIComponent[];
}

export default function WhyThisWasShown({ components }: WhyThisWasShownProps) {
  const highPriorityComponent = components.find(c => c.priority === 'high' && c.reasoning);

  if (!highPriorityComponent) return null;

  return (
    <div style={{ margin: '2rem 0', padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px', border: '1px solid #3b82f6' }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1.125rem', color: '#3b82f6' }}>Why This Was Shown</h2>
      <div style={{ marginBottom: '1rem' }}>{highPriorityComponent.reasoning}</div>
      {highPriorityComponent.evidence && (
        <div style={{ fontSize: '0.875rem', color: '#888' }}>
          <strong>Evidence:</strong> {highPriorityComponent.evidence.join(' • ')}
        </div>
      )}
      {highPriorityComponent.source_queries && highPriorityComponent.source_queries.length > 0 && (
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#0a0a0a', borderRadius: '4px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          <strong>Source Query:</strong> {highPriorityComponent.source_queries[0]}
        </div>
      )}
    </div>
  );
}