BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS helpdesk.account_lock_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id bigint NOT NULL REFERENCES helpdesk.nguoi_dung(nd_ma),
    actor_id bigint NOT NULL REFERENCES helpdesk.nguoi_dung(nd_ma),
    changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    locked boolean NOT NULL,
    reason text,
    CHECK ((locked AND reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500)
        OR (NOT locked AND reason IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_account_lock_event_latest ON helpdesk.account_lock_event (account_id,id DESC);
COMMIT;
