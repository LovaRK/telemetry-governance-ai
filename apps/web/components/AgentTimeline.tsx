import { TimelineEvent } from '../lib/types';

interface AgentTimelineProps {
  events: TimelineEvent[];
}

export default function AgentTimeline({ events }: AgentTimelineProps) {
  return (
    <div style={{ margin: '2rem 0', padding: '1.5rem', background: '#1a1a1a', borderRadius: '8px' }}>
      <h2 style={{ marginBottom: '1rem', fontSize: '1.125rem' }}>Agentic Timeline</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {events.map((event, index) => (
          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem', borderLeft: '2px solid #3b82f6', paddingLeft: '1rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#888', minWidth: '80px' }}>
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
            <span style={{ fontWeight: 500 }}>{event.agent}</span>
            <span style={{ color: '#888', fontSize: '0.875rem' }}>{event.status}</span>
            <span style={{ fontSize: '0.75rem', color: '#666', marginLeft: 'auto' }}>{event.duration_ms}ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}