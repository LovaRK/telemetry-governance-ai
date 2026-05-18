'use client';

import { TrustInspectionPanel } from './TrustInspectionPanel';

interface TrustInspectionModalProps {
  indexName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function TrustInspectionModal({ indexName, isOpen, onClose }: TrustInspectionModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          position: 'relative',
          width: '90%',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'sticky',
            top: 0,
            right: 0,
            padding: '12px 16px',
            backgroundColor: '#f5f5f5',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            float: 'right',
            zIndex: 10,
          }}
        >
          ✕
        </button>

        {/* Modal content */}
        <div style={{ padding: '24px', paddingTop: '12px' }}>
          <TrustInspectionPanel indexName={indexName} />
        </div>
      </div>
    </div>
  );
}
