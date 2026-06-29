import { useEffect, useRef, useState } from 'react';

interface Props {
  logs: string[];
}

export function LogViewer({ logs }: Props) {
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, expanded]);

  return (
    <div className="log-viewer">
      <button className="log-toggle" onClick={() => setExpanded(e => !e)}>
        {expanded ? '▲ Hide install log' : '▼ Show install log'}
      </button>
      {expanded && (
        <div className="log-body">
          {logs.map((line, i) => (
            <div key={i} className={`log-line ${getLineClass(line)}`}>{line}</div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function getLineClass(line: string): string {
  if (/\[OK\]|\[ok\]|✓/.test(line))   return 'ok';
  if (/\[!\]|WARN|warn/.test(line))    return 'warn';
  if (/ERROR|error|fatal|FATAL/.test(line)) return 'error';
  return '';
}
