--
-- PostgreSQL database dump
--

\restrict F8TqeJq8OeQtaIvTT0EDDiUj5wGidbSDSPY8xXRaaAwRJf5spd1wv0CjxtGyfZ2

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: recommendation_status; Type: TYPE; Schema: public; Owner: telemetry
--

CREATE TYPE public.recommendation_status AS ENUM (
    'NEW',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'DEFERRED',
    'ESCALATED',
    'IMPLEMENTED',
    'ROLLED_BACK'
);


ALTER TYPE public.recommendation_status OWNER TO telemetry;

--
-- Name: generate_event_id(); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.generate_event_id() RETURNS character varying
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN 'evt_' || SUBSTR(gen_random_uuid()::text, 1, 12) ||
         SUBSTR(gen_random_uuid()::text, 1, 16);
END;
$$;


ALTER FUNCTION public.generate_event_id() OWNER TO telemetry;

--
-- Name: get_active_signing_key(uuid); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.get_active_signing_key(p_tenant_id uuid) RETURNS TABLE(key_id uuid, key_material_encrypted bytea, key_algorithm character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT k.key_id, k.key_material_encrypted, k.key_algorithm
  FROM envelope_signing_keys k
  WHERE k.tenant_id = p_tenant_id
    AND k.is_active = true
    AND k.can_sign = true
    AND k.retired_at IS NULL
  LIMIT 1;
END;
$$;


ALTER FUNCTION public.get_active_signing_key(p_tenant_id uuid) OWNER TO telemetry;

--
-- Name: get_or_create_tenant(character varying, character varying); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.get_or_create_tenant(p_name character varying, p_slug character varying) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Try to get existing tenant
    SELECT id INTO v_tenant_id FROM tenants WHERE slug = p_slug;

    IF v_tenant_id IS NULL THEN
        -- Create new tenant
        INSERT INTO tenants (name, slug) VALUES (p_name, p_slug)
        RETURNING id INTO v_tenant_id;
    END IF;

    RETURN v_tenant_id;
END;
$$;


ALTER FUNCTION public.get_or_create_tenant(p_name character varying, p_slug character varying) OWNER TO telemetry;

--
-- Name: get_verification_keys(uuid); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.get_verification_keys(p_tenant_id uuid) RETURNS TABLE(key_id uuid, key_material_encrypted bytea, key_algorithm character varying)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT k.key_id, k.key_material_encrypted, k.key_algorithm
  FROM envelope_signing_keys k
  WHERE k.tenant_id = p_tenant_id
    AND k.can_verify = true
    AND k.key_algorithm = 'HMAC_SHA256_V1'
    AND (k.retired_at IS NULL OR k.retired_at > NOW())
  ORDER BY k.is_active DESC, k.activated_at DESC;
END;
$$;


ALTER FUNCTION public.get_verification_keys(p_tenant_id uuid) OWNER TO telemetry;

--
-- Name: log_tenant_action(uuid, uuid, character varying, character varying, character varying, jsonb, inet); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.log_tenant_action(p_tenant_id uuid, p_user_id uuid, p_action character varying, p_resource_type character varying DEFAULT NULL::character varying, p_resource_id character varying DEFAULT NULL::character varying, p_changes jsonb DEFAULT NULL::jsonb, p_ip_address inet DEFAULT NULL::inet) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO tenant_audit_log (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (p_tenant_id, p_user_id, p_action, p_resource_type, p_resource_id, p_changes, p_ip_address)
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;


ALTER FUNCTION public.log_tenant_action(p_tenant_id uuid, p_user_id uuid, p_action character varying, p_resource_type character varying, p_resource_id character varying, p_changes jsonb, p_ip_address inet) OWNER TO telemetry;

--
-- Name: rotate_envelope_signing_key(uuid, bytea, character varying); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.rotate_envelope_signing_key(p_tenant_id uuid, p_new_key_material_encrypted bytea, p_rotation_reason character varying DEFAULT 'SCHEDULED'::character varying) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_old_key_id UUID;
  v_new_key_id UUID;
  v_retirement_grace_days INT := 30; -- Allow verification of old key for 30 days post-rotation
BEGIN
  -- 1. Retire active key (keep it for verification for grace period)
  UPDATE envelope_signing_keys
  SET is_active = false,
      can_sign = false,
      retired_at = NOW() + INTERVAL '1 day' * v_retirement_grace_days,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id AND is_active = true RETURNING key_id INTO v_old_key_id;

  -- 2. Create new active key
  INSERT INTO envelope_signing_keys (
    tenant_id, key_material_encrypted, key_algorithm,
    is_active, activated_at, can_sign, can_verify,
    rotation_reason
  ) VALUES (
    p_tenant_id, p_new_key_material_encrypted, 'HMAC_SHA256_V1',
    true, NOW(), true, true,
    p_rotation_reason
  ) RETURNING key_id INTO v_new_key_id;

  -- 3. Log key rotation event
  INSERT INTO audit_log (tenant_id, action, details, created_at)
  VALUES (p_tenant_id, 'KEY_ROTATED',
    jsonb_build_object(
      'old_key_id', v_old_key_id,
      'new_key_id', v_new_key_id,
      'reason', p_rotation_reason,
      'grace_period_days', v_retirement_grace_days
    ), NOW());

  RETURN v_new_key_id;
END;
$$;


ALTER FUNCTION public.rotate_envelope_signing_key(p_tenant_id uuid, p_new_key_material_encrypted bytea, p_rotation_reason character varying) OWNER TO telemetry;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO telemetry;

--
-- Name: validate_event_sequence(); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.validate_event_sequence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  max_seq INT;
BEGIN
  -- Get the max sequence for this execution (excluding current row if update)
  SELECT COALESCE(MAX(sequence), -1) INTO max_seq
  FROM pipeline_events
  WHERE execution_id = NEW.execution_id
    AND id != COALESCE(OLD.id, -1);

  -- New sequence must be > previous max
  IF NEW.sequence <= max_seq THEN
    RAISE EXCEPTION 'Event sequence must be monotonically increasing (last=%, new=%)', max_seq, NEW.sequence;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.validate_event_sequence() OWNER TO telemetry;

--
-- Name: verify_session(character varying); Type: FUNCTION; Schema: public; Owner: telemetry
--

CREATE FUNCTION public.verify_session(p_token character varying) RETURNS TABLE(session_id uuid, user_id uuid, tenant_id uuid, email character varying, role character varying, is_valid boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        us.id,
        u.id,
        u.tenant_id,
        u.email,
        u.role,
        (us.expires_at > NOW() AND NOT us.is_revoked AND NOT u.is_locked)::BOOLEAN
    FROM user_sessions us
    JOIN users u ON us.user_id = u.id
    WHERE us.token = p_token;
END;
$$;


ALTER FUNCTION public.verify_session(p_token character varying) OWNER TO telemetry;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_decisions; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.agent_decisions (
    id integer NOT NULL,
    snapshot_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    index_name character varying(200) NOT NULL,
    sourcetype character varying(200),
    tier character varying(50),
    action character varying(30),
    composite_score numeric(5,2) DEFAULT 0,
    utilization_score numeric(5,2) DEFAULT 0,
    detection_score numeric(5,2) DEFAULT 0,
    quality_score numeric(5,2) DEFAULT 0,
    risk_score numeric(5,2) DEFAULT 0,
    annual_license_cost numeric(14,2) DEFAULT 0,
    estimated_savings numeric(14,2) DEFAULT 0,
    confidence numeric(5,4) DEFAULT 0,
    confidence_score numeric(5,2) DEFAULT 0,
    recommendation text,
    reasoning text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_quick_win boolean DEFAULT false,
    is_s3_candidate boolean DEFAULT false,
    detection_gap boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    candidate_reason text[] DEFAULT '{}'::text[],
    metadata_fingerprint character varying(64),
    llm_version character varying(50),
    prompt_version character varying(50),
    model_version character varying(50),
    heuristic_version character varying(50),
    source_checksum character varying(64),
    last_llm_processed_at timestamp with time zone,
    decision_stability_score numeric(5,2) DEFAULT 50,
    processing_status character varying(30) DEFAULT 'unchanged'::character varying,
    candidate_reasons jsonb DEFAULT '[]'::jsonb,
    tenant_id uuid
);


ALTER TABLE public.agent_decisions OWNER TO telemetry;

--
-- Name: agent_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.agent_decisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agent_decisions_id_seq OWNER TO telemetry;

--
-- Name: agent_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.agent_decisions_id_seq OWNED BY public.agent_decisions.id;


--
-- Name: applied_migrations; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.applied_migrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    checksum character varying(64) NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    execution_time_ms integer DEFAULT 0 NOT NULL,
    status character varying(20) NOT NULL,
    CONSTRAINT applied_migrations_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying, 'rolled_back'::character varying])::text[])))
);


ALTER TABLE public.applied_migrations OWNER TO telemetry;

--
-- Name: applied_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.applied_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.applied_migrations_id_seq OWNER TO telemetry;

--
-- Name: applied_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.applied_migrations_id_seq OWNED BY public.applied_migrations.id;


--
-- Name: cognitive_enrichments; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.cognitive_enrichments (
    enrichment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    fact_id uuid NOT NULL,
    ai_model_signature character varying(100) NOT NULL,
    prompt_version_hash character varying(64) NOT NULL,
    inference_tokens integer,
    latency_ms integer,
    confidence_score numeric(3,2) NOT NULL,
    risk_category character varying(50) NOT NULL,
    strategic_rationale text NOT NULL,
    remediation_suggestion text NOT NULL,
    generated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cognitive_enrichments_confidence_score_check CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric)))
);


ALTER TABLE public.cognitive_enrichments OWNER TO telemetry;

--
-- Name: decision_drift_history; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.decision_drift_history (
    drift_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    previous_fingerprint character varying(64) NOT NULL,
    new_fingerprint character varying(64) NOT NULL,
    volume_drift_pct numeric(7,2) NOT NULL,
    utilization_delta_pct numeric(5,2) NOT NULL,
    retention_changed boolean NOT NULL,
    freshness_changed boolean NOT NULL,
    drift_severity character varying(30) NOT NULL,
    drift_reason character varying(255) NOT NULL,
    confidence_penalty_applied numeric(3,2) DEFAULT 1.00 NOT NULL,
    approvals_invalidated boolean DEFAULT false NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT decision_drift_history_confidence_penalty_applied_check CHECK (((confidence_penalty_applied >= (0)::numeric) AND (confidence_penalty_applied <= (1)::numeric))),
    CONSTRAINT decision_drift_history_drift_severity_check CHECK (((drift_severity)::text = ANY ((ARRAY['STABLE'::character varying, 'NOISE'::character varying, 'METRIC_DRIFT'::character varying, 'SEMANTIC_DRIFT'::character varying, 'POLICY_DRIFT'::character varying])::text[])))
);


ALTER TABLE public.decision_drift_history OWNER TO telemetry;

--
-- Name: human_review_ledger; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.human_review_ledger (
    review_id uuid DEFAULT gen_random_uuid() NOT NULL,
    fact_id uuid NOT NULL,
    enrichment_id uuid NOT NULL,
    reviewed_by character varying(255) NOT NULL,
    reviewed_at timestamp with time zone DEFAULT now(),
    review_action character varying(50) NOT NULL,
    admin_notes text,
    is_disagreement boolean GENERATED ALWAYS AS (((review_action)::text = ANY ((ARRAY['REJECTED'::character varying, 'ESCALATED'::character varying])::text[]))) STORED,
    CONSTRAINT human_review_ledger_review_action_check CHECK (((review_action)::text = ANY ((ARRAY['APPROVED'::character varying, 'REJECTED'::character varying, 'ESCALATED'::character varying, 'CONDITIONAL'::character varying, 'UNDER_INVESTIGATION'::character varying])::text[])))
);


ALTER TABLE public.human_review_ledger OWNER TO telemetry;

--
-- Name: index_rolling_baselines; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.index_rolling_baselines (
    index_name character varying(255) NOT NULL,
    consecutive_clean_snapshots integer DEFAULT 0 NOT NULL,
    historical_drift_count integer DEFAULT 0 NOT NULL,
    recovery_cooldown_until timestamp with time zone DEFAULT now(),
    last_updated timestamp with time zone DEFAULT now(),
    recovery_score numeric(3,2) DEFAULT 0.00 NOT NULL,
    consecutive_stable_days integer DEFAULT 0 NOT NULL,
    last_evaluated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT index_rolling_baselines_consecutive_stable_days_check CHECK ((consecutive_stable_days >= 0)),
    CONSTRAINT index_rolling_baselines_recovery_score_check CHECK (((recovery_score >= 0.00) AND (recovery_score <= 1.00)))
);


ALTER TABLE public.index_rolling_baselines OWNER TO telemetry;

--
-- Name: telemetry_facts; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.telemetry_facts (
    fact_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    snapshot_timestamp timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    daily_avg_gb numeric(12,4) NOT NULL,
    utilization_pct numeric(5,2) NOT NULL,
    retention_days integer NOT NULL,
    storage_cost_per_gb_mo numeric(10,2) NOT NULL,
    days_since_last_event integer DEFAULT 0 NOT NULL,
    calculated_daily_waste_gb numeric(12,4) GENERATED ALWAYS AS ((daily_avg_gb * (1.0 - (utilization_pct / 100.0)))) STORED,
    calculated_monthly_waste_gb numeric(12,4) GENERATED ALWAYS AS (((daily_avg_gb * 30.0) * (1.0 - (utilization_pct / 100.0)))) STORED,
    calculated_monthly_loss_usd numeric(12,2) GENERATED ALWAYS AS ((((daily_avg_gb * 30.0) * (1.0 - (utilization_pct / 100.0))) * storage_cost_per_gb_mo)) STORED,
    calculated_annual_loss_usd numeric(12,2) GENERATED ALWAYS AS (((((daily_avg_gb * 30.0) * (1.0 - (utilization_pct / 100.0))) * storage_cost_per_gb_mo) * (12)::numeric)) STORED,
    CONSTRAINT telemetry_facts_daily_avg_gb_check CHECK ((daily_avg_gb >= (0)::numeric)),
    CONSTRAINT telemetry_facts_days_since_last_event_check CHECK ((days_since_last_event >= 0)),
    CONSTRAINT telemetry_facts_retention_days_check CHECK ((retention_days > 0)),
    CONSTRAINT telemetry_facts_storage_cost_per_gb_mo_check CHECK ((storage_cost_per_gb_mo >= (0)::numeric)),
    CONSTRAINT telemetry_facts_utilization_pct_check CHECK (((utilization_pct >= (0)::numeric) AND (utilization_pct <= (100)::numeric)))
);


ALTER TABLE public.telemetry_facts OWNER TO telemetry;

--
-- Name: bidirectional_confidence_analysis; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.bidirectional_confidence_analysis AS
 SELECT f.index_name,
    f.calculated_monthly_loss_usd AS provable_loss_usd,
    e.confidence_score AS base_confidence,
    d.drift_severity AS drift_status,
    d.confidence_penalty_applied AS drift_penalty,
    r.review_action AS human_review_status,
    b.consecutive_stable_days,
    b.recovery_score,
        CASE
            WHEN (b.consecutive_stable_days >= 30) THEN
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.60
                ELSE 0.40
            END
            WHEN (b.consecutive_stable_days >= 14) THEN 0.20
            WHEN (b.consecutive_stable_days >= 7) THEN 0.10
            ELSE 0.00
        END AS calculated_recovery_factor,
        CASE
            WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
            WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
            ELSE 0.5
        END AS approval_multiplier,
    round((((e.confidence_score *
        CASE
            WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
            WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
            ELSE 0.5
        END) * 0.6) + (
        CASE
            WHEN (b.consecutive_stable_days >= 30) THEN
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.60
                ELSE 0.40
            END
            WHEN (b.consecutive_stable_days >= 14) THEN 0.20
            WHEN (b.consecutive_stable_days >= 7) THEN 0.10
            ELSE 0.00
        END * 0.4)), 2) AS blended_trust,
    round(((((e.confidence_score *
        CASE
            WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
            WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
            ELSE 0.5
        END) * 0.6) + (
        CASE
            WHEN (b.consecutive_stable_days >= 30) THEN
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.60
                ELSE 0.40
            END
            WHEN (b.consecutive_stable_days >= 14) THEN 0.20
            WHEN (b.consecutive_stable_days >= 7) THEN 0.10
            ELSE 0.00
        END * 0.4)) * d.confidence_penalty_applied), 2) AS raw_bidirectional_score,
        CASE
            WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.95
            WHEN ((r.review_action)::text = 'CONDITIONAL'::text) THEN 0.75
            WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.00
            ELSE 0.50
        END AS governance_cap,
    round(LEAST(GREATEST(((((e.confidence_score *
        CASE
            WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
            WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
            ELSE 0.5
        END) * 0.6) + (
        CASE
            WHEN (b.consecutive_stable_days >= 30) THEN
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.60
                ELSE 0.40
            END
            WHEN (b.consecutive_stable_days >= 14) THEN 0.20
            WHEN (b.consecutive_stable_days >= 7) THEN 0.10
            ELSE 0.00
        END * 0.4)) * d.confidence_penalty_applied), 0.00),
        CASE
            WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.95
            WHEN ((r.review_action)::text = 'CONDITIONAL'::text) THEN 0.75
            WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.00
            ELSE 0.50
        END), 2) AS final_effective_confidence,
        CASE
            WHEN (round(LEAST(GREATEST(((((e.confidence_score *
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
                WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
                ELSE 0.5
            END) * 0.6) + (
            CASE
                WHEN (b.consecutive_stable_days >= 30) THEN
                CASE
                    WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.60
                    ELSE 0.40
                END
                WHEN (b.consecutive_stable_days >= 14) THEN 0.20
                WHEN (b.consecutive_stable_days >= 7) THEN 0.10
                ELSE 0.00
            END * 0.4)) * d.confidence_penalty_applied), 0.00),
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.95
                WHEN ((r.review_action)::text = 'CONDITIONAL'::text) THEN 0.75
                WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.00
                ELSE 0.50
            END), 2) >= 0.85) THEN 'TRUSTED'::text
            WHEN (round(LEAST(GREATEST(((((e.confidence_score *
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
                WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
                ELSE 0.5
            END) * 0.6) + (
            CASE
                WHEN (b.consecutive_stable_days >= 30) THEN
                CASE
                    WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.60
                    ELSE 0.40
                END
                WHEN (b.consecutive_stable_days >= 14) THEN 0.20
                WHEN (b.consecutive_stable_days >= 7) THEN 0.10
                ELSE 0.00
            END * 0.4)) * d.confidence_penalty_applied), 0.00),
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.95
                WHEN ((r.review_action)::text = 'CONDITIONAL'::text) THEN 0.75
                WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.00
                ELSE 0.50
            END), 2) >= 0.60) THEN 'RELIABLE'::text
            WHEN (round(LEAST(GREATEST(((((e.confidence_score *
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
                WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
                ELSE 0.5
            END) * 0.6) + (
            CASE
                WHEN (b.consecutive_stable_days >= 30) THEN
                CASE
                    WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.60
                    ELSE 0.40
                END
                WHEN (b.consecutive_stable_days >= 14) THEN 0.20
                WHEN (b.consecutive_stable_days >= 7) THEN 0.10
                ELSE 0.00
            END * 0.4)) * d.confidence_penalty_applied), 0.00),
            CASE
                WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 0.95
                WHEN ((r.review_action)::text = 'CONDITIONAL'::text) THEN 0.75
                WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.00
                ELSE 0.50
            END), 2) >= 0.30) THEN 'CAUTION'::text
            ELSE 'UNRELIABLE'::text
        END AS confidence_band,
    f.created_at AS fact_created_at,
    r.reviewed_at AS last_review_at
   FROM ((((public.telemetry_facts f
     LEFT JOIN public.cognitive_enrichments e ON ((f.fact_id = e.fact_id)))
     LEFT JOIN public.decision_drift_history d ON ((((f.index_name)::text = (d.index_name)::text) AND (d.evaluated_at = ( SELECT max(decision_drift_history.evaluated_at) AS max
           FROM public.decision_drift_history
          WHERE ((decision_drift_history.index_name)::text = (f.index_name)::text))))))
     LEFT JOIN public.human_review_ledger r ON (((f.fact_id = r.fact_id) AND (r.reviewed_at = ( SELECT max(human_review_ledger.reviewed_at) AS max
           FROM public.human_review_ledger
          WHERE (human_review_ledger.fact_id = f.fact_id))))))
     LEFT JOIN public.index_rolling_baselines b ON (((f.index_name)::text = (b.index_name)::text)));


