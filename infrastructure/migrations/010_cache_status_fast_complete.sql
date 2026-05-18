-- Add fast_complete status to cache_metadata
ALTER TABLE cache_metadata DROP CONSTRAINT IF EXISTS cache_metadata_status_check;
ALTER TABLE cache_metadata ADD CONSTRAINT cache_metadata_status_check
  CHECK (status IN ('fresh','stale','refreshing','error','fast_complete'));
