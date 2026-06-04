/**
 * P0.8: Data Provenance Labels
 *
 * Shows source, pipeline run ID, timestamp, and confidence on every metric
 * Provides data lineage transparency for executives
 */

import React, { useState } from 'react';

interface ProvenanceMetadata {
  sourceTable: string; // e.g., "scored_results", "executive_kpis"
  pipelineRunId: string; // e.g., "run_20260603_001"
  generatedAt: string; // ISO 8601 timestamp
  confidenceScore: number; // 0.0 to 1.0
  recordsIncluded?: number;
  recordsValidated?: number;
}

interface ProvenanceLabelProps {
  metadata: ProvenanceMetadata;
  compact?: boolean; // Show inline vs. tooltip
}

/**
 * Format relative time (e.g., "2 min ago")
 */
const formatRelativeTime = (timestamp: string): string => {
  try {
    const generated = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - generated.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay}d ago`;
  } catch {
    return 'Unknown';
  }
};

/**
 * Format timestamp to readable format
 */
const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp;
  }
};

/**
 * Format confidence as percentage
 */
const formatConfidence = (confidence: number): string => {
  if (!Number.isFinite(confidence)) return 'Unknown';
  const pct = Math.round(confidence * 100);
  return `${pct}%`;
};

/**
 * Get confidence color (green = high, yellow = medium, red = low)
 */
const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.8) return '#4CAF50'; // Green
  if (confidence >= 0.5) return '#FFC107'; // Yellow
  return '#f44336'; // Red
};

/**
 * Inline Provenance Label (compact)
 */
const InlineLabel: React.FC<ProvenanceLabelProps> = ({ metadata }) => {
  return (
    <div className="provenance-inline">
      <span className="provenance-icon">ℹ</span>
      <span className="provenance-text">
        Source: {metadata.sourceTable}
        <span className="separator">•</span>
        Generated: {formatRelativeTime(metadata.generatedAt)}
        <span className="separator">•</span>
        <span
          className="confidence-badge"
          style={{ backgroundColor: getConfidenceColor(metadata.confidenceScore) }}
        >
          {formatConfidence(metadata.confidenceScore)} Confidence
        </span>
      </span>
    </div>
  );
};

/**
 * Full Provenance Label with Tooltip
 */
const TooltipLabel: React.FC<ProvenanceLabelProps> = ({ metadata }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="provenance-wrapper">
      <button
        className="provenance-trigger"
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        title="Data lineage and confidence"
        aria-label="Data lineage and confidence"
      >
        ℹ
      </button>

      {isOpen && (
        <div className="provenance-tooltip">
          <div className="tooltip-header">
            <strong>Data Provenance</strong>
          </div>

          <div className="tooltip-row">
            <span className="label">Source Table:</span>
            <span className="value">{metadata.sourceTable}</span>
          </div>

          <div className="tooltip-row">
            <span className="label">Pipeline Run:</span>
            <code className="value run-id">{metadata.pipelineRunId}</code>
          </div>

          <div className="tooltip-row">
            <span className="label">Generated:</span>
            <span className="value">{formatTimestamp(metadata.generatedAt)}</span>
          </div>

          <div className="tooltip-row">
            <span className="label">Age:</span>
            <span className="value">{formatRelativeTime(metadata.generatedAt)}</span>
          </div>

          <div className="tooltip-row">
            <span className="label">Confidence:</span>
            <span
              className="value confidence"
              style={{ color: getConfidenceColor(metadata.confidenceScore) }}
            >
              {formatConfidence(metadata.confidenceScore)}
            </span>
          </div>

          {metadata.recordsValidated && metadata.recordsIncluded && (
            <div className="tooltip-row">
              <span className="label">Validation:</span>
              <span className="value">
                {metadata.recordsIncluded} / {metadata.recordsValidated} records
              </span>
            </div>
          )}

          <div className="tooltip-footer">
            <small>Data is traced from Splunk → Pipeline → Database → API → Display</small>
          </div>
        </div>
      )}

      <style jsx>{`
        .provenance-wrapper {
          display: inline-block;
          position: relative;
        }

        .provenance-trigger {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 14px;
          color: #999;
          padding: 2px 6px;
          border-radius: 3px;
          transition: all 0.2s;

          &:hover {
            color: #333;
            background-color: #f0f0f0;
          }

          &:focus {
            outline: 2px solid #4CAF50;
            outline-offset: 1px;
          }
        }

        .provenance-tooltip {
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          background: white;
          border: 1px solid #ddd;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          padding: 12px;
          min-width: 280px;
          font-size: 12px;
          z-index: 100;
          color: #333;

          &::after {
            content: '';
            position: absolute;
            bottom: -6px;
            right: 12px;
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 6px solid white;
            filter: drop-shadow(0 -1px 0 #ddd);
          }
        }

        .tooltip-header {
          border-bottom: 1px solid #eee;
          padding-bottom: 8px;
          margin-bottom: 8px;
          font-weight: 600;
        }

        .tooltip-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          align-items: flex-start;
        }

        .tooltip-row .label {
          font-weight: 500;
          color: #666;
          min-width: 110px;
        }

        .tooltip-row .value {
          text-align: right;
          flex: 1;
          color: #333;
          word-break: break-word;
        }

        .tooltip-row .run-id {
          font-family: 'Monaco', 'Courier New', monospace;
          background-color: #f5f5f5;
          padding: 2px 4px;
          border-radius: 2px;
          font-size: 11px;
        }

        .tooltip-row .confidence {
          font-weight: 600;
        }

        .tooltip-footer {
          border-top: 1px solid #eee;
          padding-top: 8px;
          margin-top: 8px;
          color: #999;
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
};

/**
 * Badge Component (embedded in metric cards)
 */
interface ProvenanceBadgeProps {
  metadata: ProvenanceMetadata;
  size?: 'small' | 'medium';
}

export const ProvenanceBadge: React.FC<ProvenanceBadgeProps> = ({
  metadata,
  size = 'small',
}) => {
  return (
    <div className={`provenance-badge size-${size}`}>
      <span className="source">{metadata.sourceTable}</span>
      <span className="separator">•</span>
      <span className="age">{formatRelativeTime(metadata.generatedAt)}</span>
      <span className="separator">•</span>
      <span
        className="confidence"
        style={{ color: getConfidenceColor(metadata.confidenceScore) }}
      >
        {formatConfidence(metadata.confidenceScore)}
      </span>

      <style jsx>{`
        .provenance-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #666;
          padding: 4px 8px;
          background-color: #f9f9f9;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          line-height: 1;
        }

        .provenance-badge.size-small {
          font-size: 10px;
          padding: 2px 6px;
        }

        .provenance-badge.size-medium {
          font-size: 12px;
          padding: 6px 10px;
        }

        .separator {
          color: #ddd;
        }

        .source {
          font-weight: 600;
          color: #333;
        }

        .age {
          color: #999;
        }

        .confidence {
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

/**
 * Main Export Component
 */
export const ProvenanceLabel: React.FC<ProvenanceLabelProps> = ({
  metadata,
  compact = false,
}) => {
  return compact ? (
    <InlineLabel metadata={metadata} />
  ) : (
    <TooltipLabel metadata={metadata} />
  );
};

export { formatRelativeTime, formatTimestamp, formatConfidence, getConfidenceColor };
