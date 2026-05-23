-- Migration 130: Allow explicit updated_at values in UPDATE statements
-- The trigger update_updated_at_column() previously always set updated_at = NOW()
-- regardless of whether the UPDATE explicitly set it to a different value.
-- This change allows explicit updated_at values to be preserved when set,
-- while still auto-setting it to NOW() when not explicitly specified.

CREATE OR REPLACE FUNCTION update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$function$;
