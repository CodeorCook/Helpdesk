BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(741032026);
CREATE TABLE IF NOT EXISTS helpdesk.nhom_loai_ho_tro (
    nhom_ma bigint NOT NULL REFERENCES helpdesk.nhom_ho_tro(nhom_ma) ON DELETE RESTRICT,
    ht_ma bigint NOT NULL REFERENCES helpdesk.loai_ho_tro(ht_ma) ON DELETE RESTRICT,
    PRIMARY KEY (nhom_ma,ht_ma)
);
CREATE INDEX IF NOT EXISTS ix_nhom_loai_ho_tro_type ON helpdesk.nhom_loai_ho_tro(ht_ma);
INSERT INTO helpdesk.nhom_loai_ho_tro(nhom_ma,ht_ma)
    SELECT nhom_ma,ht_ma FROM helpdesk.xu_ly_mac_dinh ON CONFLICT DO NOTHING;
COMMIT;