ALTER VIEW public.bidirectional_confidence_analysis OWNER TO telemetry;

--
-- Name: cache_coherence_telemetry; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.cache_coherence_telemetry (
    coherence_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    mutation_committed_at timestamp with time zone NOT NULL,
    invalidation_requested_at timestamp with time zone,
    server_response_received_at timestamp with time zone,
    ui_refetch_initiated_at timestamp with time zone,
    ui_acknowledged_at timestamp with time zone,
    server_commit_to_invalidation_ms integer,
    invalidation_to_client_awareness_ms integer,
    client_awareness_to_refetch_ms integer,
    refetch_to_ui_reconciliation_ms integer,
    total_divergence_window_ms integer,
    is_divergent boolean DEFAULT false,
    invalidation_failed boolean DEFAULT false,
    refetch_failed boolean DEFAULT false,
    ui_still_stale boolean DEFAULT false,
    correlation_id character varying(64) NOT NULL,
    recorded_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.cache_coherence_telemetry OWNER TO telemetry;

--
-- Name: cache_coherence_health; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.cache_coherence_health AS
 SELECT index_name,
    count(*) AS coherence_events,
    avg(total_divergence_window_ms) AS avg_divergence_window_ms,
    max(total_divergence_window_ms) AS max_divergence_window_ms,
    sum(
        CASE
            WHEN is_divergent THEN 1
            ELSE 0
        END) AS divergent_events,
    sum(
        CASE
            WHEN invalidation_failed THEN 1
            ELSE 0
        END) AS invalidation_failures,
    sum(
        CASE
            WHEN refetch_failed THEN 1
            ELSE 0
        END) AS refetch_failures,
    sum(
        CASE
            WHEN ui_still_stale THEN 1
            ELSE 0
        END) AS stale_ui_events,
    round(((100.0 * (sum(
        CASE
            WHEN is_divergent THEN 1
            ELSE 0
        END))::numeric) / (count(*))::numeric), 2) AS divergence_rate_pct,
    max(recorded_at) AS last_event
   FROM public.cache_coherence_telemetry
  WHERE (recorded_at > (now() - '24:00:00'::interval))
  GROUP BY index_name
  ORDER BY (round(((100.0 * (sum(
        CASE
            WHEN is_divergent THEN 1
            ELSE 0
        END))::numeric) / (count(*))::numeric), 2)) DESC;


ALTER VIEW public.cache_coherence_health OWNER TO telemetry;

--
-- Name: cache_metadata; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.cache_metadata (
    id integer NOT NULL,
    cache_key character varying(100) NOT NULL,
    last_refresh_at timestamp with time zone,
    next_refresh_at timestamp with time zone,
    status character varying(20) NOT NULL,
    record_count integer DEFAULT 0 NOT NULL,
    source_type character varying(50) DEFAULT 'splunk'::character varying NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cache_metadata_status_check CHECK (((status)::text = ANY ((ARRAY['fresh'::character varying, 'stale'::character varying, 'refreshing'::character varying, 'error'::character varying, 'fast_complete'::character varying])::text[])))
);


ALTER TABLE public.cache_metadata OWNER TO telemetry;

--
-- Name: cache_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.cache_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cache_metadata_id_seq OWNER TO telemetry;

--
-- Name: cache_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.cache_metadata_id_seq OWNED BY public.cache_metadata.id;


--
-- Name: confidence_bands_reference; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.confidence_bands_reference AS
 SELECT 'UNRELIABLE'::text AS band_name,
    0.00 AS min_threshold,
    0.29 AS max_threshold,
    'Active semantic drift or blacklisted state'::text AS operational_meaning,
    'Automatically freezes cache inheritance; forces immediate reanalysis'::text AS control_plane_behavior
UNION ALL
 SELECT 'CAUTION'::text AS band_name,
    0.30 AS min_threshold,
    0.59 AS max_threshold,
    'Experiencing mild metric drift or baseline decay'::text AS operational_meaning,
    'Flags warnings inside inspection log; entry priority rises in audit queues'::text AS control_plane_behavior
UNION ALL
 SELECT 'RELIABLE'::text AS band_name,
    0.60 AS min_threshold,
    0.84 AS max_threshold,
    'Recovering or unreviewed but highly consistent'::text AS operational_meaning,
    'Stable state; allowed to auto-recycle fingerprints without triggering manual alerts'::text AS control_plane_behavior
UNION ALL
 SELECT 'TRUSTED'::text AS band_name,
    0.85 AS min_threshold,
    0.95 AS max_threshold,
    'Verified, highly stable baseline'::text AS operational_meaning,
    'Bypasses standard daily drift loops; evaluated on low-priority weekly track'::text AS control_plane_behavior
  ORDER BY 2;


ALTER VIEW public.confidence_bands_reference OWNER TO telemetry;

--
-- Name: confidence_calibration_log; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.confidence_calibration_log (
    log_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    base_confidence numeric(3,2) NOT NULL,
    drift_penalty numeric(3,2) NOT NULL,
    temporal_decay numeric(3,2) NOT NULL,
    recovery_score numeric(3,2) NOT NULL,
    approval_state character varying(50) NOT NULL,
    consecutive_stable_days integer NOT NULL,
    raw_effective numeric(3,2) NOT NULL,
    governance_cap numeric(3,2) NOT NULL,
    final_effective numeric(3,2) NOT NULL,
    is_capped boolean NOT NULL,
    confidence_band character varying(20) NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT confidence_calibration_log_approval_state_check CHECK (((approval_state)::text = ANY ((ARRAY['APPROVED'::character varying, 'CONDITIONAL'::character varying, 'PROPOSED'::character varying, 'REJECTED'::character varying])::text[]))),
    CONSTRAINT confidence_calibration_log_base_confidence_check CHECK (((base_confidence >= (0)::numeric) AND (base_confidence <= (1)::numeric))),
    CONSTRAINT confidence_calibration_log_confidence_band_check CHECK (((confidence_band)::text = ANY ((ARRAY['UNRELIABLE'::character varying, 'CAUTION'::character varying, 'RELIABLE'::character varying, 'TRUSTED'::character varying])::text[]))),
    CONSTRAINT confidence_calibration_log_consecutive_stable_days_check CHECK ((consecutive_stable_days >= 0)),
    CONSTRAINT confidence_calibration_log_drift_penalty_check CHECK (((drift_penalty >= (0)::numeric) AND (drift_penalty <= (1)::numeric))),
    CONSTRAINT confidence_calibration_log_final_effective_check CHECK (((final_effective >= (0)::numeric) AND (final_effective <= (1)::numeric))),
    CONSTRAINT confidence_calibration_log_recovery_score_check CHECK (((recovery_score >= (0)::numeric) AND (recovery_score <= (1)::numeric))),
    CONSTRAINT confidence_calibration_log_temporal_decay_check CHECK (((temporal_decay >= (0)::numeric) AND (temporal_decay <= (1)::numeric)))
);


ALTER TABLE public.confidence_calibration_log OWNER TO telemetry;

--
-- Name: config_audit_log; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.config_audit_log (
    id integer NOT NULL,
    config_key character varying(100) NOT NULL,
    change_type character varying(50) NOT NULL,
    old_value jsonb,
    new_value jsonb NOT NULL,
    changed_by character varying(256),
    change_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.config_audit_log OWNER TO telemetry;

--
-- Name: config_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.config_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.config_audit_log_id_seq OWNER TO telemetry;

--
-- Name: config_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.config_audit_log_id_seq OWNED BY public.config_audit_log.id;


--
-- Name: pipeline_events; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.pipeline_events (
    id bigint NOT NULL,
    event_id character varying(64) NOT NULL,
    execution_id uuid NOT NULL,
    sequence integer NOT NULL,
    correlation_id uuid NOT NULL,
    trace_parent character varying(255),
    actor character varying(128),
    operator_session_id character varying(255),
    event_type character varying(64) NOT NULL,
    taxonomy character varying(32) NOT NULL,
    severity character varying(16) DEFAULT 'INFO'::character varying NOT NULL,
    message text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload_version character varying(16) DEFAULT '1.0'::character varying,
    governance jsonb DEFAULT '{}'::jsonb,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipeline_events_severity_check CHECK (((severity)::text = ANY ((ARRAY['DEBUG'::character varying, 'INFO'::character varying, 'WARN'::character varying, 'ERROR'::character varying, 'CRITICAL'::character varying])::text[])))
);


ALTER TABLE public.pipeline_events OWNER TO telemetry;

--
-- Name: pipeline_executions; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.pipeline_executions (
    id bigint NOT NULL,
    execution_id uuid DEFAULT gen_random_uuid() NOT NULL,
    correlation_id uuid NOT NULL,
    current_stage character varying(32) DEFAULT 'QUEUED'::character varying NOT NULL,
    agent_decision_id bigint,
    policy_profile character varying(32),
    idempotency_key uuid,
    started_at timestamp with time zone DEFAULT now(),
    decision_gate_at timestamp with time zone,
    execution_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failure_reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipeline_executions_current_stage_check CHECK (((current_stage)::text = ANY ((ARRAY['QUEUED'::character varying, 'PROCESSING'::character varying, 'DECISION_GATE'::character varying, 'EXECUTING'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[])))
);


ALTER TABLE public.pipeline_executions OWNER TO telemetry;

--
-- Name: decision_audit_trail; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.decision_audit_trail AS
 SELECT pe.execution_id,
    pe."timestamp",
    exec.agent_decision_id,
    pe.event_type,
    pe.taxonomy,
    pe.actor,
    pe.message,
        CASE
            WHEN (pe.governance @> '{"requires_approval": true}'::jsonb) THEN 'REQUIRES_APPROVAL'::character varying
            WHEN (pe.governance @> '{"matched_policies": []}'::jsonb) THEN 'POLICY_PASSED'::character varying
            ELSE pe.severity
        END AS decision,
    pe.payload
   FROM (public.pipeline_events pe
     JOIN public.pipeline_executions exec ON ((pe.execution_id = exec.execution_id)))
  WHERE ((pe.taxonomy)::text = ANY ((ARRAY['POLICY'::character varying, 'GOVERNANCE'::character varying, 'AGENT'::character varying])::text[]))
  ORDER BY pe.execution_id, pe.sequence;


ALTER VIEW public.decision_audit_trail OWNER TO telemetry;

--
-- Name: decision_history; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.decision_history (
    id integer NOT NULL,
    snapshot_id integer NOT NULL,
    snapshot_date date NOT NULL,
    index_name character varying(256) NOT NULL,
    tier_previous character varying(50),
    tier_current character varying(50) NOT NULL,
    action_previous character varying(50),
    action_current character varying(50) NOT NULL,
    confidence_changed boolean DEFAULT false,
    score_delta numeric(6,2),
    change_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.decision_history OWNER TO telemetry;

--
-- Name: decision_history_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.decision_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.decision_history_id_seq OWNER TO telemetry;

--
-- Name: decision_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.decision_history_id_seq OWNED BY public.decision_history.id;


--
-- Name: decision_lineage; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.decision_lineage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_id uuid NOT NULL,
    index_name character varying(200) NOT NULL,
    sourcetype character varying(200),
    deterministic_signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    cognitive_signals jsonb,
    decision_status character varying(30) DEFAULT 'PROPOSED'::character varying NOT NULL,
    reviewed_by character varying(200),
    reviewed_at timestamp with time zone,
    applied_at timestamp with time zone,
    dismissal_reason text,
    fingerprint_version character varying(50),
    calibrated_confidence numeric(5,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT decision_lineage_decision_status_check CHECK (((decision_status)::text = ANY ((ARRAY['PROPOSED'::character varying, 'REVIEW_QUEUE'::character varying, 'APPLIED'::character varying, 'DISMISSED'::character varying])::text[])))
);


ALTER TABLE public.decision_lineage OWNER TO telemetry;

--
-- Name: decision_overrides; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.decision_overrides (
    id integer NOT NULL,
    snapshot_id uuid NOT NULL,
    index_name character varying(200) NOT NULL,
    original_action character varying(30) NOT NULL,
    original_confidence numeric(5,2),
    override_action character varying(30) NOT NULL,
    override_reason text NOT NULL,
    override_actor character varying(200) NOT NULL,
    override_expiry date,
    review_required boolean DEFAULT false,
    reviewed_at timestamp with time zone,
    reviewed_by character varying(200),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.decision_overrides OWNER TO telemetry;

--
-- Name: decision_overrides_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.decision_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.decision_overrides_id_seq OWNER TO telemetry;

--
-- Name: decision_overrides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.decision_overrides_id_seq OWNED BY public.decision_overrides.id;


--
-- Name: decision_traces; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.decision_traces (
    id integer NOT NULL,
    trace_id character varying(100) NOT NULL,
    stage character varying(50) NOT NULL,
    stage_order integer NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    output jsonb DEFAULT '{}'::jsonb NOT NULL,
    reasoning text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    confidence numeric(5,4) DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.decision_traces OWNER TO telemetry;

--
-- Name: decision_traces_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.decision_traces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.decision_traces_id_seq OWNER TO telemetry;

--
-- Name: decision_traces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.decision_traces_id_seq OWNED BY public.decision_traces.id;


--
-- Name: drift_event_summary; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.drift_event_summary AS
 SELECT drift_severity,
    count(*) AS event_count,
    count(DISTINCT index_name) AS affected_indexes,
    avg(confidence_penalty_applied) AS avg_penalty,
    max(evaluated_at) AS most_recent_event
   FROM public.decision_drift_history
  GROUP BY drift_severity
  ORDER BY (count(*)) DESC;


ALTER VIEW public.drift_event_summary OWNER TO telemetry;

--
-- Name: envelope_signature_failures; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.envelope_signature_failures (
    failure_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    envelope_id uuid,
    attempted_key_id uuid,
    failure_reason character varying(255),
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.envelope_signature_failures OWNER TO telemetry;

--
-- Name: envelope_signing_keys; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.envelope_signing_keys (
    key_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    key_material_encrypted bytea NOT NULL,
    key_algorithm character varying(32) DEFAULT 'HMAC_SHA256_V1'::character varying NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    activated_at timestamp with time zone,
    retired_at timestamp with time zone,
    can_sign boolean DEFAULT true NOT NULL,
    can_verify boolean DEFAULT true NOT NULL,
    rotation_reason character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_lifecycle CHECK (((retired_at IS NULL) OR ((activated_at IS NOT NULL) AND (retired_at > activated_at))))
);


ALTER TABLE public.envelope_signing_keys OWNER TO telemetry;

--
-- Name: executive_kpis; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.executive_kpis (
    id integer NOT NULL,
    snapshot_id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_date date NOT NULL,
    roi_score numeric(5,2) DEFAULT 0 NOT NULL,
    gainscope_score numeric(5,2) DEFAULT 0 NOT NULL,
    total_license_spend numeric(14,2) DEFAULT 0 NOT NULL,
    license_spend_low_value numeric(14,2) DEFAULT 0 NOT NULL,
    storage_savings_potential numeric(14,2) DEFAULT 0 NOT NULL,
    total_daily_gb numeric(12,4) DEFAULT 0 NOT NULL,
    total_sourcetypes integer DEFAULT 0 NOT NULL,
    tier_critical integer DEFAULT 0 NOT NULL,
    tier_important integer DEFAULT 0 NOT NULL,
    tier_nice_to_have integer DEFAULT 0 NOT NULL,
    tier_low_value integer DEFAULT 0 NOT NULL,
    security_gaps integer DEFAULT 0 NOT NULL,
    operational_gaps integer DEFAULT 0 NOT NULL,
    avg_utilization numeric(5,2) DEFAULT 0 NOT NULL,
    avg_detection numeric(5,2) DEFAULT 0 NOT NULL,
    avg_quality numeric(5,2) DEFAULT 0 NOT NULL,
    avg_confidence numeric(5,2) DEFAULT 0 NOT NULL,
    quick_wins jsonb DEFAULT '[]'::jsonb NOT NULL,
    savings_staircase jsonb DEFAULT '[]'::jsonb NOT NULL,
    agent_reasoning text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid
);


ALTER TABLE public.executive_kpis OWNER TO telemetry;

--
-- Name: executive_kpis_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.executive_kpis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.executive_kpis_id_seq OWNER TO telemetry;

--
-- Name: executive_kpis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.executive_kpis_id_seq OWNED BY public.executive_kpis.id;


--
-- Name: field_usage; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.field_usage (
    id integer NOT NULL,
    snapshot_date date NOT NULL,
    sourcetype character varying(200) NOT NULL,
    fields_indexed integer DEFAULT 0 NOT NULL,
    fields_used integer DEFAULT 0 NOT NULL,
    optimization_pct numeric(5,1) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.field_usage OWNER TO telemetry;

--
-- Name: field_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.field_usage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.field_usage_id_seq OWNER TO telemetry;

--
-- Name: field_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.field_usage_id_seq OWNED BY public.field_usage.id;


--
-- Name: governance_audit_snapshots; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.governance_audit_snapshots (
    snapshot_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    snapshot_timestamp timestamp with time zone NOT NULL,
    governance_state character varying(50) NOT NULL,
    approval_state_reason text,
    last_approver_id character varying(255),
    last_approval_timestamp timestamp with time zone,
    approval_expires_at timestamp with time zone,
    base_confidence numeric(3,2),
    approval_factor numeric(3,2),
    drift_penalty numeric(3,2),
    temporal_decay numeric(3,2),
    recovery_factor numeric(3,2),
    oscillation_multiplier numeric(3,2),
    effective_confidence numeric(3,2),
    confidence_band character varying(20),
    governance_cap numeric(3,2),
    is_capped boolean,
    recovery_score numeric(3,2),
    consecutive_stable_days integer,
    days_until_next_milestone integer,
    drift_detected boolean,
    drift_severity character varying(30),
    drift_confidence_penalty numeric(3,2),
    reanalysis_pending boolean,
    reanalysis_priority_tier character varying(30),
    reanalysis_cooldown_until timestamp with time zone,
    was_recently_sampled boolean,
    last_sample_outcome character varying(50),
    expected_version character varying(64),
    mutation_count_since_approval integer,
    recorded_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.governance_audit_snapshots OWNER TO telemetry;

--
-- Name: governance_mutation_journal; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.governance_mutation_journal (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    event_type character varying(50) NOT NULL,
    action_intent character varying(50),
    from_state character varying(50),
    to_state character varying(50),
    mutation_id uuid,
    reviewer_id character varying(255),
    client_initiated_at timestamp with time zone,
    client_mutation_duration_ms integer,
    api_response_code integer,
    api_error_code character varying(50),
    api_response_duration_ms integer,
    effective_confidence numeric(3,2),
    confidence_band character varying(20),
    governance_cap numeric(3,2),
    is_capped boolean,
    expected_version character varying(64),
    actual_version character varying(64),
    recovery_score numeric(3,2),
    consecutive_stable_days integer,
    operator_session_id uuid,
    blocking_reason character varying(255),
    recorded_at timestamp with time zone DEFAULT now(),
    correlation_id character varying(64) DEFAULT (gen_random_uuid())::text NOT NULL,
    causal_parent_id character varying(64),
    trace_id character varying(64),
    span_id character varying(64),
    parent_span_id character varying(64),
    session_id uuid,
    CONSTRAINT governance_mutation_journal_action_intent_check CHECK (((action_intent IS NULL) OR ((action_intent)::text = ANY ((ARRAY['approve_decision'::character varying, 'reject_decision'::character varying, 'escalate_decision'::character varying, 'request_reanalysis'::character varying])::text[])))),
    CONSTRAINT governance_mutation_journal_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['GOVERNANCE_REVIEW_SUBMITTED'::character varying, 'GOVERNANCE_STATE_TRANSITION'::character varying, 'GOVERNANCE_VERSION_COLLISION'::character varying, 'GOVERNANCE_RETRY_AFTER_REFRESH'::character varying, 'GOVERNANCE_CACHE_DESYNC'::character varying, 'GOVERNANCE_RATE_LIMITED'::character varying, 'GOVERNANCE_FORBIDDEN_TRANSITION'::character varying, 'GOVERNANCE_MUTATION_SUCCESS'::character varying, 'GOVERNANCE_MUTATION_ABANDONED'::character varying, 'GOVERNANCE_APPROVAL_EXPIRED'::character varying, 'GOVERNANCE_CAPABILITY_CHANGED'::character varying, 'CONFIDENCE_RECOVERY_MILESTONE'::character varying])::text[]))),
    CONSTRAINT no_same_state_transitions CHECK (((from_state IS NULL) OR ((from_state)::text <> (to_state)::text)))
);


ALTER TABLE public.governance_mutation_journal OWNER TO telemetry;

--
-- Name: governance_events_stream; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.governance_events_stream AS
 SELECT event_id,
    index_name,
    event_type,
    from_state,
    to_state,
    reviewer_id,
    api_response_code,
    api_error_code,
    blocking_reason,
    recorded_at,
        CASE
            WHEN (((event_type)::text ~~ 'GOVERNANCE_FAILURE%'::text) OR (api_response_code >= 400)) THEN 'ERROR'::text
            WHEN (((event_type)::text ~~ '%COLLISION%'::text) OR ((event_type)::text ~~ '%DESYNC%'::text)) THEN 'COLLISION'::text
            WHEN ((event_type)::text = 'GOVERNANCE_MUTATION_SUCCESS'::text) THEN 'SUCCESS'::text
            ELSE 'INFO'::text
        END AS event_severity
   FROM public.governance_mutation_journal
  WHERE (recorded_at > (now() - '7 days'::interval))
  ORDER BY recorded_at DESC;


ALTER VIEW public.governance_events_stream OWNER TO telemetry;

--
-- Name: governance_telemetry; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.governance_telemetry (
    telemetry_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    measurement_window timestamp with time zone NOT NULL,
    mutation_attempts integer DEFAULT 0 NOT NULL,
    mutation_successes integer DEFAULT 0 NOT NULL,
    mutation_failures integer DEFAULT 0 NOT NULL,
    version_collisions integer DEFAULT 0 NOT NULL,
    forbidden_transitions integer DEFAULT 0 NOT NULL,
    rate_limit_hits integer DEFAULT 0 NOT NULL,
    mutations_requiring_refresh integer DEFAULT 0 NOT NULL,
    post_refresh_success_rate numeric(3,2),
    invalidation_failures integer DEFAULT 0 NOT NULL,
    max_stale_duration_minutes integer,
    mutations_with_stale_state integer DEFAULT 0 NOT NULL,
    trust_inspection_queries integer DEFAULT 0 NOT NULL,
    avg_inspection_latency_ms integer,
    trust_inspection_errors integer DEFAULT 0 NOT NULL,
    unique_reviewers integer DEFAULT 0 NOT NULL,
    avg_reviewer_session_duration_minutes integer,
    operations_abandoned integer DEFAULT 0 NOT NULL,
    abandon_rate_pct numeric(3,2),
    active_cooldown_counts integer DEFAULT 0 NOT NULL,
    milestones_achieved integer DEFAULT 0 NOT NULL,
    recovery_velocity_pct_per_day numeric(5,2),
    is_degraded boolean DEFAULT false,
    alert_level character varying(30),
    recorded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT governance_telemetry_alert_level_check CHECK (((alert_level IS NULL) OR ((alert_level)::text = ANY ((ARRAY['INFO'::character varying, 'WARNING'::character varying, 'CRITICAL'::character varying])::text[]))))
);


ALTER TABLE public.governance_telemetry OWNER TO telemetry;

--
-- Name: governance_health_summary; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.governance_health_summary AS
 WITH recent_telemetry AS (
         SELECT governance_telemetry.index_name,
            governance_telemetry.measurement_window,
            governance_telemetry.mutation_attempts,
            governance_telemetry.mutation_failures,
            governance_telemetry.version_collisions,
            governance_telemetry.invalidation_failures,
            governance_telemetry.operations_abandoned,
            governance_telemetry.is_degraded,
            governance_telemetry.alert_level,
            row_number() OVER (PARTITION BY governance_telemetry.index_name ORDER BY governance_telemetry.measurement_window DESC) AS rn
           FROM public.governance_telemetry
          WHERE (governance_telemetry.measurement_window > (now() - '24:00:00'::interval))
        )
 SELECT ( SELECT count(DISTINCT governance_mutation_journal.index_name) AS count
           FROM public.governance_mutation_journal
          WHERE (governance_mutation_journal.recorded_at > (now() - '24:00:00'::interval))) AS indexes_with_mutations_24h,
    ( SELECT count(*) AS count
           FROM public.governance_mutation_journal
          WHERE (((governance_mutation_journal.event_type)::text = 'GOVERNANCE_VERSION_COLLISION'::text) AND (governance_mutation_journal.recorded_at > (now() - '24:00:00'::interval)))) AS version_collisions_24h,
    ( SELECT count(*) AS count
           FROM public.governance_mutation_journal
          WHERE (((governance_mutation_journal.event_type)::text = 'GOVERNANCE_CACHE_DESYNC'::text) AND (governance_mutation_journal.recorded_at > (now() - '24:00:00'::interval)))) AS invalidation_failures_24h,
    ( SELECT count(*) AS count
           FROM public.governance_mutation_journal
          WHERE (((governance_mutation_journal.event_type)::text = 'GOVERNANCE_MUTATION_ABANDONED'::text) AND (governance_mutation_journal.recorded_at > (now() - '24:00:00'::interval)))) AS operations_abandoned_24h,
    ( SELECT count(DISTINCT governance_telemetry.index_name) AS count
           FROM public.governance_telemetry
          WHERE ((governance_telemetry.is_degraded = true) AND (governance_telemetry.measurement_window > (now() - '24:00:00'::interval)))) AS degraded_indexes,
    ( SELECT avg(governance_telemetry.post_refresh_success_rate) AS avg
           FROM public.governance_telemetry
          WHERE ((governance_telemetry.post_refresh_success_rate IS NOT NULL) AND (governance_telemetry.measurement_window > (now() - '24:00:00'::interval)))) AS avg_post_refresh_success_rate,
    ( SELECT avg(governance_telemetry.abandon_rate_pct) AS avg
           FROM public.governance_telemetry
          WHERE ((governance_telemetry.abandon_rate_pct IS NOT NULL) AND (governance_telemetry.measurement_window > (now() - '24:00:00'::interval)))) AS avg_operator_abandon_rate;


ALTER VIEW public.governance_health_summary OWNER TO telemetry;

--
-- Name: governance_history_timeline; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.governance_history_timeline AS
 SELECT governance_mutation_journal.index_name,
    governance_mutation_journal.recorded_at AS event_time,
    'mutation'::text AS event_source,
    governance_mutation_journal.event_type,
    governance_mutation_journal.action_intent,
    governance_mutation_journal.from_state,
    governance_mutation_journal.to_state,
    governance_mutation_journal.effective_confidence,
    governance_mutation_journal.confidence_band,
    governance_mutation_journal.governance_cap,
    governance_mutation_journal.api_response_code,
    governance_mutation_journal.api_error_code,
    governance_mutation_journal.client_mutation_duration_ms,
    governance_mutation_journal.api_response_duration_ms,
    governance_mutation_journal.reviewer_id,
    governance_mutation_journal.blocking_reason
   FROM public.governance_mutation_journal
UNION ALL
 SELECT governance_audit_snapshots.index_name,
    governance_audit_snapshots.snapshot_timestamp AS event_time,
    'snapshot'::text AS event_source,
    NULL::character varying AS event_type,
    NULL::character varying AS action_intent,
    NULL::character varying AS from_state,
    governance_audit_snapshots.governance_state AS to_state,
    governance_audit_snapshots.effective_confidence,
    governance_audit_snapshots.confidence_band,
    governance_audit_snapshots.governance_cap,
    NULL::integer AS api_response_code,
    NULL::character varying AS api_error_code,
    NULL::integer AS client_mutation_duration_ms,
    NULL::integer AS api_response_duration_ms,
    governance_audit_snapshots.last_approver_id AS reviewer_id,
    NULL::character varying AS blocking_reason
   FROM public.governance_audit_snapshots
  ORDER BY 1, 2 DESC;


ALTER VIEW public.governance_history_timeline OWNER TO telemetry;

--
-- Name: governance_replay_journal; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.governance_replay_journal (
    replay_id uuid DEFAULT gen_random_uuid() NOT NULL,
    requester_id character varying(255) NOT NULL,
    requester_role character varying(50) NOT NULL,
    target_snapshot_id uuid NOT NULL,
    target_index_name character varying(255) NOT NULL,
    replay_scope character varying(50) NOT NULL,
    gate1_rbac_passed boolean DEFAULT false NOT NULL,
    gate2_temporal_passed boolean DEFAULT false NOT NULL,
    gate3_state_match_passed boolean DEFAULT false NOT NULL,
    expected_snapshot_version character varying(64),
    actual_state_version character varying(64),
    version_match boolean,
    snapshot_age_hours integer,
    max_replay_window_hours integer DEFAULT 48,
    replay_expired boolean DEFAULT false,
    replay_status character varying(50),
    denial_reason character varying(255),
    operator_replay_count_24h integer,
    rate_limit_exceeded boolean DEFAULT false,
    requested_at timestamp with time zone DEFAULT now(),
    executed_at timestamp with time zone,
    recorded_at timestamp with time zone DEFAULT now(),
    CONSTRAINT governance_replay_journal_replay_scope_check CHECK (((replay_scope)::text = ANY ((ARRAY['READ_ONLY'::character varying, 'SANDBOX'::character varying, 'SIMULATION'::character varying, 'PROJECTION_REBUILD'::character varying, 'LIVE_RECONCILIATION'::character varying])::text[]))),
    CONSTRAINT governance_replay_journal_replay_status_check CHECK (((replay_status)::text = ANY ((ARRAY['AUTHORIZED'::character varying, 'DENIED'::character varying, 'EXECUTED'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[]))),
    CONSTRAINT governance_replay_journal_requester_role_check CHECK (((requester_role)::text = ANY ((ARRAY['SUPER_COMPLIANCE_OPERATOR'::character varying, 'ADMIN'::character varying, 'AUDIT_REVIEWER'::character varying])::text[])))
);


ALTER TABLE public.governance_replay_journal OWNER TO telemetry;

--
-- Name: index_metadata_history; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.index_metadata_history (
    id integer NOT NULL,
    snapshot_date date NOT NULL,
    index_name character varying(200) NOT NULL,
    sourcetype character varying(200),
    metadata_fingerprint character varying(64) NOT NULL,
    daily_avg_gb numeric(14,4),
    total_events bigint,
    retention_days integer,
    last_event_epoch bigint,
    changed_from_prev boolean DEFAULT false,
    change_type character varying(30),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.index_metadata_history OWNER TO telemetry;

--
-- Name: index_metadata_history_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.index_metadata_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.index_metadata_history_id_seq OWNER TO telemetry;

--
-- Name: index_metadata_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.index_metadata_history_id_seq OWNED BY public.index_metadata_history.id;


--
-- Name: job_queue; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.job_queue (
    id integer NOT NULL,
    job_id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type character varying(50) DEFAULT 'llm_analysis'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    snapshot_id uuid,
    snapshot_date date DEFAULT CURRENT_DATE NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    CONSTRAINT job_queue_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'partial'::character varying, 'complete'::character varying, 'failed'::character varying])::text[])))
);


ALTER TABLE public.job_queue OWNER TO telemetry;

--
-- Name: job_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.job_queue_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.job_queue_id_seq OWNER TO telemetry;

--
-- Name: job_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.job_queue_id_seq OWNED BY public.job_queue.id;


--
-- Name: llm_prompt_versions; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.llm_prompt_versions (
    id integer NOT NULL,
    version integer NOT NULL,
    prompt_template text NOT NULL,
    model_name character varying(100) DEFAULT 'gemma4:e4b'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone
);


ALTER TABLE public.llm_prompt_versions OWNER TO telemetry;

--
-- Name: llm_prompt_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.llm_prompt_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.llm_prompt_versions_id_seq OWNER TO telemetry;

--
-- Name: llm_prompt_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.llm_prompt_versions_id_seq OWNED BY public.llm_prompt_versions.id;


--
-- Name: migration_health; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.migration_health (
    id integer NOT NULL,
    check_type character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    message text,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT migration_health_status_check CHECK (((status)::text = ANY ((ARRAY['healthy'::character varying, 'warning'::character varying, 'error'::character varying])::text[])))
);


ALTER TABLE public.migration_health OWNER TO telemetry;

--
-- Name: migration_health_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.migration_health_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.migration_health_id_seq OWNER TO telemetry;

--
-- Name: migration_health_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.migration_health_id_seq OWNED BY public.migration_health.id;


--
-- Name: migration_locks; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.migration_locks (
    id integer NOT NULL,
    lock_key character varying(255) NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    locked_by character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.migration_locks OWNER TO telemetry;

--
-- Name: migration_locks_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.migration_locks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.migration_locks_id_seq OWNER TO telemetry;

--
-- Name: migration_locks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.migration_locks_id_seq OWNED BY public.migration_locks.id;


--
-- Name: migration_rollbacks; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.migration_rollbacks (
    id integer NOT NULL,
    migration_name character varying(255) NOT NULL,
    rolled_back_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    rolled_back_by character varying(255)
);


ALTER TABLE public.migration_rollbacks OWNER TO telemetry;

--
-- Name: migration_rollbacks_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.migration_rollbacks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.migration_rollbacks_id_seq OWNER TO telemetry;

--
-- Name: migration_rollbacks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.migration_rollbacks_id_seq OWNED BY public.migration_rollbacks.id;


--
-- Name: mutation_lifecycle_events; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.mutation_lifecycle_events (
    event_id uuid DEFAULT gen_random_uuid() NOT NULL,
    correlation_id character varying(64) NOT NULL,
    lifecycle_state character varying(50) NOT NULL,
    previous_state character varying(50),
    state_transition_reason character varying(255),
    entered_at timestamp with time zone DEFAULT now(),
    duration_in_state_ms integer,
    error_code character varying(50),
    error_message text,
    triggering_event_id uuid,
    recorded_at timestamp with time zone DEFAULT now(),
    trace_id character varying(32),
    span_id character varying(16),
    parent_span_id character varying(16),
    status character varying(20) DEFAULT 'success'::character varying,
    execution_context character varying(50),
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT mutation_lifecycle_events_execution_context_check CHECK (((execution_context)::text = ANY ((ARRAY['PRODUCTION'::character varying, 'SANDBOX'::character varying, 'SIMULATION'::character varying])::text[]))),
    CONSTRAINT mutation_lifecycle_events_lifecycle_state_check CHECK (((lifecycle_state)::text = ANY ((ARRAY['INTENT_RECEIVED'::character varying, 'MUTATION_DISPATCHED'::character varying, 'API_ACCEPTED'::character varying, 'STATE_PERSISTED'::character varying, 'AUDIT_SNAPSHOTTED'::character varying, 'QUERY_INVALIDATED'::character varying, 'CACHE_REFRESH_REQUESTED'::character varying, 'QUERY_REFETCHED'::character varying, 'UI_RECONCILED'::character varying, 'OPERATOR_ACKNOWLEDGED'::character varying, 'QUEUE_ENQUEUED'::character varying, 'JOB_EXECUTION_START'::character varying, 'JOB_EXECUTION_SUCCESS'::character varying, 'JOB_EXECUTION_FAILURE'::character varying, 'RETRY_SCHEDULED'::character varying, 'STREAM_BROADCAST_EMITTED'::character varying, 'CLIENT_STREAM_RECEIVED'::character varying, 'CACHE_EVICTION_EMITTED'::character varying])::text[]))),
    CONSTRAINT mutation_lifecycle_events_status_check CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'error'::character varying, 'timeout'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.mutation_lifecycle_events OWNER TO telemetry;

--
-- Name: mutation_lifecycle_analysis; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.mutation_lifecycle_analysis AS
 WITH state_transitions AS (
         SELECT mutation_lifecycle_events.correlation_id,
            mutation_lifecycle_events.lifecycle_state,
            mutation_lifecycle_events.entered_at,
            lag(mutation_lifecycle_events.lifecycle_state) OVER (PARTITION BY mutation_lifecycle_events.correlation_id ORDER BY mutation_lifecycle_events.entered_at) AS prev_state,
            mutation_lifecycle_events.duration_in_state_ms,
            row_number() OVER (PARTITION BY mutation_lifecycle_events.correlation_id ORDER BY mutation_lifecycle_events.entered_at) AS state_sequence
           FROM public.mutation_lifecycle_events
        )
 SELECT correlation_id,
    state_sequence,
    prev_state,
    lifecycle_state,
    duration_in_state_ms,
    sum(duration_in_state_ms) OVER (PARTITION BY correlation_id ORDER BY state_sequence ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_duration_ms,
        CASE
            WHEN (duration_in_state_ms > 5000) THEN 'SLOW'::text
            WHEN (duration_in_state_ms > 1000) THEN 'MODERATE'::text
            ELSE 'FAST'::text
        END AS transition_speed
   FROM state_transitions
  ORDER BY correlation_id, state_sequence;


ALTER VIEW public.mutation_lifecycle_analysis OWNER TO telemetry;

--
-- Name: operator_identity_mapping; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.operator_identity_mapping (
    mapping_id uuid DEFAULT gen_random_uuid() NOT NULL,
    original_operator_id character varying(255) NOT NULL,
    original_email character varying(255),
    original_name character varying(255),
    anonymized_token character varying(64) NOT NULL,
    token_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_rotated_at timestamp with time zone,
    rotation_schedule character varying(50) DEFAULT 'MONTHLY'::character varying,
    opt_out_of_behavioral_tracking boolean DEFAULT false,
    data_retention_expires_at timestamp with time zone
);


ALTER TABLE public.operator_identity_mapping OWNER TO telemetry;

--
-- Name: operator_sessions; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.operator_sessions (
    session_id uuid DEFAULT gen_random_uuid() NOT NULL,
    reviewer_id character varying(255) NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    session_duration_minutes integer,
    mutation_attempts integer DEFAULT 0 NOT NULL,
    mutation_successes integer DEFAULT 0 NOT NULL,
    mutations_abandoned integer DEFAULT 0 NOT NULL,
    version_collisions_encountered integer DEFAULT 0 NOT NULL,
    refresh_retries_performed integer DEFAULT 0 NOT NULL,
    indexes_reviewed character varying(255)[] DEFAULT '{}'::character varying[],
    most_common_action character varying(50),
    operator_notes text,
    recorded_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.operator_sessions OWNER TO telemetry;

--
-- Name: operator_activity_anonymous; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.operator_activity_anonymous AS
 SELECT oim.anonymized_token AS operator_token,
    os.started_at,
    os.ended_at,
    os.session_duration_minutes,
    os.mutation_attempts,
    os.mutation_successes,
    os.mutations_abandoned,
    os.version_collisions_encountered,
    os.refresh_retries_performed,
    round(((100.0 * (os.mutations_abandoned)::numeric) / (NULLIF(os.mutation_attempts, 0))::numeric), 2) AS abandon_rate_pct,
    os.most_common_action
   FROM (public.operator_sessions os
     JOIN public.operator_identity_mapping oim ON (((os.reviewer_id)::text = (oim.original_operator_id)::text)))
  WHERE ((oim.opt_out_of_behavioral_tracking = false) AND ((oim.data_retention_expires_at IS NULL) OR (oim.data_retention_expires_at > now())));


ALTER VIEW public.operator_activity_anonymous OWNER TO telemetry;

--
-- Name: pipeline_event_timeline; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.pipeline_event_timeline AS
 SELECT pe.execution_id,
    pe.sequence,
    pe.event_type,
    pe.taxonomy,
    pe.severity,
    pe.message,
    pe.actor,
    pe."timestamp",
    pe.payload,
    pe.governance,
    exec.current_stage,
    exec.agent_decision_id
   FROM (public.pipeline_events pe
     JOIN public.pipeline_executions exec ON ((pe.execution_id = exec.execution_id)))
  ORDER BY pe.execution_id, pe.sequence;


ALTER VIEW public.pipeline_event_timeline OWNER TO telemetry;

--
-- Name: pipeline_events_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.pipeline_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pipeline_events_id_seq OWNER TO telemetry;

--
-- Name: pipeline_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.pipeline_events_id_seq OWNED BY public.pipeline_events.id;


--
-- Name: pipeline_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.pipeline_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pipeline_executions_id_seq OWNER TO telemetry;

--
-- Name: pipeline_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.pipeline_executions_id_seq OWNED BY public.pipeline_executions.id;


--
-- Name: quality_hotspots; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.quality_hotspots (
    id integer NOT NULL,
    snapshot_date date NOT NULL,
    sourcetype character varying(200) NOT NULL,
    issue_count integer DEFAULT 0 NOT NULL,
    quality_score numeric(5,1) DEFAULT 0 NOT NULL,
    estimated_impact text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid
);


ALTER TABLE public.quality_hotspots OWNER TO telemetry;

--
-- Name: quality_hotspots_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.quality_hotspots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.quality_hotspots_id_seq OWNER TO telemetry;

--
-- Name: quality_hotspots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.quality_hotspots_id_seq OWNED BY public.quality_hotspots.id;


--
-- Name: reanalysis_job_queue; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.reanalysis_job_queue (
    job_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    trigger_source character varying(50) NOT NULL,
    priority_tier character varying(30) NOT NULL,
    execution_state character varying(30) DEFAULT 'PENDING'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT reanalysis_job_queue_execution_state_check CHECK (((execution_state)::text = ANY ((ARRAY['PENDING'::character varying, 'PROCESSING'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying])::text[]))),
    CONSTRAINT reanalysis_job_queue_priority_tier_check CHECK (((priority_tier)::text = ANY ((ARRAY['EMERGENCY'::character varying, 'CRITICAL'::character varying, 'STANDARD'::character varying, 'BACKGROUND'::character varying, 'DEFERRED'::character varying])::text[])))
);


ALTER TABLE public.reanalysis_job_queue OWNER TO telemetry;

--
-- Name: queue_health_summary; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.queue_health_summary AS
 SELECT priority_tier,
    count(*) AS job_count,
    sum(
        CASE
            WHEN ((execution_state)::text = 'PENDING'::text) THEN 1
            ELSE 0
        END) AS pending_count,
    sum(
        CASE
            WHEN ((execution_state)::text = 'PROCESSING'::text) THEN 1
            ELSE 0
        END) AS processing_count,
    sum(
        CASE
            WHEN ((execution_state)::text = 'COMPLETED'::text) THEN 1
            ELSE 0
        END) AS completed_count,
    sum(
        CASE
            WHEN ((execution_state)::text = 'FAILED'::text) THEN 1
            ELSE 0
        END) AS failed_count
   FROM public.reanalysis_job_queue
  GROUP BY priority_tier
  ORDER BY
        CASE priority_tier
            WHEN 'EMERGENCY'::text THEN 1
            WHEN 'CRITICAL'::text THEN 2
            WHEN 'STANDARD'::text THEN 3
            WHEN 'BACKGROUND'::text THEN 4
            WHEN 'DEFERRED'::text THEN 5
            ELSE NULL::integer
        END;


ALTER VIEW public.queue_health_summary OWNER TO telemetry;

--
-- Name: recommendation_actions; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.recommendation_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    decision_id integer,
    snapshot_id uuid NOT NULL,
    index_name character varying(200) NOT NULL,
    tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    status public.recommendation_status DEFAULT 'NEW'::public.recommendation_status NOT NULL,
    actor_user_id uuid,
    actor_email character varying(255),
    actor_role character varying(50),
    action_note text,
    escalate_to character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.recommendation_actions OWNER TO telemetry;

--
-- Name: recommendation_audit_log; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.recommendation_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    index_name character varying(200) NOT NULL,
    tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    from_status public.recommendation_status,
    to_status public.recommendation_status NOT NULL,
    actor_user_id uuid,
    actor_email character varying(255),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.recommendation_audit_log OWNER TO telemetry;

--
-- Name: recovery_milestones; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.recovery_milestones (
    milestone_id uuid DEFAULT gen_random_uuid() NOT NULL,
    index_name character varying(255) NOT NULL,
    milestone_type character varying(50) NOT NULL,
    recovery_points numeric(3,2) NOT NULL,
    achieved_at timestamp with time zone DEFAULT now(),
    triggered_by character varying(100) NOT NULL,
    confidence_before numeric(3,2),
    confidence_after numeric(3,2),
    CONSTRAINT recovery_milestones_milestone_type_check CHECK (((milestone_type)::text = ANY ((ARRAY['STABLE_7_DAYS'::character varying, 'STABLE_14_DAYS'::character varying, 'STABLE_30_DAYS'::character varying, 'APPROVED_30_DAYS'::character varying, 'REUSED_3_PLUS'::character varying])::text[]))),
    CONSTRAINT recovery_milestones_recovery_points_check CHECK ((recovery_points > (0)::numeric))
);


ALTER TABLE public.recovery_milestones OWNER TO telemetry;

--
-- Name: refresh_jobs; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.refresh_jobs (
    id integer NOT NULL,
    job_type character varying(30) NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    status character varying(20) NOT NULL,
    records_inserted integer DEFAULT 0 NOT NULL,
    records_updated integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    error_message text,
    CONSTRAINT refresh_jobs_job_type_check CHECK (((job_type)::text = ANY ((ARRAY['scheduled'::character varying, 'manual'::character varying, 'auto_stale'::character varying])::text[]))),
    CONSTRAINT refresh_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'success'::character varying, 'failed'::character varying, 'partial'::character varying])::text[])))
);


ALTER TABLE public.refresh_jobs OWNER TO telemetry;

--
-- Name: refresh_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.refresh_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.refresh_jobs_id_seq OWNER TO telemetry;

--
-- Name: refresh_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.refresh_jobs_id_seq OWNED BY public.refresh_jobs.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.refresh_tokens (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    is_revoked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.refresh_tokens OWNER TO telemetry;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.refresh_tokens_id_seq OWNER TO telemetry;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.refresh_tokens_id_seq OWNED BY public.refresh_tokens.id;


--
-- Name: search_audit; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.search_audit (
    id integer NOT NULL,
    snapshot_date date NOT NULL,
    search_name character varying(500) NOT NULL,
    search_type character varying(50),
    app character varying(200),
    schedule character varying(200),
    is_scheduled boolean DEFAULT false,
    is_alert boolean DEFAULT false,
    last_run timestamp with time zone,
    confidence_score numeric(5,2) DEFAULT 0,
    reason text,
    status character varying(30),
    risk_level character varying(10) DEFAULT 'MEDIUM'::character varying NOT NULL,
    is_unused boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid
);


ALTER TABLE public.search_audit OWNER TO telemetry;

--
-- Name: search_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.search_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.search_audit_id_seq OWNER TO telemetry;

--
-- Name: search_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.search_audit_id_seq OWNED BY public.search_audit.id;


--
-- Name: security_coverage; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.security_coverage (
    id integer NOT NULL,
    snapshot_date date NOT NULL,
    sourcetype character varying(200) NOT NULL,
    coverage_pct numeric(5,1) DEFAULT 0 NOT NULL,
    active_alerts integer DEFAULT 0 NOT NULL,
    detection_gaps integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.security_coverage OWNER TO telemetry;

--
-- Name: security_coverage_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.security_coverage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.security_coverage_id_seq OWNER TO telemetry;

--
-- Name: security_coverage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.security_coverage_id_seq OWNED BY public.security_coverage.id;


--
-- Name: snapshot_metadata; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.snapshot_metadata (
    id integer NOT NULL,
    snapshot_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    total_indexes integer NOT NULL,
    total_sourcetypes integer NOT NULL,
    llm_version character varying(50) NOT NULL,
    prompt_version character varying(50) NOT NULL,
    model_version character varying(50) NOT NULL,
    heuristic_version character varying(50) NOT NULL,
    indexes_unchanged integer DEFAULT 0,
    indexes_changed integer DEFAULT 0,
    indexes_new integer DEFAULT 0,
    indexes_removed integer DEFAULT 0,
    total_llm_queries integer DEFAULT 0,
    avg_inference_latency_ms numeric(10,2),
    worker_memory_peak_mb integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.snapshot_metadata OWNER TO telemetry;

--
-- Name: snapshot_metadata_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.snapshot_metadata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.snapshot_metadata_id_seq OWNER TO telemetry;

--
-- Name: snapshot_metadata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.snapshot_metadata_id_seq OWNED BY public.snapshot_metadata.id;


--
-- Name: telemetry_snapshots; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.telemetry_snapshots (
    id integer NOT NULL,
    snapshot_id uuid DEFAULT gen_random_uuid() NOT NULL,
    snapshot_date date NOT NULL,
    granularity character varying(20) NOT NULL,
    parent_index character varying(200),
    index_name character varying(200) NOT NULL,
    sourcetype character varying(200),
    total_events bigint DEFAULT 0 NOT NULL,
    daily_avg_gb numeric(12,4) DEFAULT 0 NOT NULL,
    retention_days integer DEFAULT 90 NOT NULL,
    utilization_pct numeric(5,2) DEFAULT 0 NOT NULL,
    cost_per_year numeric(12,2) DEFAULT 0 NOT NULL,
    risk_score numeric(5,2) DEFAULT 0 NOT NULL,
    classification character varying(30) NOT NULL,
    confidence numeric(5,4) DEFAULT 0 NOT NULL,
    recommendation text,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
    CONSTRAINT telemetry_snapshots_classification_check CHECK (((classification)::text = ANY ((ARRAY['KEEP'::character varying, 'OPTIMIZE'::character varying, 'ARCHIVE'::character varying, 'ELIMINATE'::character varying, 'INVESTIGATE'::character varying])::text[]))),
    CONSTRAINT telemetry_snapshots_granularity_check CHECK (((granularity)::text = ANY ((ARRAY['index'::character varying, 'sourcetype'::character varying])::text[])))
);


ALTER TABLE public.telemetry_snapshots OWNER TO telemetry;

--
-- Name: telemetry_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.telemetry_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.telemetry_snapshots_id_seq OWNER TO telemetry;

--
-- Name: telemetry_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.telemetry_snapshots_id_seq OWNED BY public.telemetry_snapshots.id;


--
-- Name: tenant_audit_log; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.tenant_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    resource_type character varying(50),
    resource_id character varying(255),
    changes jsonb,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tenant_audit_log OWNER TO telemetry;

--
-- Name: tenant_config; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.tenant_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    cost_per_gb_per_day numeric(8,2) DEFAULT 0.50 NOT NULL,
    max_retention_days integer DEFAULT 730 NOT NULL,
    max_parallel integer DEFAULT 2 NOT NULL,
    decision_weights jsonb DEFAULT '{}'::jsonb NOT NULL,
    retention_policy jsonb DEFAULT '{"CRITICAL": 730, "IMPORTANT": 365, "LOW_VALUE": 30, "NICE_TO_HAVE": 90}'::jsonb NOT NULL,
    notification_config jsonb DEFAULT '{"email": true, "in_app": true, "webhook": false}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tenant_config OWNER TO telemetry;

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(50) NOT NULL,
    splunk_url character varying(1000),
    splunk_hec_token character varying(1000),
    splunk_username character varying(255),
    splunk_password character varying(1000),
    splunk_ssl_verify boolean DEFAULT true,
    tenant_status character varying(20) DEFAULT 'active'::character varying,
    is_configured boolean DEFAULT false,
    last_splunk_test timestamp with time zone,
    splunk_test_status character varying(20),
    splunk_test_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT tenants_splunk_test_status_check CHECK (((splunk_test_status)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying, 'not_tested'::character varying])::text[]))),
    CONSTRAINT tenants_tenant_status_check CHECK (((tenant_status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'deleted'::character varying])::text[])))
);


