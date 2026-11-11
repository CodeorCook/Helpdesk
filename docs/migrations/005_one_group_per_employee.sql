BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(741032026);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM helpdesk.thanh_vien_nhom GROUP BY nhan_vien_ma HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Resolve duplicate memberships in Manager before applying migration 005.';
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_thanh_vien_nhom_nhan_vien ON helpdesk.thanh_vien_nhom(nhan_vien_ma);
COMMIT;
