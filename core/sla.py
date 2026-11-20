"""Continuous elapsed-time SLA. No work calendar or background notifications."""
from psycopg import sql
from fastapi import HTTPException
from core.database import database_schema


def lock_sla_priority(cur, priority_id):
    # Separate namespace from the existing operations lock. Acquire before policy rows.
    cur.execute('SELECT pg_advisory_xact_lock(%s,%s)', (74104,int(priority_id)))


def attach_sla(cur,ticket_id, required=False, provisional=False):
    tables={t:sql.Identifier(database_schema(),t) for t in ['phieu_ho_tro','chinh_sach_sla']}
    cur.execute(sql.SQL('SELECT mdut_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s').format(**tables),(ticket_id,))
    priority=cur.fetchone()
    lock_sla_priority(cur, priority['mdut_ma'] if isinstance(priority,dict) else priority[0])
    if provisional:
        cur.execute(sql.SQL("UPDATE {phieu_ho_tro} SET yeu_cau_goc=COALESCE(yeu_cau_goc,'{{}}'::jsonb)||jsonb_build_object('_sla_phase','provisional') WHERE phieu_ma=%s").format(**tables),(ticket_id,))
    cur.execute(sql.SQL('''SELECT s.sla_ma,s.thoi_gian_phan_hoi_phut,s.thoi_gian_xu_ly_phut
        FROM {chinh_sach_sla} s JOIN {phieu_ho_tro} p ON p.mdut_ma=s.mdut_ma
        WHERE p.phieu_ma=%s AND s.dang_hoat_dong FOR SHARE OF s''').format(**tables),(ticket_id,))
    # Works with both tuple and dict cursors used by existing services/tests.
    result=cur.fetchone()
    if result is None:
        if required:raise HTTPException(422,'Chưa có SLA đang áp dụng cho mức ưu tiên đã chọn. Hãy liên hệ Quản lý; nội dung yêu cầu chưa bị thay đổi.')
        return False
    if isinstance(result,dict):values=[result[k] for k in ['sla_ma','thoi_gian_phan_hoi_phut','thoi_gian_xu_ly_phut']]
    else:values=list(result)
    cur.execute(sql.SQL('''SELECT ngay_tao <= TIMESTAMPTZ '9999-12-31 00:00:00+00'
        - make_interval(mins=>%s) AS safe FROM {phieu_ho_tro} WHERE phieu_ma=%s''').format(**tables),
        (values[2],ticket_id))
    safe=cur.fetchone()
    if not (safe['safe'] if isinstance(safe,dict) else safe[0]):
        raise HTTPException(422,'Thời lượng SLA vượt phạm vi timestamp hợp lệ của phiếu. Vui lòng giảm thời lượng.')
    cur.execute(sql.SQL('''UPDATE {phieu_ho_tro} SET
        yeu_cau_goc=COALESCE(yeu_cau_goc,'{{}}'::jsonb)||jsonb_build_object('_sla_used_ids',
            COALESCE(yeu_cau_goc->'_sla_used_ids','[]'::jsonb)||jsonb_build_array(sla_ma::text,%s::text)),
        sla_ma=%s,
        han_phan_hoi=ngay_tao+make_interval(mins=>%s),han_xu_ly=ngay_tao+make_interval(mins=>%s)
        WHERE phieu_ma=%s''').format(**tables),[values[0],*values,ticket_id])
    return True