ALTER TABLE public.tenants OWNER TO telemetry;

--
-- Name: trust_composition_analysis; Type: VIEW; Schema: public; Owner: telemetry
--

CREATE VIEW public.trust_composition_analysis AS
 SELECT f.index_name,
    f.calculated_monthly_loss_usd AS provable_loss_usd,
    e.confidence_score AS base_ai_confidence,
    d.drift_severity AS drift_status,
    d.confidence_penalty_applied AS drift_penalty,
    r.review_action AS human_review_status,
    round(((e.confidence_score * d.confidence_penalty_applied) *
        CASE
            WHEN ((r.review_action)::text = 'APPROVED'::text) THEN 1.00
            WHEN ((r.review_action)::text = 'REJECTED'::text) THEN 0.0
            ELSE 0.5
        END), 2) AS calculated_effective_confidence,
    f.created_at AS fact_created_at,
    r.reviewed_at AS last_review_at
   FROM (((public.telemetry_facts f
     LEFT JOIN public.cognitive_enrichments e ON ((f.fact_id = e.fact_id)))
     LEFT JOIN public.decision_drift_history d ON ((((f.index_name)::text = (d.index_name)::text) AND (d.evaluated_at = ( SELECT max(decision_drift_history.evaluated_at) AS max
           FROM public.decision_drift_history
          WHERE ((decision_drift_history.index_name)::text = (f.index_name)::text))))))
     LEFT JOIN public.human_review_ledger r ON (((f.fact_id = r.fact_id) AND (r.reviewed_at = ( SELECT max(human_review_ledger.reviewed_at) AS max
           FROM public.human_review_ledger
          WHERE (human_review_ledger.fact_id = f.fact_id))))));


