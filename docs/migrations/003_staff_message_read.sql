BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS helpdesk.staff_message_read (
    nhan_vien_ma bigint NOT NULL REFERENCES helpdesk.nhan_vien(nd_ma) ON DELETE CASCADE,
    tn_ma bigint NOT NULL REFERENCES helpdesk.tin_nhan(tn_ma) ON DELETE CASCADE,
    PRIMARY KEY (nhan_vien_ma, tn_ma)
);
COMMIT;
