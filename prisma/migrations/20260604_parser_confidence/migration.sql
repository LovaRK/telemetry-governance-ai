-- Migration: 20260604_parser_confidence
-- Phase 9: Parser Confidence + SPL Explainability
-- APPEND-ONLY — never UPDATE rows; close + re-insert via validity_closed_at where history needed.

-- ─────────────────────────────────────────────────────────────────────────────
-- parser_confidence_audit
-- One row per (silver_row, spl_query, parser_version) audit run.
-- Records exactly which SPL fields resolved vs. failed, with a per-run confidence.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parser_confidence_audit (
  id                   TEXT        PRIMARY KEY,
  tenant_id            TEXT        NOT NULL,
  silver_id            TEXT        REFERENCES silver_normalized_telemetry(id) ON DELETE SET NULL,

  -- The SPL string that was parsed/analyzed
  spl_query            TEXT        NOT NULL,

  -- JSONB arrays of field resolution outcomes
  parsed_fields        JSONB       NOT NULL DEFAULT '[]',    -- [{name, type, resolved, confidence}]
  unresolved_fields    JSONB       NOT NULL DEFAULT '[]',    -- [{name, reason, raw_token}]

  -- Aggregate confidence 0.0–1.0
  confidence_score     REAL        NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),

  -- Versioned so replay can diff parser behaviour across releases
  parser_version       TEXT        NOT NULL DEFAULT '1.0',

  -- Human-readable summary of why fields failed to resolve
  unresolved_reason    TEXT,

  -- Splunk index name this audit is associated with (denormalized for fast tenant queries)
  index_name           TEXT,

  -- Number of unresolved fields (materialized for cheap filter/sort)
  unresolved_count     INTEGER     NOT NULL GENERATED ALWAYS AS (jsonb_array_length(unresolved_fields)) STORED,

  -- Timestamp
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS pca_tenant_idx
  ON parser_confidence_audit (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pca_silver_idx
  ON parser_confidence_audit (silver_id)
  WHERE silver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pca_index_name_idx
  ON parser_confidence_audit (tenant_id, index_name, created_at DESC)
  WHERE index_name IS NOT NULL;

-- Partial index for low-confidence runs (drives Data Quality SLO alerting)
CREATE INDEX IF NOT EXISTS pca_low_confidence_idx
  ON parser_confidence_audit (tenant_id, confidence_score, created_at DESC)
  WHERE confidence_score < 0.5;

-- ─────────────────────────────────────────────────────────────────────────────
-- parser_spl_field_registry
-- Canonical list of known Splunk fields per sourcetype, used to enrich
-- unresolved_fields with authoritative expected types.
-- Seeded with the most common Splunk CIM field set; extensible at runtime.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parser_spl_field_registry (
  id                   TEXT        PRIMARY KEY,
  sourcetype           TEXT        NOT NULL,                -- '*' means applies to all sourcetypes
  field_name           TEXT        NOT NULL,
  expected_type        TEXT        NOT NULL DEFAULT 'string', -- string | number | boolean | ip | timestamp | json
  is_cim_field         BOOLEAN     NOT NULL DEFAULT false,
  description          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (sourcetype, field_name)
);

-- Seed: Common CIM / Splunk core fields
INSERT INTO parser_spl_field_registry (id, sourcetype, field_name, expected_type, is_cim_field, description)
VALUES
  -- CIM Common Information Model fields (apply to all sourcetypes)
  ('psfr-001', '*', '_time',      'timestamp', true,  'Event timestamp'),
  ('psfr-002', '*', 'host',       'string',    true,  'Originating hostname'),
  ('psfr-003', '*', 'source',     'string',    true,  'Log source file or path'),
  ('psfr-004', '*', 'sourcetype', 'string',    true,  'Splunk sourcetype classification'),
  ('psfr-005', '*', 'index',      'string',    true,  'Splunk index name'),
  ('psfr-006', '*', 'eventtype',  'string',    true,  'Splunk eventtype tag'),
  ('psfr-007', '*', 'tag',        'string',    true,  'Splunk event tags'),
  -- Authentication data model
  ('psfr-010', 'access_combined', 'action',    'string', true, 'Authentication action'),
  ('psfr-011', 'access_combined', 'user',      'string', true, 'Authenticated user'),
  ('psfr-012', 'access_combined', 'src_ip',    'ip',     true, 'Source IP address'),
  ('psfr-013', 'access_combined', 'dest_ip',   'ip',     true, 'Destination IP address'),
  ('psfr-014', 'access_combined', 'status',    'number', true, 'HTTP status code'),
  -- Network traffic
  ('psfr-020', 'cisco_asa',   'src_ip',      'ip',     true, 'Source IP'),
  ('psfr-021', 'cisco_asa',   'dest_ip',     'ip',     true, 'Destination IP'),
  ('psfr-022', 'cisco_asa',   'dest_port',   'number', true, 'Destination port'),
  ('psfr-023', 'cisco_asa',   'bytes_in',    'number', true, 'Inbound bytes'),
  ('psfr-024', 'cisco_asa',   'bytes_out',   'number', true, 'Outbound bytes'),
  -- Windows Event Log
  ('psfr-030', 'WinEventLog',  'EventCode',   'number', false, 'Windows event code'),
  ('psfr-031', 'WinEventLog',  'ComputerName','string', false, 'Windows machine name'),
  ('psfr-032', 'WinEventLog',  'Account_Name','string', false, 'Windows account name'),
  ('psfr-033', 'WinEventLog',  'Logon_Type',  'number', false, 'Windows logon type'),
  -- Syslog
  ('psfr-040', 'syslog',       'severity',    'string', true, 'Syslog severity level'),
  ('psfr-041', 'syslog',       'facility',    'string', true, 'Syslog facility'),
  ('psfr-042', 'syslog',       'hostname',    'string', true, 'Syslog origin host'),
  -- AWS CloudTrail
  ('psfr-050', 'aws:cloudtrail', 'eventName',   'string', false, 'AWS API event name'),
  ('psfr-051', 'aws:cloudtrail', 'eventSource', 'string', false, 'AWS service source'),
  ('psfr-052', 'aws:cloudtrail', 'userIdentity.type', 'string', false, 'IAM identity type'),
  ('psfr-053', 'aws:cloudtrail', 'sourceIPAddress', 'ip', false, 'Caller source IP')
ON CONFLICT (sourcetype, field_name) DO NOTHING;

-- Index for fast sourcetype lookups
CREATE INDEX IF NOT EXISTS psfr_sourcetype_idx
  ON parser_spl_field_registry (sourcetype, field_name);