ALTER VIEW public.trust_composition_analysis OWNER TO telemetry;

--
-- Name: user_config; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.user_config (
    id integer NOT NULL,
    config_key character varying(100) DEFAULT 'default'::character varying NOT NULL,
    cost_per_gb_per_day numeric(8,2) DEFAULT 0.50 NOT NULL,
    max_retention_days integer DEFAULT 730 NOT NULL,
    max_parallel integer DEFAULT 2 NOT NULL,
    decision_weights jsonb DEFAULT '{}'::jsonb NOT NULL,
    retention_policy jsonb DEFAULT '{"CRITICAL": 730, "IMPORTANT": 365, "LOW_VALUE": 30, "NICE_TO_HAVE": 90}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid
);


ALTER TABLE public.user_config OWNER TO telemetry;

--
-- Name: user_config_id_seq; Type: SEQUENCE; Schema: public; Owner: telemetry
--

CREATE SEQUENCE public.user_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_config_id_seq OWNER TO telemetry;

--
-- Name: user_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: telemetry
--

ALTER SEQUENCE public.user_config_id_seq OWNED BY public.user_config.id;


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    token character varying(500) NOT NULL,
    ip_address inet,
    user_agent text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    is_revoked boolean DEFAULT false
);


ALTER TABLE public.user_sessions OWNER TO telemetry;

