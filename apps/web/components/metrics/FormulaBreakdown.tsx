/**
 * P0.7: Formula Transparency UI
 *
 * Shows formula breakdown for any KPI when user clicks "ⓘ Explain"
 * Displays component values + calculations in modal
 */

import React, { useState } from 'react';

interface ComponentValue {
  label: string;
  value: number;
  weight: number;
  contribution: number; // value × weight
}

interface FormulaBreakdownProps {
  metricName: string;
  formula: string;
  components: ComponentValue[];
  result: number;
  precision?: number; // decimal places to show
  appliesTo?: string; // e.g., "Applies to Composite Score"
}

export const FormulaBreakdown: React.FC<FormulaBreakdownProps> = ({
  metricName,
  formula,
  components,
  result,
  precision = 1,
  appliesTo,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Calculate total contribution for reference
  const totalContribution = components.reduce((sum, c) => sum + c.contribution, 0);

  const formatNumber = (num: number, decimals: number = precision): string => {
    if (!Number.isFinite(num)) return 'Invalid';
    return num.toFixed(decimals);
  };

  return (
    <div className="formula-breakdown-container">
      {/* Trigger Button */}
      <button
        className="formula-explain-btn"
        onClick={() => setIsOpen(true)}
        title={`Explain ${metricName}`}
        aria-label={`Explain ${metricName}`}
      >
        ⓘ
      </button>

      {/* Modal Backdrop */}
      {isOpen && (
        <div className="modal-backdrop" onClick={() => setIsOpen(false)}>
          {/* Modal Content */}
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="modal-header">
              <h2>{metricName}</h2>
              <button
                className="close-btn"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Formula */}
            <div className="formula-section">
              <label>Formula:</label>
              <code className="formula-code">{formula}</code>
            </div>

            {/* Components Table */}
            <div className="components-section">
              <label>Components:</label>
              <table className="components-table">
                <tbody>
                  {components.map((component, index) => (
                    <tr key={index}>
                      <td className="label">{component.label}</td>
                      <td className="value">
                        {formatNumber(component.value)}
                      </td>
                      <td className="multiply">×</td>
                      <td className="weight">
                        {formatNumber(component.weight, 2)}
                      </td>
                      <td className="equals">=</td>
                      <td className="contribution">
                        {formatNumber(component.contribution)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Separator */}
              <div className="separator"></div>

              {/* Calculation */}
              <div className="calculation">
                <div className="calculation-row">
                  <span className="label">Calculation:</span>
                  <span className="formula-inline">
                    ({components
                      .map((c) => formatNumber(c.contribution))
                      .join(' + ')})
                  </span>
                </div>
                <div className="calculation-row">
                  <span className="label">Total:</span>
                  <span className="total">{formatNumber(totalContribution)}</span>
                </div>
                <div className="calculation-row">
                  <span className="label">Result:</span>
                  <span className="result">{formatNumber(result)} ✓</span>
                </div>
              </div>

              {/* Applies To */}
              {appliesTo && (
                <div className="applies-to">
                  <em>Applies to {appliesTo}</em>
                </div>
              )}
            </div>

            {/* Close Button */}
            <button className="close-modal-btn" onClick={() => setIsOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Styles */}
      <style jsx>{`
        .formula-breakdown-container {
          display: inline-block;
          position: relative;
        }

        .formula-explain-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 18px;
          padding: 4px 8px;
          color: #666;
          transition: color 0.2s;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;

          &:hover {
            background-color: #f0f0f0;
            color: #333;
          }

          &:focus {
            outline: 2px solid #4CAF50;
            outline-offset: 2px;
          }
        }

        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          max-width: 500px;
          width: 90%;
          max-height: 90vh;
          overflow-y: auto;
          padding: 24px;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #e0e0e0;
          padding-bottom: 12px;
        }

        .modal-header h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          color: #333;
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: #999;
          padding: 0;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;

          &:hover {
            color: #333;
          }
        }

        .formula-section {
          margin-bottom: 20px;
        }

        .formula-section label {
          display: block;
          font-weight: 600;
          margin-bottom: 8px;
          color: #333;
          font-size: 14px;
        }

        .formula-code {
          display: block;
          background-color: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 12px;
          font-size: 12px;
          font-family: 'Monaco', 'Courier New', monospace;
          overflow-x: auto;
          color: #333;
        }

        .components-section {
          margin-bottom: 20px;
        }

        .components-section label {
          display: block;
          font-weight: 600;
          margin-bottom: 12px;
          color: #333;
          font-size: 14px;
        }

        .components-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
          font-size: 13px;
        }

        .components-table tr {
          height: 28px;
        }

        .components-table td {
          padding: 4px 8px;
          text-align: right;
        }

        .components-table .label {
          text-align: left;
          color: #555;
          font-weight: 500;
        }

        .components-table .value {
          color: #4CAF50;
          font-weight: 600;
        }

        .components-table .weight {
          color: #666;
        }

        .components-table .multiply,
        .components-table .equals {
          color: #999;
          padding: 0 4px;
        }

        .components-table .contribution {
          color: #4CAF50;
          font-weight: 600;
          border-bottom: 1px dashed #ddd;
        }

        .separator {
          border-top: 1px solid #ddd;
          margin: 8px 0;
        }

        .calculation {
          background-color: #f9f9f9;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          padding: 12px;
          margin-bottom: 12px;
        }

        .calculation-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 13px;
        }

        .calculation-row .label {
          font-weight: 600;
          color: #333;
          min-width: 100px;
        }

        .calculation-row .formula-inline {
          color: #666;
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 12px;
        }

        .calculation-row .total {
          color: #666;
          font-weight: 500;
        }

        .calculation-row .result {
          color: #4CAF50;
          font-weight: 700;
          font-size: 14px;
        }

        .applies-to {
          margin-top: 12px;
          padding: 8px 12px;
          background-color: #e8f5e9;
          border-left: 3px solid #4CAF50;
          border-radius: 4px;
          font-size: 12px;
          color: #2e7d32;
        }

        .close-modal-btn {
          width: 100%;
          padding: 12px;
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s;

          &:hover {
            background-color: #45a049;
          }

          &:active {
            background-color: #3d8b40;
          }
        }

        @media (max-width: 600px) {
          .modal-content {
            width: 95%;
            padding: 16px;
          }

          .components-table {
            font-size: 12px;
          }

          .components-table td {
            padding: 2px 4px;
          }
        }
      `}</style>
    </div>
  );
};

/**
 * Helper hook to prepare formula data from API response
 */
export const useFormulaBreakdown = (metric: any) => {
  return {
    metricName: metric.name,
    formula: metric.formula,
    components: metric.components || [],
    result: metric.value,
    appliesTo: metric.appliesToMetric,
  };
};

/**
 * Example usage:
 *
 * const metricData = {
 *   name: 'ROI Score',
 *   formula: 'avg(composite_score)',
 *   value: 52.3,
 *   components: [
 *     { label: 'endpoint:edr', value: 97.0, weight: 1/3, contribution: 32.3 },
 *     { label: 'network:firewall', value: 32.2, weight: 1/3, contribution: 10.7 },
 *     { label: 'legacy:foo', value: 39.0, weight: 1/3, contribution: 13.0 },
 *   ],
 *   appliesToMetric: 'Composite Score',
 * };
 *
 * <FormulaBreakdown {...useFormulaBreakdown(metricData)} />
 */
