BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE helpdesk.phieu_ho_tro ADD COLUMN IF NOT EXISTS ket_thuc_loai text
    CHECK (ket_thuc_loai IN ('TU_CHOI_YEU_CAU'));
CREATE TABLE IF NOT EXISTS helpdesk.email_outbox (
    phieu_ma bigint NOT NULL REFERENCES helpdesk.phieu_ho_tro(phieu_ma) ON DELETE CASCADE,
    event text NOT NULL CHECK (event IN ('created','approved','rejected','cancelled')),
    payload jsonb NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed','uncertain')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (phieu_ma, event)
);
CREATE INDEX IF NOT EXISTS ix_email_outbox_pending ON helpdesk.email_outbox(next_attempt) WHERE state='pending';
COMMIT;
