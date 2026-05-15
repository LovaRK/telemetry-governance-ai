interface EmptyStateProps {
  onRefresh: () => void;
  loading: boolean;
}

export default function EmptyState({ onRefresh, loading }: EmptyStateProps) {
  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      color: '#94a3b8',
      textAlign: 'center',
      border: '1px solid #1e293b',
      borderRadius: 12,
      background: '#0f172a',
      padding: '2rem',
    }}>
      <h2 style={{ color: '#f8fafc', marginBottom: 8 }}>No Telemetry Data</h2>
      <p style={{ marginBottom: 16 }}>
        Fetch aggregated data from Splunk to begin analysis
      </p>
      <button
        onClick={onRefresh}
        disabled={loading}
        style={{
          padding: '10px 16px',
          background: loading ? '#1e293b' : '#3b82f6',
          borderRadius: 8,
          color: '#fff',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? 'Refreshing...' : 'Refresh from Splunk'}
      </button>
    </div>
  );
}