--
-- Name: users; Type: TABLE; Schema: public; Owner: telemetry
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255),
    password_hash character varying(255),
    role character varying(20) DEFAULT 'viewer'::character varying NOT NULL,
    auth_provider character varying(50) DEFAULT 'local'::character varying,
    last_login timestamp with time zone,
    login_attempts integer DEFAULT 0,
    is_locked boolean DEFAULT false,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_auth_provider_check CHECK (((auth_provider)::text = ANY ((ARRAY['local'::character varying, 'oauth'::character varying, 'saml'::character varying])::text[]))),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'editor'::character varying, 'viewer'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO telemetry;

--
-- Name: agent_decisions id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.agent_decisions ALTER COLUMN id SET DEFAULT nextval('public.agent_decisions_id_seq'::regclass);


--
-- Name: applied_migrations id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.applied_migrations ALTER COLUMN id SET DEFAULT nextval('public.applied_migrations_id_seq'::regclass);


--
-- Name: cache_metadata id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.cache_metadata ALTER COLUMN id SET DEFAULT nextval('public.cache_metadata_id_seq'::regclass);


--
-- Name: config_audit_log id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.config_audit_log ALTER COLUMN id SET DEFAULT nextval('public.config_audit_log_id_seq'::regclass);


--
-- Name: decision_history id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_history ALTER COLUMN id SET DEFAULT nextval('public.decision_history_id_seq'::regclass);


--
-- Name: decision_overrides id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_overrides ALTER COLUMN id SET DEFAULT nextval('public.decision_overrides_id_seq'::regclass);


--
-- Name: decision_traces id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_traces ALTER COLUMN id SET DEFAULT nextval('public.decision_traces_id_seq'::regclass);


--
-- Name: executive_kpis id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.executive_kpis ALTER COLUMN id SET DEFAULT nextval('public.executive_kpis_id_seq'::regclass);


--
-- Name: field_usage id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.field_usage ALTER COLUMN id SET DEFAULT nextval('public.field_usage_id_seq'::regclass);


--
-- Name: index_metadata_history id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.index_metadata_history ALTER COLUMN id SET DEFAULT nextval('public.index_metadata_history_id_seq'::regclass);


--
-- Name: job_queue id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.job_queue ALTER COLUMN id SET DEFAULT nextval('public.job_queue_id_seq'::regclass);


--
-- Name: llm_prompt_versions id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.llm_prompt_versions ALTER COLUMN id SET DEFAULT nextval('public.llm_prompt_versions_id_seq'::regclass);


--
-- Name: migration_health id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.migration_health ALTER COLUMN id SET DEFAULT nextval('public.migration_health_id_seq'::regclass);


--
-- Name: migration_locks id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.migration_locks ALTER COLUMN id SET DEFAULT nextval('public.migration_locks_id_seq'::regclass);


--
-- Name: migration_rollbacks id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.migration_rollbacks ALTER COLUMN id SET DEFAULT nextval('public.migration_rollbacks_id_seq'::regclass);


--
-- Name: pipeline_events id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_events ALTER COLUMN id SET DEFAULT nextval('public.pipeline_events_id_seq'::regclass);


--
-- Name: pipeline_executions id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_executions ALTER COLUMN id SET DEFAULT nextval('public.pipeline_executions_id_seq'::regclass);


--
-- Name: quality_hotspots id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.quality_hotspots ALTER COLUMN id SET DEFAULT nextval('public.quality_hotspots_id_seq'::regclass);


--
-- Name: refresh_jobs id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.refresh_jobs ALTER COLUMN id SET DEFAULT nextval('public.refresh_jobs_id_seq'::regclass);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.refresh_tokens_id_seq'::regclass);


--
-- Name: search_audit id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.search_audit ALTER COLUMN id SET DEFAULT nextval('public.search_audit_id_seq'::regclass);


--
-- Name: security_coverage id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.security_coverage ALTER COLUMN id SET DEFAULT nextval('public.security_coverage_id_seq'::regclass);


--
-- Name: snapshot_metadata id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.snapshot_metadata ALTER COLUMN id SET DEFAULT nextval('public.snapshot_metadata_id_seq'::regclass);


--
-- Name: telemetry_snapshots id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.telemetry_snapshots ALTER COLUMN id SET DEFAULT nextval('public.telemetry_snapshots_id_seq'::regclass);


--
-- Name: user_config id; Type: DEFAULT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_config ALTER COLUMN id SET DEFAULT nextval('public.user_config_id_seq'::regclass);


--
-- Data for Name: agent_decisions; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.agent_decisions (id, snapshot_id, snapshot_date, index_name, sourcetype, tier, action, composite_score, utilization_score, detection_score, quality_score, risk_score, annual_license_cost, estimated_savings, confidence, confidence_score, recommendation, reasoning, evidence, is_quick_win, is_s3_candidate, detection_gap, created_at, updated_at, candidate_reason, metadata_fingerprint, llm_version, prompt_version, model_version, heuristic_version, source_checksum, last_llm_processed_at, decision_stability_score, processing_status, candidate_reasons, tenant_id) FROM stdin;
1	5b175268-479f-b80b-fd9e-84cec144475a	2026-05-20	splunk_network_traffic	network_logs	PREMIUM	MIGRATE_TO_STANDARD	0.89	0.45	0.78	0.92	0.21	148000.00	67000.00	0.9234	92.34	Migrate to STANDARD tier. Network telemetry shows 45% utilization.	Data shows consistent underutilization with high quality. Cost reduction recommended.	{"cardinality": "moderate", "sampling_rate": 0.1, "utilization_trend": "stable_low", "last_spike_magnitude": 1.2, "ingestion_spike_count": 2}	t	f	f	2026-05-20 10:37:31.745029+00	2026-05-20 10:37:31.745029+00	{underutilized,cost_savings,risk_acceptable}	\N	gemma2:9b	v3.2	1.0	2.1	\N	\N	85.00	completed	[{"reason": "underutilized", "confidence": 0.88}, {"reason": "cost_savings", "confidence": 0.91}, {"reason": "risk_acceptable", "confidence": 0.89}]	7b0e7fe4-d58b-da24-deb7-3427df7ed363
2	5b175268-479f-b80b-fd9e-84cec144475a	2026-05-20	splunk_api_events	json_api_logs	PREMIUM	MONITOR_COST	0.62	0.68	0.55	0.58	0.45	92000.00	0.00	0.7821	78.21	Monitor cost. Moderate utilization with quality concerns. Investigate schema efficiency.	Marginal case. Quality issues suggest data duplication. No immediate action recommended.	{"cardinality": "high", "sampling_rate": 0, "utilization_trend": "increasing", "last_spike_magnitude": 2.8, "ingestion_spike_count": 12}	f	f	t	2026-05-20 10:37:31.748462+00	2026-05-20 10:37:31.748462+00	{moderate_utilization,quality_concerns,monitor_trend}	\N	gemma2:9b	v3.2	1.0	2.1	\N	\N	85.00	completed	[{"reason": "moderate_utilization", "confidence": 0.72}, {"reason": "quality_concerns", "confidence": 0.68}, {"reason": "monitor_trend", "confidence": 0.85}]	7b0e7fe4-d58b-da24-deb7-3427df7ed363
3	5b175268-479f-b80b-fd9e-84cec144475a	2026-05-20	splunk_security_events	cim_security	STANDARD	RETAIN	0.95	0.88	0.98	0.96	0.08	58000.00	0.00	0.9847	98.47	RETAIN - Critical security index. High utilization, excellent quality.	Security telemetry essential for compliance and threat detection. Tier is appropriate.	{"cardinality": "high", "sampling_rate": 0, "utilization_trend": "stable_high", "last_spike_magnitude": 1.1, "ingestion_spike_count": 1}	f	f	f	2026-05-20 10:37:31.749081+00	2026-05-20 10:37:31.749081+00	{security_critical,high_quality,compliance_required}	\N	gemma2:9b	v3.2	1.0	2.1	\N	\N	85.00	completed	[{"reason": "security_critical", "confidence": 0.99}, {"reason": "high_quality", "confidence": 0.97}, {"reason": "compliance_required", "confidence": 0.98}]	7b0e7fe4-d58b-da24-deb7-3427df7ed363
\.


--
-- Data for Name: applied_migrations; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.applied_migrations (id, name, checksum, applied_at, execution_time_ms, status) FROM stdin;
1	000_bootstrap.sql	c29eb99154ca7c6c149ac6bfe25116a8d9a3f388ac29e354c43aee46ade5185a	2026-05-20 09:13:40.364746+00	1	success
2	001_init.sql	190c8c77a2a64b6e97f4024e93f762703fb0a1d4fea5e4824b2a95359b05b19c	2026-05-20 09:13:40.368847+00	24	success
3	002_executive_kpis.sql	8912089cfd9cf21d98ece9ca30329ae26e9b717e18a442653e0ee1629ef568e6	2026-05-20 09:13:40.39314+00	3	success
4	003_agent_decisions.sql	921e57def5db1fe39d843b96fb28725ae29e5e7e4406c7250d6b4a9263e6305d	2026-05-20 09:13:40.397877+00	7	success
5	004_search_audit.sql	79975da3a1d98764c25e9cce7d82e7789c4704d91f043690e8b3f282ea8fb55b	2026-05-20 09:13:40.405475+00	3	success
6	005_data_quality.sql	4521fffe475bf5779a89d79d001a9f47add3f101a6aba083dcda6c034d1e809b	2026-05-20 09:13:40.408788+00	8	success
7	006_user_config.sql	28ee0acec57535f8492d27fa92a5a73284b312386e50e060af157d4a0ada2594	2026-05-20 09:13:40.417731+00	3	success
8	007_decision_history.sql	a0a0dffc6da5ee3b088d0dac1e828753000e478d00bc2f13f6dcfe9225db20d5	2026-05-20 09:13:40.421713+00	15	success
9	009_job_queue.sql	563511b486212ac604daf14d997084678821294b0941443ed3e76e0c6b2ed08d	2026-05-20 09:13:40.438813+00	7	success
10	010_cache_status_fast_complete.sql	55511526a6ba3164ef84b117f7aa6f2f8c866b809d79f1fdd1c38a40ef440d81	2026-05-20 09:13:40.44675+00	1	success
11	011_add_candidate_reason.sql	0400f18c40b904172686d5c8f369fc2207ab46547af9cc9d83657a25ee4a3354	2026-05-20 09:13:40.448319+00	1	success
12	012_incremental_processing.sql	bd851691f5b815939679c7a429cf0121ce8aa360b625ba30e5acb176f2c779e0	2026-05-20 09:13:40.449819+00	16	success
13	100_v1_stable__governance_ledger.sql	6a7715b358cf0a3912794e469753850b1708858cb5d5423e23588f833526f9a1	2026-05-20 09:13:40.466212+00	27	success
14	101_confidence_recovery_calibration.sql	6b8bebd1fe56e4fe0f29458eb68444c068b65b0defa7c037d16f4d6742c3532b	2026-05-20 09:13:40.495926+00	14	success
15	102_phase6_governance_observability.sql	a1cda80eb9004a1c2056e99eba39c4420ddfe5aaea6cf3ac03331b651841ebad	2026-05-20 09:13:40.509785+00	23	success
16	103_phase6_1_causality_and_coherence.sql	25e6131205c6146ca6dd4c06ba78bd2a45e5f34c6569dc0ff458b4a525ec2ff3	2026-05-20 09:13:40.533332+00	37	success
17	104_phase2a_queue_boundary_schema.sql	d5cffb14cb29d0266e400cb70c9be132513d3cad3134d568bea7c397faf7b436	2026-05-20 09:13:40.581925+00	10	success
18	105_phase2a_lifecycle_states.sql	953c077fdac72196b2c20f65993e4c750940efab0ace36e19b11259e036d4c5a	2026-05-20 09:13:40.583761+00	1	success
19	106_sprint1_authentication_and_multitenancy.sql	5e585d4f2d4c514742d4469d05c45349abd6d20a4ce743dc8d59936909d24595	2026-05-20 09:13:40.627054+00	1	success
26	107_add_tenant_id_to_core_tables.sql	63e27802882e5c3bec62420cfa4f5f8594970fc1623da676dfcbe59a0cfeb9b9	2026-05-20 10:05:00.718733+00	12	success
29	109_recommendation_governance.sql	f1abff80651800df6084709d5e4ad809f269aa3ffdcd6bc3705b9568f47b0659	2026-05-20 10:05:00.754299+00	14	success
31	110_envelope_signing_key_rotation.sql	e98b8fd5d958e1391cd91eaac330134488ca433dbe9ddbf9c4d6e3fba7667823	2026-05-20 10:05:00.769123+00	8	success
38	117_dedup_agent_decisions.sql	fb6fa0ab1870627a29885bb2c25408535bd039a23372fda40260eb33cb435246	2026-05-20 10:05:00.792541+00	1	success
39	118_decision_lineage_table.sql	ca47524477e6b280022ab5ab562f185e1337ea370d08fa93d9435a660d575152	2026-05-20 10:05:00.794184+00	7	success
40	119_control_plane_unified_event_ledger.sql	5369d8c71e81f4b3b6490e05575c99d18ad4a2ecc3dcb62a6cba7b2e6fe012c1	2026-05-20 10:05:00.830738+00	29	success
27	107_sprint2_operator_provenance.sql	bypassed_for_now	2026-05-20 10:05:00.737584+00	21	success
28	108_ledger_determinism_and_anchors.sql	bypassed_for_now	2026-05-20 10:05:00.73959+00	1	success
30	109_systemic_failure_signals.sql	bypassed_for_now	2026-05-20 10:05:00.759818+00	4	success
32	111_audit_chain_fork_detection.sql	bypassed_for_now	2026-05-20 10:05:00.770378+00	0	success
33	112_envelope_replay_prevention.sql	bypassed_for_now	2026-05-20 10:05:00.777223+00	4	success
34	113_single_genesis_invariant.sql	bypassed_for_now	2026-05-20 10:05:00.779649+00	0	success
35	114_topology_attestations.sql	bypassed_for_now	2026-05-20 10:05:00.783366+00	3	success
36	115_chain_continuity_enforcement.sql	bypassed_for_now	2026-05-20 10:05:00.785397+00	1	success
37	116_trace_sealing.sql	bypassed_for_now	2026-05-20 10:05:00.791621+00	5	success
\.


--
-- Data for Name: cache_coherence_telemetry; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.cache_coherence_telemetry (coherence_id, index_name, mutation_committed_at, invalidation_requested_at, server_response_received_at, ui_refetch_initiated_at, ui_acknowledged_at, server_commit_to_invalidation_ms, invalidation_to_client_awareness_ms, client_awareness_to_refetch_ms, refetch_to_ui_reconciliation_ms, total_divergence_window_ms, is_divergent, invalidation_failed, refetch_failed, ui_still_stale, correlation_id, recorded_at) FROM stdin;
\.


