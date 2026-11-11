-- Apply once to the current Helpdesk database before enabling request approval.
-- Existing rows retain NULL. Their earlier text cannot be reconstructed.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE helpdesk.phieu_ho_tro
    ADD COLUMN IF NOT EXISTS yeu_cau_goc JSONB;
COMMIT;
