"""Continuous elapsed-time SLA. No work calendar or background notifications."""
from psycopg import sql
from core.database import database_schema


def attach_sla(cur,ticket_id):
    tables={t:sql.Identifier(database_schema(),t) for t in ['phieu_ho_tro','chinh_sach_sla']}
    cur.execute(sql.SQL('''SELECT s.sla_ma,s.thoi_gian_phan_hoi_phut,s.thoi_gian_xu_ly_phut
        FROM {chinh_sach_sla} s JOIN {phieu_ho_tro} p ON p.mdut_ma=s.mdut_ma
        WHERE p.phieu_ma=%s AND s.dang_hoat_dong FOR SHARE OF s''').format(**tables),(ticket_id,))
    # Works with both tuple and dict cursors used by existing services/tests.
    result=cur.fetchone()
    if result is None:return False
    if isinstance(result,dict):values=[result[k] for k in ['sla_ma','thoi_gian_phan_hoi_phut','thoi_gian_xu_ly_phut']]
    else:values=list(result)
    cur.execute(sql.SQL('''UPDATE {phieu_ho_tro} SET sla_ma=%s,
        han_phan_hoi=ngay_tao+make_interval(mins=>%s),han_xu_ly=ngay_tao+make_interval(mins=>%s)
        WHERE phieu_ma=%s''').format(**tables),[*values,ticket_id])
    return True
