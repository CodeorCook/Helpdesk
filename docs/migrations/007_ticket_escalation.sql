-- Apply manually after review. Does not update existing tickets or assignments.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(741032026);
CREATE TABLE IF NOT EXISTS helpdesk.yeu_cau_dieu_phoi_phieu (
    yc_ma bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phieu_ma bigint NOT NULL REFERENCES helpdesk.phieu_ho_tro(phieu_ma) ON DELETE RESTRICT,
    nhan_vien_gui_ma bigint NOT NULL REFERENCES helpdesk.nhan_vien(nd_ma) ON DELETE RESTRICT,
    nhom_gui_ma bigint NOT NULL REFERENCES helpdesk.nhom_ho_tro(nhom_ma) ON DELETE RESTRICT,
    phan_cong_gui_ma bigint NOT NULL REFERENCES helpdesk.lich_su_phan_cong(pc_ma) ON DELETE RESTRICT,
    ly_do text NOT NULL CHECK (length(btrim(ly_do)) BETWEEN 1 AND 2000),
    ngay_gui timestamptz NOT NULL DEFAULT clock_timestamp(),
    trang_thai varchar(20) NOT NULL DEFAULT 'CHO_XU_LY'
        CHECK (trang_thai IN ('CHO_XU_LY','DA_DIEU_PHOI','TU_CHOI')),
    quan_ly_xu_ly_ma bigint REFERENCES helpdesk.quan_tri_vien(nd_ma) ON DELETE RESTRICT,
    ngay_xu_ly timestamptz,
    ghi_chu_xu_ly text,
    phan_cong_ket_qua_ma bigint REFERENCES helpdesk.lich_su_phan_cong(pc_ma) ON DELETE RESTRICT,
    CHECK ((trang_thai='CHO_XU_LY' AND quan_ly_xu_ly_ma IS NULL AND ngay_xu_ly IS NULL
            AND ghi_chu_xu_ly IS NULL AND phan_cong_ket_qua_ma IS NULL)
        OR (trang_thai<>'CHO_XU_LY' AND quan_ly_xu_ly_ma IS NOT NULL AND ngay_xu_ly IS NOT NULL
            AND ghi_chu_xu_ly IS NOT NULL AND length(btrim(ghi_chu_xu_ly)) BETWEEN 1 AND 2000
            AND ((trang_thai='DA_DIEU_PHOI' AND phan_cong_ket_qua_ma IS NOT NULL)
              OR (trang_thai='TU_CHOI' AND phan_cong_ket_qua_ma IS NULL))))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dieu_phoi_phieu_dang_cho
    ON helpdesk.yeu_cau_dieu_phoi_phieu(phieu_ma) WHERE trang_thai='CHO_XU_LY';
CREATE INDEX IF NOT EXISTS ix_dieu_phoi_nguoi_gui
    ON helpdesk.yeu_cau_dieu_phoi_phieu(nhan_vien_gui_ma,ngay_gui DESC);
COMMIT;