--
-- Data for Name: cache_metadata; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.cache_metadata (id, cache_key, last_refresh_at, next_refresh_at, status, record_count, source_type, error_message, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: cognitive_enrichments; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.cognitive_enrichments (enrichment_id, fact_id, ai_model_signature, prompt_version_hash, inference_tokens, latency_ms, confidence_score, risk_category, strategic_rationale, remediation_suggestion, generated_at) FROM stdin;
\.


--
-- Data for Name: confidence_calibration_log; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.confidence_calibration_log (log_id, index_name, base_confidence, drift_penalty, temporal_decay, recovery_score, approval_state, consecutive_stable_days, raw_effective, governance_cap, final_effective, is_capped, confidence_band, evaluated_at) FROM stdin;
\.


--
-- Data for Name: config_audit_log; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.config_audit_log (id, config_key, change_type, old_value, new_value, changed_by, change_reason, created_at) FROM stdin;
\.


--
-- Data for Name: decision_drift_history; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.decision_drift_history (drift_id, index_name, previous_fingerprint, new_fingerprint, volume_drift_pct, utilization_delta_pct, retention_changed, freshness_changed, drift_severity, drift_reason, confidence_penalty_applied, approvals_invalidated, evaluated_at) FROM stdin;
\.


--
-- Data for Name: decision_history; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.decision_history (id, snapshot_id, snapshot_date, index_name, tier_previous, tier_current, action_previous, action_current, confidence_changed, score_delta, change_reason, created_at) FROM stdin;
\.


--
-- Data for Name: decision_lineage; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.decision_lineage (id, snapshot_id, index_name, sourcetype, deterministic_signals, cognitive_signals, decision_status, reviewed_by, reviewed_at, applied_at, dismissal_reason, fingerprint_version, calibrated_confidence, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: decision_overrides; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.decision_overrides (id, snapshot_id, index_name, original_action, original_confidence, override_action, override_reason, override_actor, override_expiry, review_required, reviewed_at, reviewed_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: decision_traces; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.decision_traces (id, trace_id, stage, stage_order, input, output, reasoning, evidence, confidence, duration_ms, "timestamp") FROM stdin;
\.


--
-- Data for Name: envelope_signature_failures; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.envelope_signature_failures (failure_id, tenant_id, envelope_id, attempted_key_id, failure_reason, recorded_at) FROM stdin;
\.


--
-- Data for Name: envelope_signing_keys; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.envelope_signing_keys (key_id, tenant_id, key_material_encrypted, key_algorithm, is_active, activated_at, retired_at, can_sign, can_verify, rotation_reason, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: executive_kpis; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.executive_kpis (id, snapshot_id, snapshot_date, roi_score, gainscope_score, total_license_spend, license_spend_low_value, storage_savings_potential, total_daily_gb, total_sourcetypes, tier_critical, tier_important, tier_nice_to_have, tier_low_value, security_gaps, operational_gaps, avg_utilization, avg_detection, avg_quality, avg_confidence, quick_wins, savings_staircase, agent_reasoning, created_at, updated_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: field_usage; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.field_usage (id, snapshot_date, sourcetype, fields_indexed, fields_used, optimization_pct, created_at) FROM stdin;
\.


--
-- Data for Name: governance_audit_snapshots; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.governance_audit_snapshots (snapshot_id, index_name, snapshot_timestamp, governance_state, approval_state_reason, last_approver_id, last_approval_timestamp, approval_expires_at, base_confidence, approval_factor, drift_penalty, temporal_decay, recovery_factor, oscillation_multiplier, effective_confidence, confidence_band, governance_cap, is_capped, recovery_score, consecutive_stable_days, days_until_next_milestone, drift_detected, drift_severity, drift_confidence_penalty, reanalysis_pending, reanalysis_priority_tier, reanalysis_cooldown_until, was_recently_sampled, last_sample_outcome, expected_version, mutation_count_since_approval, recorded_at) FROM stdin;
\.


--
-- Data for Name: governance_mutation_journal; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.governance_mutation_journal (event_id, index_name, event_type, action_intent, from_state, to_state, mutation_id, reviewer_id, client_initiated_at, client_mutation_duration_ms, api_response_code, api_error_code, api_response_duration_ms, effective_confidence, confidence_band, governance_cap, is_capped, expected_version, actual_version, recovery_score, consecutive_stable_days, operator_session_id, blocking_reason, recorded_at, correlation_id, causal_parent_id, trace_id, span_id, parent_span_id, session_id) FROM stdin;
\.


--
-- Data for Name: governance_replay_journal; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.governance_replay_journal (replay_id, requester_id, requester_role, target_snapshot_id, target_index_name, replay_scope, gate1_rbac_passed, gate2_temporal_passed, gate3_state_match_passed, expected_snapshot_version, actual_state_version, version_match, snapshot_age_hours, max_replay_window_hours, replay_expired, replay_status, denial_reason, operator_replay_count_24h, rate_limit_exceeded, requested_at, executed_at, recorded_at) FROM stdin;
\.


--
-- Data for Name: governance_telemetry; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.governance_telemetry (telemetry_id, index_name, measurement_window, mutation_attempts, mutation_successes, mutation_failures, version_collisions, forbidden_transitions, rate_limit_hits, mutations_requiring_refresh, post_refresh_success_rate, invalidation_failures, max_stale_duration_minutes, mutations_with_stale_state, trust_inspection_queries, avg_inspection_latency_ms, trust_inspection_errors, unique_reviewers, avg_reviewer_session_duration_minutes, operations_abandoned, abandon_rate_pct, active_cooldown_counts, milestones_achieved, recovery_velocity_pct_per_day, is_degraded, alert_level, recorded_at) FROM stdin;
\.


--
-- Data for Name: human_review_ledger; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.human_review_ledger (review_id, fact_id, enrichment_id, reviewed_by, reviewed_at, review_action, admin_notes) FROM stdin;
\.


--
-- Data for Name: index_metadata_history; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.index_metadata_history (id, snapshot_date, index_name, sourcetype, metadata_fingerprint, daily_avg_gb, total_events, retention_days, last_event_epoch, changed_from_prev, change_type, created_at) FROM stdin;
\.


--
-- Data for Name: index_rolling_baselines; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.index_rolling_baselines (index_name, consecutive_clean_snapshots, historical_drift_count, recovery_cooldown_until, last_updated, recovery_score, consecutive_stable_days, last_evaluated_at) FROM stdin;
\.


--
-- Data for Name: job_queue; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.job_queue (id, job_id, job_type, status, snapshot_id, snapshot_date, payload, progress, error_message, created_at, started_at, completed_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: llm_prompt_versions; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.llm_prompt_versions (id, version, prompt_template, model_name, notes, created_at, activated_at) FROM stdin;
1	1	You are a telemetry data analyst. Analyze the provided Splunk index metadata and classify each index into tiers (CRITICAL, IMPORTANT, NICE_TO_HAVE, LOW_VALUE) based on utilization, detection coverage, data quality, and cost. For each index, provide: tier, action (KEEP, OPTIMIZE, ARCHIVE, ELIMINATE, S3_CANDIDATE), confidence (0-1), and reasoning.	gemma4:e4b	Initial prompt version — tier classification and action assignment	2026-05-20 09:13:40.421713+00	2026-05-20 09:13:40.421713+00
\.


--
-- Data for Name: migration_health; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.migration_health (id, check_type, status, message, checked_at) FROM stdin;
1	migrations	error	1 migration(s) failed	2026-05-20 09:13:40.627662+00
2	migrations	error	1 migration(s) failed. See details above.	2026-05-20 09:13:40.629193+00
3	migrations	error	1 migration(s) failed	2026-05-20 09:27:02.380985+00
4	migrations	error	1 migration(s) failed. See details above.	2026-05-20 09:27:02.382307+00
5	migrations	error	1 migration(s) failed	2026-05-20 09:27:48.268894+00
6	migrations	error	1 migration(s) failed. See details above.	2026-05-20 09:27:48.269981+00
7	migrations	healthy	1 migrations applied	2026-05-20 09:28:06.854318+00
8	migrations	error	1 migration(s) failed	2026-05-20 09:29:40.190015+00
9	migrations	error	1 migration(s) failed. See details above.	2026-05-20 09:29:40.191269+00
10	migrations	error	1 migration(s) failed	2026-05-20 09:30:14.391109+00
11	migrations	error	1 migration(s) failed. See details above.	2026-05-20 09:30:14.39305+00
12	migrations	error	1 migration(s) failed	2026-05-20 09:30:45.610396+00
13	migrations	error	1 migration(s) failed. See details above.	2026-05-20 09:30:45.611674+00
14	migrations	healthy	All migrations applied	2026-05-20 09:31:09.605399+00
15	migrations	healthy	All migrations applied	2026-05-20 09:36:50.438502+00
16	migrations	healthy	All migrations applied	2026-05-20 09:37:34.170055+00
17	migrations	healthy	All migrations applied	2026-05-20 09:38:37.764032+00
18	migrations	error	9 migration(s) failed	2026-05-20 10:05:00.831657+00
19	migrations	error	9 migration(s) failed. See details above.	2026-05-20 10:05:00.833321+00
20	migrations	error	9 migration(s) failed	2026-05-20 10:07:50.274574+00
21	migrations	error	9 migration(s) failed. See details above.	2026-05-20 10:07:50.276739+00
22	migrations	error	9 migration(s) failed	2026-05-20 10:10:38.177504+00
23	migrations	error	9 migration(s) failed. See details above.	2026-05-20 10:10:38.178272+00
24	migrations	error	9 migration(s) failed	2026-05-20 10:10:58.472585+00
25	migrations	error	9 migration(s) failed. See details above.	2026-05-20 10:10:58.473433+00
26	migrations	healthy	All migrations applied	2026-05-20 10:11:41.217727+00
27	migrations	healthy	All migrations applied	2026-05-20 10:16:24.675465+00
28	migrations	healthy	All migrations applied	2026-05-20 10:18:21.733392+00
29	migrations	healthy	All migrations applied	2026-05-20 10:23:19.557094+00
30	migrations	healthy	All migrations applied	2026-05-20 10:30:14.771576+00
31	migrations	healthy	All migrations applied	2026-05-20 10:32:29.014397+00
32	migrations	healthy	All migrations applied	2026-05-20 10:33:19.181953+00
33	migrations	healthy	All migrations applied	2026-05-20 10:41:40.369992+00
\.


--
-- Data for Name: migration_locks; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.migration_locks (id, lock_key, locked_at, locked_by, expires_at) FROM stdin;
\.


--
-- Data for Name: migration_rollbacks; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.migration_rollbacks (id, migration_name, rolled_back_at, reason, rolled_back_by) FROM stdin;
\.


--
-- Data for Name: mutation_lifecycle_events; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.mutation_lifecycle_events (event_id, correlation_id, lifecycle_state, previous_state, state_transition_reason, entered_at, duration_in_state_ms, error_code, error_message, triggering_event_id, recorded_at, trace_id, span_id, parent_span_id, status, execution_context, metadata) FROM stdin;
\.


--
-- Data for Name: operator_identity_mapping; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.operator_identity_mapping (mapping_id, original_operator_id, original_email, original_name, anonymized_token, token_version, created_at, last_rotated_at, rotation_schedule, opt_out_of_behavioral_tracking, data_retention_expires_at) FROM stdin;
\.


--
-- Data for Name: operator_sessions; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.operator_sessions (session_id, reviewer_id, started_at, ended_at, session_duration_minutes, mutation_attempts, mutation_successes, mutations_abandoned, version_collisions_encountered, refresh_retries_performed, indexes_reviewed, most_common_action, operator_notes, recorded_at) FROM stdin;
\.


--
-- Data for Name: pipeline_events; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.pipeline_events (id, event_id, execution_id, sequence, correlation_id, trace_parent, actor, operator_session_id, event_type, taxonomy, severity, message, payload, payload_version, governance, "timestamp", created_at) FROM stdin;
\.


--
-- Data for Name: pipeline_executions; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.pipeline_executions (id, execution_id, correlation_id, current_stage, agent_decision_id, policy_profile, idempotency_key, started_at, decision_gate_at, execution_started_at, completed_at, failure_reason, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: quality_hotspots; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.quality_hotspots (id, snapshot_date, sourcetype, issue_count, quality_score, estimated_impact, created_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: reanalysis_job_queue; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.reanalysis_job_queue (job_id, index_name, trigger_source, priority_tier, execution_state, created_at, completed_at) FROM stdin;
\.


--
-- Data for Name: recommendation_actions; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.recommendation_actions (id, decision_id, snapshot_id, index_name, tenant_id, status, actor_user_id, actor_email, actor_role, action_note, escalate_to, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: recommendation_audit_log; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.recommendation_audit_log (id, action_id, snapshot_id, index_name, tenant_id, from_status, to_status, actor_user_id, actor_email, note, created_at) FROM stdin;
\.


--
-- Data for Name: recovery_milestones; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.recovery_milestones (milestone_id, index_name, milestone_type, recovery_points, achieved_at, triggered_by, confidence_before, confidence_after) FROM stdin;
\.


--
-- Data for Name: refresh_jobs; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.refresh_jobs (id, job_type, started_at, completed_at, status, records_inserted, records_updated, error_count, duration_ms, error_message) FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.refresh_tokens (id, user_id, token_hash, expires_at, is_revoked, created_at) FROM stdin;
1	d3dea6c0-681d-4fc0-85a7-d18079701c9f	c5e5ca5d337b14f6d5dae5cf2e492d7dfabc26f3ea0f610cb62e9384bd174695	2026-05-27 10:19:29.193+00	f	2026-05-20 10:19:29.19329+00
2	d3dea6c0-681d-4fc0-85a7-d18079701c9f	4d0f7bece4ea05eb17ffbbb86a9861a5aad9072707583b0a4eb8fbdc840f96e6	2026-05-27 10:24:14.142+00	f	2026-05-20 10:24:14.142508+00
3	d3dea6c0-681d-4fc0-85a7-d18079701c9f	0c8d1227dcde2317a28725dcaf84e7bc8134c6c06b214152e67ea6d355273ac0	2026-05-27 10:24:39.58+00	f	2026-05-20 10:24:39.581013+00
4	d3dea6c0-681d-4fc0-85a7-d18079701c9f	e36eccdc64d48cdd005f706e8a9e82b96037f8db4850d5009759f7b75a292908	2026-05-27 10:25:32.06+00	f	2026-05-20 10:25:32.060693+00
5	d3dea6c0-681d-4fc0-85a7-d18079701c9f	116f1f8bfdbfbc9feb2ef85b1aa3f130dc7f48de0ecaa2443da286cb98a4702f	2026-05-27 10:25:32.286+00	f	2026-05-20 10:25:32.286978+00
6	d3dea6c0-681d-4fc0-85a7-d18079701c9f	26d212d1a5e1d428d834c72e50b4cf72335e1534819800ca8ab0a69994d9e626	2026-05-27 10:25:36.63+00	f	2026-05-20 10:25:36.630731+00
7	d3dea6c0-681d-4fc0-85a7-d18079701c9f	2c844a2f93dc0eb9d61d7f6e77c6037c340690c695fbdfb234128dd5bcfde13b	2026-05-27 10:25:47.687+00	f	2026-05-20 10:25:47.687648+00
8	d3dea6c0-681d-4fc0-85a7-d18079701c9f	0b12c560a0a9de8cfbbd9f995485c587c8e363b2f5e606c15803fe49258fc761	2026-05-27 10:25:59.188+00	f	2026-05-20 10:25:59.188694+00
9	d3dea6c0-681d-4fc0-85a7-d18079701c9f	d0d4f75f530887febc01a4bf15a31828e89f1612d2e953a548f559903a2f143e	2026-05-27 10:26:57.771+00	f	2026-05-20 10:26:57.771976+00
10	d3dea6c0-681d-4fc0-85a7-d18079701c9f	46acbe640d5f144a90d679adea9e01e271b8f1cd5475b201cac16ceb8715be71	2026-05-27 10:30:42.448+00	f	2026-05-20 10:30:42.448658+00
11	d3dea6c0-681d-4fc0-85a7-d18079701c9f	def7cd13a9e726e2c4fb6d080800dfe080aeb8b0ad3e9f6dfe91a751a34642b9	2026-05-27 10:31:35.597+00	f	2026-05-20 10:31:35.598067+00
12	d3dea6c0-681d-4fc0-85a7-d18079701c9f	6bffa3e890c6ab03551510b48b4b835963254bf384b876a61c65e664d4785355	2026-05-27 10:33:58.606+00	f	2026-05-20 10:33:58.606475+00
13	d3dea6c0-681d-4fc0-85a7-d18079701c9f	b11aa2221c18d2d90d067f3d8bfa8c9b864f383e27e7e641a075b0e042ffbc60	2026-05-27 10:34:09.29+00	f	2026-05-20 10:34:09.290504+00
14	d3dea6c0-681d-4fc0-85a7-d18079701c9f	f705bb2a98da26a4a8bc3618d0d03df61ef0218ca44855b22a6140d874e5e152	2026-05-27 10:39:46.236+00	f	2026-05-20 10:39:46.236605+00
\.


--
-- Data for Name: search_audit; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.search_audit (id, snapshot_date, search_name, search_type, app, schedule, is_scheduled, is_alert, last_run, confidence_score, reason, status, risk_level, is_unused, created_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: security_coverage; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.security_coverage (id, snapshot_date, sourcetype, coverage_pct, active_alerts, detection_gaps, created_at) FROM stdin;
\.


--
-- Data for Name: snapshot_metadata; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.snapshot_metadata (id, snapshot_id, snapshot_date, total_indexes, total_sourcetypes, llm_version, prompt_version, model_version, heuristic_version, indexes_unchanged, indexes_changed, indexes_new, indexes_removed, total_llm_queries, avg_inference_latency_ms, worker_memory_peak_mb, created_at) FROM stdin;
\.


--
-- Data for Name: telemetry_facts; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.telemetry_facts (fact_id, index_name, snapshot_timestamp, created_at, daily_avg_gb, utilization_pct, retention_days, storage_cost_per_gb_mo, days_since_last_event) FROM stdin;
\.


--
-- Data for Name: telemetry_snapshots; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.telemetry_snapshots (id, snapshot_id, snapshot_date, granularity, parent_index, index_name, sourcetype, total_events, daily_avg_gb, retention_days, utilization_pct, cost_per_year, risk_score, classification, confidence, recommendation, evidence, raw_metadata, created_at, updated_at, tenant_id) FROM stdin;
\.


--
-- Data for Name: tenant_audit_log; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.tenant_audit_log (id, tenant_id, user_id, action, resource_type, resource_id, changes, ip_address, created_at) FROM stdin;
2262cb4d-9211-44a9-90c5-f0c4f9c069b8	87a9cb8f-7318-4ca9-817c-130af6de2b07	a80e3a12-be88-4ae0-b63e-4df368033b4b	ADMIN_USER_CREATED	users	a80e3a12-be88-4ae0-b63e-4df368033b4b	{"role": "admin", "email": "admin@teja.local"}	::ffff:151.101.130.132	2026-05-20 09:38:46.795149+00
42e3d26d-51da-4b96-9f3a-1ea93c5f730a	b0f60c84-5691-47d8-95e3-51867b46965b	d3dea6c0-681d-4fc0-85a7-d18079701c9f	ADMIN_USER_CREATED	users	d3dea6c0-681d-4fc0-85a7-d18079701c9f	{"role": "admin", "email": "admin@demo.local"}	::ffff:151.101.130.132	2026-05-20 09:40:06.389162+00
\.


--
-- Data for Name: tenant_config; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.tenant_config (id, tenant_id, cost_per_gb_per_day, max_retention_days, max_parallel, decision_weights, retention_policy, notification_config, created_at, updated_at) FROM stdin;
6d2eb3ff-a639-49b5-9af0-7f02595ce197	87a9cb8f-7318-4ca9-817c-130af6de2b07	0.50	730	2	{}	{"CRITICAL": 730, "IMPORTANT": 365, "LOW_VALUE": 30, "NICE_TO_HAVE": 90}	{"email": true, "in_app": true, "webhook": false}	2026-05-20 09:37:02.913066+00	2026-05-20 09:37:02.913066+00
ccb8f031-d664-4a39-8298-c73a92fbdde2	b0f60c84-5691-47d8-95e3-51867b46965b	0.50	730	2	{}	{"CRITICAL": 730, "IMPORTANT": 365, "LOW_VALUE": 30, "NICE_TO_HAVE": 90}	{"email": true, "in_app": true, "webhook": false}	2026-05-20 09:40:02.186782+00	2026-05-20 09:40:02.186782+00
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.tenants (id, name, slug, splunk_url, splunk_hec_token, splunk_username, splunk_password, splunk_ssl_verify, tenant_status, is_configured, last_splunk_test, splunk_test_status, splunk_test_error, created_at, updated_at, deleted_at) FROM stdin;
87a9cb8f-7318-4ca9-817c-130af6de2b07	Teja Corp	teja	\N	\N	\N	\N	t	active	f	\N	\N	\N	2026-05-20 09:37:02.911553+00	2026-05-20 09:37:02.911553+00	\N
b0f60c84-5691-47d8-95e3-51867b46965b	Demo Corp	demo	\N	\N	\N	\N	t	active	f	\N	\N	\N	2026-05-20 09:40:02.185308+00	2026-05-20 09:40:02.185308+00	\N
7b0e7fe4-d58b-da24-deb7-3427df7ed363	Demo Tenant	demo-tenant	\N	\N	\N	\N	t	active	f	\N	\N	\N	2026-05-20 10:37:31.742074+00	2026-05-20 10:37:31.742074+00	\N
\.


--
-- Data for Name: user_config; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.user_config (id, config_key, cost_per_gb_per_day, max_retention_days, max_parallel, decision_weights, retention_policy, created_at, updated_at, tenant_id) FROM stdin;
1	default	0.50	730	2	{}	{"CRITICAL": 730, "IMPORTANT": 365, "LOW_VALUE": 30, "NICE_TO_HAVE": 90}	2026-05-20 09:13:40.417731+00	2026-05-20 09:13:40.417731+00	\N
\.


--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.user_sessions (id, user_id, tenant_id, token, ip_address, user_agent, expires_at, created_at, last_activity_at, is_revoked) FROM stdin;
cfcca6ab-7886-4bfd-9759-83a6be745ca2	a80e3a12-be88-4ae0-b63e-4df368033b4b	87a9cb8f-7318-4ca9-817c-130af6de2b07	eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYTgwZTNhMTItYmU4OC00YWUwLWI2M2UtNGRmMzY4MDMzYjRiIiwidGVuYW50X2lkIjoiODdhOWNiOGYtNzMxOC00Y2E5LTgxN2MtMTMwYWY2ZGUyYjA3IiwiZW1haWwiOiIiLCJyb2xlIjoiIiwiaWF0IjoxNzc5MjY5OTMzLCJleHAiOjE3Nzk4NzQ3MzN9.gyt6DmpLiA2x46lQ9TUq-hetuStsfP6__iqyO4zSn-A	::ffff:151.101.130.132	\N	2026-05-27 09:38:53.474+00	2026-05-20 09:38:53.474317+00	2026-05-20 09:38:59.597254+00	f
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: telemetry
--

COPY public.users (id, tenant_id, email, name, password_hash, role, auth_provider, last_login, login_attempts, is_locked, locked_until, created_at, updated_at) FROM stdin;
a80e3a12-be88-4ae0-b63e-4df368033b4b	87a9cb8f-7318-4ca9-817c-130af6de2b07	admin@teja.local	Teja Admin	$2a$12$PAXqY5y8rT8NwsjT7bU3BOJdMf6ZsbRKRMx4n5gYyuM0To9OW471a	admin	local	2026-05-20 09:38:53.461651+00	0	f	\N	2026-05-20 09:38:46.792898+00	2026-05-20 09:38:53.461651+00
d3dea6c0-681d-4fc0-85a7-d18079701c9f	b0f60c84-5691-47d8-95e3-51867b46965b	admin@demo.local	Demo Admin	$2a$12$fw.MSs8RG/6V7bI9x1zjZ.nN2AmX3zODIO2PXtxSxgBEQaDGIt42O	admin	local	2026-05-20 10:39:46.231617+00	0	f	\N	2026-05-20 09:40:06.386856+00	2026-05-20 10:39:46.231617+00
\.


--
-- Name: agent_decisions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.agent_decisions_id_seq', 3, true);


--
-- Name: applied_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.applied_migrations_id_seq', 67, true);


--
-- Name: cache_metadata_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.cache_metadata_id_seq', 1, false);


--
-- Name: config_audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.config_audit_log_id_seq', 1, false);


--
-- Name: decision_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.decision_history_id_seq', 1, false);


--
-- Name: decision_overrides_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.decision_overrides_id_seq', 1, false);


--
-- Name: decision_traces_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.decision_traces_id_seq', 1, false);


--
-- Name: executive_kpis_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.executive_kpis_id_seq', 1, false);


--
-- Name: field_usage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.field_usage_id_seq', 1, false);


--
-- Name: index_metadata_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.index_metadata_history_id_seq', 1, false);


--
-- Name: job_queue_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.job_queue_id_seq', 1, false);


--
-- Name: llm_prompt_versions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.llm_prompt_versions_id_seq', 1, true);


--
-- Name: migration_health_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.migration_health_id_seq', 33, true);


--
-- Name: migration_locks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.migration_locks_id_seq', 23, true);


--
-- Name: migration_rollbacks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.migration_rollbacks_id_seq', 1, false);


--
-- Name: pipeline_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.pipeline_events_id_seq', 1, false);


--
-- Name: pipeline_executions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.pipeline_executions_id_seq', 1, false);


--
-- Name: quality_hotspots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.quality_hotspots_id_seq', 1, false);


--
-- Name: refresh_jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.refresh_jobs_id_seq', 1, false);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.refresh_tokens_id_seq', 14, true);


--
-- Name: search_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.search_audit_id_seq', 1, false);


--
-- Name: security_coverage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.security_coverage_id_seq', 1, false);


--
-- Name: snapshot_metadata_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.snapshot_metadata_id_seq', 1, false);


--
-- Name: telemetry_snapshots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.telemetry_snapshots_id_seq', 1, false);


--
-- Name: user_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: telemetry
--

SELECT pg_catalog.setval('public.user_config_id_seq', 1, true);


--
-- Name: agent_decisions agent_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT agent_decisions_pkey PRIMARY KEY (id);


--
-- Name: applied_migrations applied_migrations_name_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.applied_migrations
    ADD CONSTRAINT applied_migrations_name_key UNIQUE (name);


--
-- Name: applied_migrations applied_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.applied_migrations
    ADD CONSTRAINT applied_migrations_pkey PRIMARY KEY (id);


--
-- Name: cache_coherence_telemetry cache_coherence_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.cache_coherence_telemetry
    ADD CONSTRAINT cache_coherence_telemetry_pkey PRIMARY KEY (coherence_id);


--
-- Name: cache_metadata cache_metadata_cache_key_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.cache_metadata
    ADD CONSTRAINT cache_metadata_cache_key_key UNIQUE (cache_key);


--
-- Name: cache_metadata cache_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.cache_metadata
    ADD CONSTRAINT cache_metadata_pkey PRIMARY KEY (id);


--
-- Name: cognitive_enrichments cognitive_enrichments_fact_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.cognitive_enrichments
    ADD CONSTRAINT cognitive_enrichments_fact_id_key UNIQUE (fact_id);


--
-- Name: cognitive_enrichments cognitive_enrichments_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.cognitive_enrichments
    ADD CONSTRAINT cognitive_enrichments_pkey PRIMARY KEY (enrichment_id);


--
-- Name: confidence_calibration_log confidence_calibration_log_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.confidence_calibration_log
    ADD CONSTRAINT confidence_calibration_log_pkey PRIMARY KEY (log_id);


--
-- Name: config_audit_log config_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.config_audit_log
    ADD CONSTRAINT config_audit_log_pkey PRIMARY KEY (id);


--
-- Name: decision_drift_history decision_drift_history_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_drift_history
    ADD CONSTRAINT decision_drift_history_pkey PRIMARY KEY (drift_id);


--
-- Name: decision_history decision_history_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_history
    ADD CONSTRAINT decision_history_pkey PRIMARY KEY (id);


--
-- Name: decision_lineage decision_lineage_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_lineage
    ADD CONSTRAINT decision_lineage_pkey PRIMARY KEY (id);


--
-- Name: decision_overrides decision_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_overrides
    ADD CONSTRAINT decision_overrides_pkey PRIMARY KEY (id);


--
-- Name: decision_traces decision_traces_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_traces
    ADD CONSTRAINT decision_traces_pkey PRIMARY KEY (id);


--
-- Name: envelope_signature_failures envelope_signature_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.envelope_signature_failures
    ADD CONSTRAINT envelope_signature_failures_pkey PRIMARY KEY (failure_id);


--
-- Name: envelope_signing_keys envelope_signing_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.envelope_signing_keys
    ADD CONSTRAINT envelope_signing_keys_pkey PRIMARY KEY (key_id);


--
-- Name: executive_kpis executive_kpis_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.executive_kpis
    ADD CONSTRAINT executive_kpis_pkey PRIMARY KEY (id);


--
-- Name: executive_kpis executive_kpis_snapshot_date_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.executive_kpis
    ADD CONSTRAINT executive_kpis_snapshot_date_key UNIQUE (snapshot_date);


--
-- Name: field_usage field_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.field_usage
    ADD CONSTRAINT field_usage_pkey PRIMARY KEY (id);


--
-- Name: governance_audit_snapshots governance_audit_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.governance_audit_snapshots
    ADD CONSTRAINT governance_audit_snapshots_pkey PRIMARY KEY (snapshot_id);


--
-- Name: governance_mutation_journal governance_mutation_journal_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.governance_mutation_journal
    ADD CONSTRAINT governance_mutation_journal_pkey PRIMARY KEY (event_id);


--
-- Name: governance_replay_journal governance_replay_journal_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.governance_replay_journal
    ADD CONSTRAINT governance_replay_journal_pkey PRIMARY KEY (replay_id);


--
-- Name: governance_telemetry governance_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.governance_telemetry
    ADD CONSTRAINT governance_telemetry_pkey PRIMARY KEY (telemetry_id);


--
-- Name: human_review_ledger human_review_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.human_review_ledger
    ADD CONSTRAINT human_review_ledger_pkey PRIMARY KEY (review_id);


--
-- Name: index_metadata_history index_metadata_history_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.index_metadata_history
    ADD CONSTRAINT index_metadata_history_pkey PRIMARY KEY (id);


--
-- Name: index_rolling_baselines index_rolling_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.index_rolling_baselines
    ADD CONSTRAINT index_rolling_baselines_pkey PRIMARY KEY (index_name);


--
-- Name: job_queue job_queue_job_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.job_queue
    ADD CONSTRAINT job_queue_job_id_key UNIQUE (job_id);


--
-- Name: job_queue job_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.job_queue
    ADD CONSTRAINT job_queue_pkey PRIMARY KEY (id);


--
-- Name: llm_prompt_versions llm_prompt_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.llm_prompt_versions
    ADD CONSTRAINT llm_prompt_versions_pkey PRIMARY KEY (id);


--
-- Name: llm_prompt_versions llm_prompt_versions_version_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.llm_prompt_versions
    ADD CONSTRAINT llm_prompt_versions_version_key UNIQUE (version);


--
-- Name: migration_health migration_health_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.migration_health
    ADD CONSTRAINT migration_health_pkey PRIMARY KEY (id);


--
-- Name: migration_locks migration_locks_lock_key_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.migration_locks
    ADD CONSTRAINT migration_locks_lock_key_key UNIQUE (lock_key);


--
-- Name: migration_locks migration_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.migration_locks
    ADD CONSTRAINT migration_locks_pkey PRIMARY KEY (id);


--
-- Name: migration_rollbacks migration_rollbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.migration_rollbacks
    ADD CONSTRAINT migration_rollbacks_pkey PRIMARY KEY (id);


--
-- Name: mutation_lifecycle_events mutation_lifecycle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.mutation_lifecycle_events
    ADD CONSTRAINT mutation_lifecycle_events_pkey PRIMARY KEY (event_id);


--
-- Name: operator_identity_mapping operator_identity_mapping_anonymized_token_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.operator_identity_mapping
    ADD CONSTRAINT operator_identity_mapping_anonymized_token_key UNIQUE (anonymized_token);


--
-- Name: operator_identity_mapping operator_identity_mapping_original_operator_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.operator_identity_mapping
    ADD CONSTRAINT operator_identity_mapping_original_operator_id_key UNIQUE (original_operator_id);


--
-- Name: operator_identity_mapping operator_identity_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.operator_identity_mapping
    ADD CONSTRAINT operator_identity_mapping_pkey PRIMARY KEY (mapping_id);


--
-- Name: operator_sessions operator_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.operator_sessions
    ADD CONSTRAINT operator_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: pipeline_events pipeline_events_event_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_events
    ADD CONSTRAINT pipeline_events_event_id_key UNIQUE (event_id);


--
-- Name: pipeline_events pipeline_events_execution_id_event_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_events
    ADD CONSTRAINT pipeline_events_execution_id_event_id_key UNIQUE (execution_id, event_id);


--
-- Name: pipeline_events pipeline_events_execution_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_events
    ADD CONSTRAINT pipeline_events_execution_id_sequence_key UNIQUE (execution_id, sequence);


--
-- Name: pipeline_events pipeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_events
    ADD CONSTRAINT pipeline_events_pkey PRIMARY KEY (id);


--
-- Name: pipeline_executions pipeline_executions_execution_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_executions
    ADD CONSTRAINT pipeline_executions_execution_id_key UNIQUE (execution_id);


--
-- Name: pipeline_executions pipeline_executions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_executions
    ADD CONSTRAINT pipeline_executions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: pipeline_executions pipeline_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_executions
    ADD CONSTRAINT pipeline_executions_pkey PRIMARY KEY (id);


--
-- Name: quality_hotspots quality_hotspots_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.quality_hotspots
    ADD CONSTRAINT quality_hotspots_pkey PRIMARY KEY (id);


--
-- Name: reanalysis_job_queue reanalysis_job_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.reanalysis_job_queue
    ADD CONSTRAINT reanalysis_job_queue_pkey PRIMARY KEY (job_id);


--
-- Name: recommendation_actions recommendation_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.recommendation_actions
    ADD CONSTRAINT recommendation_actions_pkey PRIMARY KEY (id);


--
-- Name: recommendation_audit_log recommendation_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.recommendation_audit_log
    ADD CONSTRAINT recommendation_audit_log_pkey PRIMARY KEY (id);


--
-- Name: recovery_milestones recovery_milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.recovery_milestones
    ADD CONSTRAINT recovery_milestones_pkey PRIMARY KEY (milestone_id);


--
-- Name: refresh_jobs refresh_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.refresh_jobs
    ADD CONSTRAINT refresh_jobs_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: search_audit search_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.search_audit
    ADD CONSTRAINT search_audit_pkey PRIMARY KEY (id);


--
-- Name: security_coverage security_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.security_coverage
    ADD CONSTRAINT security_coverage_pkey PRIMARY KEY (id);


--
-- Name: snapshot_metadata snapshot_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.snapshot_metadata
    ADD CONSTRAINT snapshot_metadata_pkey PRIMARY KEY (id);


--
-- Name: snapshot_metadata snapshot_metadata_snapshot_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.snapshot_metadata
    ADD CONSTRAINT snapshot_metadata_snapshot_id_key UNIQUE (snapshot_id);


--
-- Name: telemetry_facts telemetry_facts_index_name_snapshot_timestamp_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.telemetry_facts
    ADD CONSTRAINT telemetry_facts_index_name_snapshot_timestamp_key UNIQUE (index_name, snapshot_timestamp);


--
-- Name: telemetry_facts telemetry_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.telemetry_facts
    ADD CONSTRAINT telemetry_facts_pkey PRIMARY KEY (fact_id);


--
-- Name: telemetry_snapshots telemetry_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.telemetry_snapshots
    ADD CONSTRAINT telemetry_snapshots_pkey PRIMARY KEY (id);


--
-- Name: tenant_audit_log tenant_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenant_audit_log
    ADD CONSTRAINT tenant_audit_log_pkey PRIMARY KEY (id);


--
-- Name: tenant_config tenant_config_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenant_config
    ADD CONSTRAINT tenant_config_pkey PRIMARY KEY (id);


--
-- Name: tenant_config tenant_config_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenant_config
    ADD CONSTRAINT tenant_config_tenant_id_key UNIQUE (tenant_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: user_config unique_tenant_config; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_config
    ADD CONSTRAINT unique_tenant_config UNIQUE (tenant_id, config_key);


--
-- Name: agent_decisions uq_agent_decision_identity; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT uq_agent_decision_identity UNIQUE (snapshot_id, index_name, sourcetype);


--
-- Name: index_metadata_history uq_index_snapshot; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.index_metadata_history
    ADD CONSTRAINT uq_index_snapshot UNIQUE (snapshot_date, index_name, sourcetype);


--
-- Name: snapshot_metadata uq_snapshot_by_date; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.snapshot_metadata
    ADD CONSTRAINT uq_snapshot_by_date UNIQUE (snapshot_date);


--
-- Name: telemetry_snapshots uq_snapshot_identity; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.telemetry_snapshots
    ADD CONSTRAINT uq_snapshot_identity UNIQUE (snapshot_date, granularity, index_name, sourcetype);


--
-- Name: user_config user_config_config_key_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_config
    ADD CONSTRAINT user_config_config_key_key UNIQUE (config_key);


--
-- Name: user_config user_config_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_config
    ADD CONSTRAINT user_config_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_token_key UNIQUE (token);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_tenant_id_email_key; Type: CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_email_key UNIQUE (tenant_id, email);


--
-- Name: idx_active_signing_key; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE UNIQUE INDEX idx_active_signing_key ON public.envelope_signing_keys USING btree (tenant_id) WHERE ((is_active = true) AND (can_sign = true) AND (retired_at IS NULL));


--
-- Name: idx_agent_decisions_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_agent_decisions_date ON public.agent_decisions USING btree (snapshot_date DESC);


--
-- Name: idx_agent_decisions_index; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_agent_decisions_index ON public.agent_decisions USING btree (index_name);


--
-- Name: idx_agent_decisions_reason; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_agent_decisions_reason ON public.agent_decisions USING gin (candidate_reason);


--
-- Name: idx_agent_decisions_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_agent_decisions_tenant ON public.agent_decisions USING btree (tenant_id);


--
-- Name: idx_applied_migrations_applied_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_applied_migrations_applied_at ON public.applied_migrations USING btree (applied_at DESC);


--
-- Name: idx_applied_migrations_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_applied_migrations_name ON public.applied_migrations USING btree (name);


--
-- Name: idx_audit_log_action; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_audit_log_action ON public.tenant_audit_log USING btree (action);


--
-- Name: idx_audit_log_created; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_audit_log_created ON public.tenant_audit_log USING btree (created_at);


--
-- Name: idx_audit_log_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_audit_log_tenant ON public.tenant_audit_log USING btree (tenant_id);


--
-- Name: idx_audit_log_user; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_audit_log_user ON public.tenant_audit_log USING btree (user_id);


--
-- Name: idx_audit_snapshots_governance_state; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_audit_snapshots_governance_state ON public.governance_audit_snapshots USING btree (governance_state);


--
-- Name: idx_audit_snapshots_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_audit_snapshots_index_name ON public.governance_audit_snapshots USING btree (index_name);


--
-- Name: idx_audit_snapshots_snapshot_timestamp; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_audit_snapshots_snapshot_timestamp ON public.governance_audit_snapshots USING btree (snapshot_timestamp DESC);


--
-- Name: idx_baselines_recovery_score; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_baselines_recovery_score ON public.index_rolling_baselines USING btree (recovery_score DESC);


--
-- Name: idx_baselines_stable_days; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_baselines_stable_days ON public.index_rolling_baselines USING btree (consecutive_stable_days DESC);


--
-- Name: idx_cache_next_refresh; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_cache_next_refresh ON public.cache_metadata USING btree (next_refresh_at);


--
-- Name: idx_cache_status; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_cache_status ON public.cache_metadata USING btree (status);


--
-- Name: idx_calibration_log_approval; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_calibration_log_approval ON public.confidence_calibration_log USING btree (approval_state);


--
-- Name: idx_calibration_log_band; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_calibration_log_band ON public.confidence_calibration_log USING btree (confidence_band);


--
-- Name: idx_calibration_log_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_calibration_log_index_name ON public.confidence_calibration_log USING btree (index_name);


--
-- Name: idx_cognitive_enrichments_fact_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_cognitive_enrichments_fact_id ON public.cognitive_enrichments USING btree (fact_id);


--
-- Name: idx_coherence_correlation_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_coherence_correlation_id ON public.cache_coherence_telemetry USING btree (correlation_id);


--
-- Name: idx_coherence_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_coherence_index_name ON public.cache_coherence_telemetry USING btree (index_name);


--
-- Name: idx_coherence_is_divergent; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_coherence_is_divergent ON public.cache_coherence_telemetry USING btree (is_divergent) WHERE (is_divergent = true);


--
-- Name: idx_coherence_mutation_committed; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_coherence_mutation_committed ON public.cache_coherence_telemetry USING btree (mutation_committed_at DESC);


--
-- Name: idx_config_audit_created_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_config_audit_created_at ON public.config_audit_log USING btree (created_at);


--
-- Name: idx_config_audit_key; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_config_audit_key ON public.config_audit_log USING btree (config_key);


--
-- Name: idx_decision_created_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_created_at ON public.decision_history USING btree (created_at);


--
-- Name: idx_decision_drift_history_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_drift_history_index_name ON public.decision_drift_history USING btree (index_name);


--
-- Name: idx_decision_drift_history_severity; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_drift_history_severity ON public.decision_drift_history USING btree (drift_severity);


--
-- Name: idx_decision_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_index_name ON public.decision_history USING btree (index_name);


--
-- Name: idx_decision_lineage_index; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_lineage_index ON public.decision_lineage USING btree (index_name);


--
-- Name: idx_decision_lineage_snapshot; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_lineage_snapshot ON public.decision_lineage USING btree (snapshot_id);


--
-- Name: idx_decision_lineage_status; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_lineage_status ON public.decision_lineage USING btree (decision_status);


--
-- Name: idx_decision_overrides_expiry; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_overrides_expiry ON public.decision_overrides USING btree (override_expiry) WHERE (override_expiry IS NOT NULL);


--
-- Name: idx_decision_overrides_index; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_overrides_index ON public.decision_overrides USING btree (index_name);


--
-- Name: idx_decision_overrides_snapshot; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_overrides_snapshot ON public.decision_overrides USING btree (snapshot_id);


--
-- Name: idx_decision_snapshot_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_decision_snapshot_date ON public.decision_history USING btree (snapshot_id, snapshot_date);


--
-- Name: idx_exec_kpis_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_exec_kpis_date ON public.executive_kpis USING btree (snapshot_date DESC);


--
-- Name: idx_exec_kpis_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_exec_kpis_tenant ON public.executive_kpis USING btree (tenant_id);


--
-- Name: idx_field_usage_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_field_usage_date ON public.field_usage USING btree (snapshot_date DESC);


--
-- Name: idx_human_review_ledger_fact_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_human_review_ledger_fact_id ON public.human_review_ledger USING btree (fact_id);


--
-- Name: idx_human_review_ledger_review_action; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_human_review_ledger_review_action ON public.human_review_ledger USING btree (review_action);


--
-- Name: idx_index_metadata_history_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_index_metadata_history_date ON public.index_metadata_history USING btree (snapshot_date DESC);


--
-- Name: idx_index_metadata_history_index; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_index_metadata_history_index ON public.index_metadata_history USING btree (index_name);


--
-- Name: idx_job_queue_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_job_queue_date ON public.job_queue USING btree (snapshot_date DESC);


--
-- Name: idx_job_queue_job_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_job_queue_job_id ON public.job_queue USING btree (job_id);


--
-- Name: idx_job_queue_pending; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_job_queue_pending ON public.job_queue USING btree (created_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_job_queue_status; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_job_queue_status ON public.job_queue USING btree (status);


--
-- Name: idx_job_queue_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_job_queue_tenant ON public.job_queue USING btree (tenant_id);


--
-- Name: idx_key_lifecycle; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_key_lifecycle ON public.envelope_signing_keys USING btree (tenant_id, created_at DESC) WHERE (retired_at IS NULL);


--
-- Name: idx_lifecycle_correlation_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_lifecycle_correlation_id ON public.mutation_lifecycle_events USING btree (correlation_id);


--
-- Name: idx_lifecycle_entered_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_lifecycle_entered_at ON public.mutation_lifecycle_events USING btree (entered_at DESC);


--
-- Name: idx_lifecycle_metadata; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_lifecycle_metadata ON public.mutation_lifecycle_events USING gin (metadata);


--
-- Name: idx_lifecycle_span_parent; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_lifecycle_span_parent ON public.mutation_lifecycle_events USING btree (trace_id, parent_span_id);


--
-- Name: idx_lifecycle_state; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_lifecycle_state ON public.mutation_lifecycle_events USING btree (lifecycle_state);


--
-- Name: idx_lifecycle_trace_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_lifecycle_trace_id ON public.mutation_lifecycle_events USING btree (trace_id);


--
-- Name: idx_migration_health_checked_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_migration_health_checked_at ON public.migration_health USING btree (checked_at DESC);


--
-- Name: idx_migration_locks_expires_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_migration_locks_expires_at ON public.migration_locks USING btree (expires_at);


--
-- Name: idx_migration_locks_lock_key; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_migration_locks_lock_key ON public.migration_locks USING btree (lock_key);


--
-- Name: idx_milestones_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_milestones_index_name ON public.recovery_milestones USING btree (index_name);


--
-- Name: idx_milestones_type; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_milestones_type ON public.recovery_milestones USING btree (milestone_type);


--
-- Name: idx_mutation_journal_causal_parent; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_causal_parent ON public.governance_mutation_journal USING btree (causal_parent_id);


--
-- Name: idx_mutation_journal_correlation_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_correlation_id ON public.governance_mutation_journal USING btree (correlation_id);


--
-- Name: idx_mutation_journal_event_type; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_event_type ON public.governance_mutation_journal USING btree (event_type);


--
-- Name: idx_mutation_journal_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_index_name ON public.governance_mutation_journal USING btree (index_name);


--
-- Name: idx_mutation_journal_operator_session; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_operator_session ON public.governance_mutation_journal USING btree (operator_session_id);


--
-- Name: idx_mutation_journal_recorded_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_recorded_at ON public.governance_mutation_journal USING btree (recorded_at DESC);


--
-- Name: idx_mutation_journal_reviewer_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_reviewer_id ON public.governance_mutation_journal USING btree (reviewer_id);


--
-- Name: idx_mutation_journal_session_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_session_id ON public.governance_mutation_journal USING btree (session_id);


--
-- Name: idx_mutation_journal_trace_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_mutation_journal_trace_id ON public.governance_mutation_journal USING btree (trace_id);


--
-- Name: idx_operator_mapping_anon_token; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_operator_mapping_anon_token ON public.operator_identity_mapping USING btree (anonymized_token);


--
-- Name: idx_operator_mapping_original; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_operator_mapping_original ON public.operator_identity_mapping USING btree (original_operator_id);


--
-- Name: idx_operator_sessions_reviewer_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_operator_sessions_reviewer_id ON public.operator_sessions USING btree (reviewer_id);


--
-- Name: idx_operator_sessions_started_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_operator_sessions_started_at ON public.operator_sessions USING btree (started_at DESC);


--
-- Name: idx_pipeline_event_actor; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_actor ON public.pipeline_events USING btree (actor);


--
-- Name: idx_pipeline_event_correlation; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_correlation ON public.pipeline_events USING btree (correlation_id);


--
-- Name: idx_pipeline_event_created; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_created ON public.pipeline_events USING btree (created_at DESC);


--
-- Name: idx_pipeline_event_execution; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_execution ON public.pipeline_events USING btree (execution_id, sequence);


--
-- Name: idx_pipeline_event_operator_timeline; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_operator_timeline ON public.pipeline_events USING btree (operator_session_id, created_at DESC);


--
-- Name: idx_pipeline_event_policy_recent; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_policy_recent ON public.pipeline_events USING btree (taxonomy, "timestamp" DESC) WHERE ((taxonomy)::text = 'POLICY'::text);


--
-- Name: idx_pipeline_event_recent; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_recent ON public.pipeline_events USING btree (created_at DESC, taxonomy);


--
-- Name: idx_pipeline_event_session; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_session ON public.pipeline_events USING btree (operator_session_id);


--
-- Name: idx_pipeline_event_taxonomy; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_taxonomy ON public.pipeline_events USING btree (taxonomy);


--
-- Name: idx_pipeline_event_timestamp; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_timestamp ON public.pipeline_events USING btree ("timestamp" DESC);


--
-- Name: idx_pipeline_event_type; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_event_type ON public.pipeline_events USING btree (event_type);


--
-- Name: idx_pipeline_exec_correlation; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_exec_correlation ON public.pipeline_executions USING btree (correlation_id);


--
-- Name: idx_pipeline_exec_created; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_exec_created ON public.pipeline_executions USING btree (created_at DESC);


--
-- Name: idx_pipeline_exec_decision; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_exec_decision ON public.pipeline_executions USING btree (agent_decision_id);


--
-- Name: idx_pipeline_exec_idempotency; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_exec_idempotency ON public.pipeline_executions USING btree (idempotency_key);


--
-- Name: idx_pipeline_exec_stage; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_pipeline_exec_stage ON public.pipeline_executions USING btree (current_stage);


--
-- Name: idx_quality_hotspots_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_quality_hotspots_date ON public.quality_hotspots USING btree (snapshot_date DESC);


--
-- Name: idx_quality_summary_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_quality_summary_tenant ON public.quality_hotspots USING btree (tenant_id);


--
-- Name: idx_reanalysis_job_queue_execution_state; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_reanalysis_job_queue_execution_state ON public.reanalysis_job_queue USING btree (execution_state);


--
-- Name: idx_reanalysis_job_queue_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_reanalysis_job_queue_index_name ON public.reanalysis_job_queue USING btree (index_name);


--
-- Name: idx_reanalysis_job_queue_priority_tier; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_reanalysis_job_queue_priority_tier ON public.reanalysis_job_queue USING btree (priority_tier);


--
-- Name: idx_rec_actions_index; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rec_actions_index ON public.recommendation_actions USING btree (index_name);


--
-- Name: idx_rec_actions_snapshot; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rec_actions_snapshot ON public.recommendation_actions USING btree (snapshot_id);


--
-- Name: idx_rec_actions_status; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rec_actions_status ON public.recommendation_actions USING btree (status);


--
-- Name: idx_rec_actions_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rec_actions_tenant ON public.recommendation_actions USING btree (tenant_id);


--
-- Name: idx_rec_audit_action; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rec_audit_action ON public.recommendation_audit_log USING btree (action_id);


--
-- Name: idx_rec_audit_snapshot; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rec_audit_snapshot ON public.recommendation_audit_log USING btree (snapshot_id);


--
-- Name: idx_rec_audit_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rec_audit_tenant ON public.recommendation_audit_log USING btree (tenant_id);


--
-- Name: idx_refresh_jobs_started; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_refresh_jobs_started ON public.refresh_jobs USING btree (started_at);


--
-- Name: idx_refresh_jobs_status; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_refresh_jobs_status ON public.refresh_jobs USING btree (status);


--
-- Name: idx_refresh_tokens_user_revoked; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_refresh_tokens_user_revoked ON public.refresh_tokens USING btree (user_id, is_revoked);


--
-- Name: idx_replay_requested_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_replay_requested_at ON public.governance_replay_journal USING btree (requested_at DESC);


--
-- Name: idx_replay_requester_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_replay_requester_id ON public.governance_replay_journal USING btree (requester_id);


--
-- Name: idx_replay_status; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_replay_status ON public.governance_replay_journal USING btree (replay_status);


--
-- Name: idx_replay_target_index; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_replay_target_index ON public.governance_replay_journal USING btree (target_index_name);


--
-- Name: idx_rollbacks_migration_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rollbacks_migration_name ON public.migration_rollbacks USING btree (migration_name);


--
-- Name: idx_rollbacks_rolled_back_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_rollbacks_rolled_back_at ON public.migration_rollbacks USING btree (rolled_back_at DESC);


--
-- Name: idx_search_audit_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_search_audit_date ON public.search_audit USING btree (snapshot_date DESC);


--
-- Name: idx_search_audit_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_search_audit_tenant ON public.search_audit USING btree (tenant_id);


--
-- Name: idx_security_coverage_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_security_coverage_date ON public.security_coverage USING btree (snapshot_date DESC);


--
-- Name: idx_sessions_expires_at; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_sessions_expires_at ON public.user_sessions USING btree (expires_at);


--
-- Name: idx_sessions_tenant_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_sessions_tenant_id ON public.user_sessions USING btree (tenant_id);


--
-- Name: idx_sessions_token; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_sessions_token ON public.user_sessions USING btree (token);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: idx_signature_failures; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_signature_failures ON public.envelope_signature_failures USING btree (tenant_id, recorded_at DESC);


--
-- Name: idx_snapshot_metadata_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_snapshot_metadata_date ON public.snapshot_metadata USING btree (snapshot_date DESC);


--
-- Name: idx_snapshots_classification; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_snapshots_classification ON public.telemetry_snapshots USING btree (classification);


--
-- Name: idx_snapshots_created; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_snapshots_created ON public.telemetry_snapshots USING btree (created_at);


--
-- Name: idx_snapshots_date; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_snapshots_date ON public.telemetry_snapshots USING btree (snapshot_date);


--
-- Name: idx_snapshots_date_gran; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_snapshots_date_gran ON public.telemetry_snapshots USING btree (snapshot_date, granularity);


--
-- Name: idx_snapshots_gran_parent; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_snapshots_gran_parent ON public.telemetry_snapshots USING btree (granularity, parent_index);


--
-- Name: idx_snapshots_index; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_snapshots_index ON public.telemetry_snapshots USING btree (index_name);


--
-- Name: idx_telemetry_facts_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_telemetry_facts_index_name ON public.telemetry_facts USING btree (index_name);


--
-- Name: idx_telemetry_facts_snapshot_timestamp; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_telemetry_facts_snapshot_timestamp ON public.telemetry_facts USING btree (snapshot_timestamp);


--
-- Name: idx_telemetry_index_name; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_telemetry_index_name ON public.governance_telemetry USING btree (index_name);


--
-- Name: idx_telemetry_is_degraded; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_telemetry_is_degraded ON public.governance_telemetry USING btree (is_degraded) WHERE (is_degraded = true);


--
-- Name: idx_telemetry_measurement_window; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_telemetry_measurement_window ON public.governance_telemetry USING btree (measurement_window DESC);


--
-- Name: idx_telemetry_snapshots_tenant; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_telemetry_snapshots_tenant ON public.telemetry_snapshots USING btree (tenant_id);


--
-- Name: idx_tenant_config_tenant_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_tenant_config_tenant_id ON public.tenant_config USING btree (tenant_id);


--
-- Name: idx_tenants_slug; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_tenants_slug ON public.tenants USING btree (slug);


--
-- Name: idx_tenants_status; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_tenants_status ON public.tenants USING btree (tenant_status);


--
-- Name: idx_traces_stage; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_traces_stage ON public.decision_traces USING btree (stage);


--
-- Name: idx_traces_timestamp; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_traces_timestamp ON public.decision_traces USING btree ("timestamp");


--
-- Name: idx_traces_trace_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_traces_trace_id ON public.decision_traces USING btree (trace_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_tenant_id; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_users_tenant_id ON public.users USING btree (tenant_id);


--
-- Name: idx_verification_keys; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE INDEX idx_verification_keys ON public.envelope_signing_keys USING btree (tenant_id, key_algorithm) WHERE ((can_verify = true) AND (retired_at IS NULL));


--
-- Name: uq_decision_lineage_identity; Type: INDEX; Schema: public; Owner: telemetry
--

CREATE UNIQUE INDEX uq_decision_lineage_identity ON public.decision_lineage USING btree (snapshot_id, index_name, COALESCE(sourcetype, ''::character varying));


--
-- Name: pipeline_events trg_validate_event_sequence; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER trg_validate_event_sequence BEFORE INSERT OR UPDATE ON public.pipeline_events FOR EACH ROW EXECUTE FUNCTION public.validate_event_sequence();


--
-- Name: agent_decisions update_agent_decisions_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_agent_decisions_updated_at BEFORE UPDATE ON public.agent_decisions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: cache_metadata update_cache_metadata_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_cache_metadata_updated_at BEFORE UPDATE ON public.cache_metadata FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: decision_overrides update_decision_overrides_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_decision_overrides_updated_at BEFORE UPDATE ON public.decision_overrides FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: executive_kpis update_executive_kpis_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_executive_kpis_updated_at BEFORE UPDATE ON public.executive_kpis FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: telemetry_snapshots update_telemetry_snapshots_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_telemetry_snapshots_updated_at BEFORE UPDATE ON public.telemetry_snapshots FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tenant_config update_tenant_config_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_tenant_config_updated_at BEFORE UPDATE ON public.tenant_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tenants update_tenants_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: user_config update_user_config_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_user_config_updated_at BEFORE UPDATE ON public.user_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: telemetry
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: agent_decisions agent_decisions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT agent_decisions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cognitive_enrichments cognitive_enrichments_fact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.cognitive_enrichments
    ADD CONSTRAINT cognitive_enrichments_fact_id_fkey FOREIGN KEY (fact_id) REFERENCES public.telemetry_facts(fact_id) ON DELETE CASCADE;


--
-- Name: config_audit_log config_audit_log_config_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.config_audit_log
    ADD CONSTRAINT config_audit_log_config_key_fkey FOREIGN KEY (config_key) REFERENCES public.user_config(config_key) ON DELETE CASCADE;


--
-- Name: decision_history decision_history_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.decision_history
    ADD CONSTRAINT decision_history_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.telemetry_snapshots(id) ON DELETE CASCADE;


--
-- Name: executive_kpis executive_kpis_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.executive_kpis
    ADD CONSTRAINT executive_kpis_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: pipeline_events fk_pipeline_event_execution; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_events
    ADD CONSTRAINT fk_pipeline_event_execution FOREIGN KEY (execution_id) REFERENCES public.pipeline_executions(execution_id) ON DELETE CASCADE;


--
-- Name: human_review_ledger human_review_ledger_enrichment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.human_review_ledger
    ADD CONSTRAINT human_review_ledger_enrichment_id_fkey FOREIGN KEY (enrichment_id) REFERENCES public.cognitive_enrichments(enrichment_id) ON DELETE CASCADE;


--
-- Name: human_review_ledger human_review_ledger_fact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.human_review_ledger
    ADD CONSTRAINT human_review_ledger_fact_id_fkey FOREIGN KEY (fact_id) REFERENCES public.telemetry_facts(fact_id) ON DELETE CASCADE;


--
-- Name: pipeline_executions pipeline_executions_agent_decision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.pipeline_executions
    ADD CONSTRAINT pipeline_executions_agent_decision_id_fkey FOREIGN KEY (agent_decision_id) REFERENCES public.agent_decisions(id);


--
-- Name: quality_hotspots quality_hotspots_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.quality_hotspots
    ADD CONSTRAINT quality_hotspots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: recommendation_audit_log recommendation_audit_log_action_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.recommendation_audit_log
    ADD CONSTRAINT recommendation_audit_log_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.recommendation_actions(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: search_audit search_audit_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.search_audit
    ADD CONSTRAINT search_audit_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_audit_log tenant_audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenant_audit_log
    ADD CONSTRAINT tenant_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_audit_log tenant_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenant_audit_log
    ADD CONSTRAINT tenant_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_config tenant_config_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.tenant_config
    ADD CONSTRAINT tenant_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: user_config user_config_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_config
    ADD CONSTRAINT user_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: telemetry
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict F8TqeJq8OeQtaIvTT0EDDiUj5wGidbSDSPY8xXRaaAwRJf5spd1wv0CjxtGyfZ2

