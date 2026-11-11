"""Period analytics. All timestamps are measured from persisted workflow data."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from services.manager_service import activity, execute, manager_cursor

VIETNAM = ZoneInfo('Asia/Ho_Chi_Minh')


def report_period(preset, start, end):
    today = datetime.now(VIETNAM).date()
    if preset == 'custom':
        if not start or not end or start > end or (end - start).days >= 366:
            raise HTTPException(422, 'Chọn khoảng ngày hợp lệ, tối đa 366 ngày.')
    else:
        end = today
        start = today.replace(day=1) if preset == 'month' else today - timedelta(days={
            'today': 0, '7d': 6, '30d': 29,
        }[preset])
    return start, end


# The reporting dimensions use the recorded group, falling back to current routing for unassigned tickets.
# First resolution is measured once per ticket, even if a later workflow adds reopening.
ANALYTICS_SQL = """
WITH bounds AS (
    SELECT %s::timestamptz start_at, %s::timestamptz end_at, statement_timestamp() snapshot_at
), scoped AS (
    SELECT p.phieu_ma, p.ngay_tao created, p.ngay_giai_quyet stored_resolution, p.ngay_dong closed,
           p.han_phan_hoi response_due, p.han_xu_ly resolution_due, p.sla_ma,
           p.ngay_phan_hoi_dau stored_response, t.ma status, t.la_ket_thuc terminal,
           d.ngay_tao rated, d.so_sao stars,
           COALESCE(g.nhom_ma::text, '') group_id, COALESCE(g.ten, 'Chưa xác định nhóm') group_name
    FROM {phieu_ho_tro} p
    JOIN {trang_thai} t USING(tt_ma)
    LEFT JOIN {xu_ly_mac_dinh} x USING(ht_ma)
    LEFT JOIN {nhom_ho_tro} g ON g.nhom_ma=COALESCE(p.nhom_ma,x.nhom_ma)
    LEFT JOIN {danh_gia} d USING(phieu_ma)
    WHERE (%s::bigint IS NULL OR g.nhom_ma=%s) AND (%s::bigint IS NULL OR p.ht_ma=%s)
), resolutions AS (
    SELECT h.phieu_ma, min(h.thoi_diem) first_resolved
    FROM scoped s JOIN {lich_su_trang_thai} h USING(phieu_ma)
    JOIN {trang_thai} t ON t.tt_ma=h.tt_moi_ma
    WHERE t.ma='DA_GIAI_QUYET' AND h.thoi_diem >= s.created GROUP BY h.phieu_ma
), timestamps AS (
    SELECT s.*, b.*, CASE WHEN stored_response >= created THEN stored_response END responded,
           COALESCE(r.first_resolved, CASE WHEN stored_resolution >= created THEN stored_resolution END) resolved
    FROM scoped s LEFT JOIN resolutions r USING(phieu_ma) CROSS JOIN bounds b
), flags AS (
    SELECT *,
           created >= start_at AND created < end_at is_new,
           responded >= start_at AND responded < end_at response_in_period,
           resolved >= start_at AND resolved < end_at resolution_in_period,
           rated >= start_at AND rated < end_at rating_in_period,
           status='DA_DONG' AND closed >= start_at AND closed < end_at close_in_period,
           sla_ma IS NOT NULL AND COALESCE(response_due > created, false) has_response_sla,
           sla_ma IS NOT NULL AND COALESCE(resolution_due > created, false) has_resolution_sla
    FROM timestamps
), aggregates AS (
    SELECT group_id, group_name, grouping(group_id) is_total,
           count(*) FILTER (WHERE is_new) created,
           count(*) FILTER (WHERE resolution_in_period) resolved,
           count(*) FILTER (WHERE response_in_period) response_samples,
           avg(extract(epoch FROM (responded-created))/60) FILTER (WHERE response_in_period) response_avg,
           avg(extract(epoch FROM (resolved-created))/60) FILTER (WHERE resolution_in_period) resolution_avg,
           count(*) FILTER (WHERE response_in_period AND has_response_sla AND responded<=response_due) response_on_time,
           count(*) FILTER (WHERE response_in_period AND has_response_sla AND responded>response_due) response_late,
           count(*) FILTER (WHERE resolution_in_period AND has_resolution_sla AND resolved<=resolution_due) resolution_on_time,
           count(*) FILTER (WHERE resolution_in_period AND has_resolution_sla AND resolved>resolution_due) resolution_late,
           count(*) FILTER (WHERE resolution_in_period AND has_resolution_sla AND resolved-created <= (resolution_due-created)*0.25) resolution_quarter,
           count(*) FILTER (WHERE resolution_in_period AND has_resolution_sla
             AND resolved-created > (resolution_due-created)*0.25 AND resolved-created <= (resolution_due-created)*0.50) resolution_half,
           count(*) FILTER (WHERE resolution_in_period AND has_resolution_sla
             AND resolved-created > (resolution_due-created)*0.50 AND resolved<=resolution_due) resolution_full,
           count(*) FILTER (WHERE response_in_period AND NOT has_response_sla) response_missing,
           count(*) FILTER (WHERE resolution_in_period AND NOT has_resolution_sla) resolution_missing,
           count(*) FILTER (WHERE is_new AND NOT terminal AND status<>'DA_GIAI_QUYET' AND responded IS NULL AND has_response_sla AND response_due<snapshot_at) response_open_late,
           count(*) FILTER (WHERE is_new AND NOT terminal AND status<>'DA_GIAI_QUYET' AND responded IS NULL AND has_response_sla AND response_due>=snapshot_at) response_open_on_time,
           count(*) FILTER (WHERE is_new AND NOT terminal AND status<>'DA_GIAI_QUYET' AND has_resolution_sla AND resolution_due<snapshot_at) resolution_open_late,
           count(*) FILTER (WHERE is_new AND NOT terminal AND status<>'DA_GIAI_QUYET' AND has_resolution_sla AND resolution_due>=snapshot_at) resolution_open_on_time,
           count(*) FILTER (WHERE is_new AND (NOT has_response_sla OR NOT has_resolution_sla)) intake_missing_sla,
           count(*) FILTER (WHERE is_new AND status IN ('DA_GIAI_QUYET','DA_DONG') AND resolved IS NULL) missing_resolution_time,
           count(*) FILTER (WHERE close_in_period) closed_in_period,
           count(*) FILTER (WHERE close_in_period AND rated IS NOT NULL) closed_with_rating,
           count(*) FILTER (WHERE rating_in_period) ratings,
           avg(stars) FILTER (WHERE rating_in_period) rating_avg,
           count(*) FILTER (WHERE rating_in_period AND stars>=4) positive
    FROM flags
    WHERE is_new OR response_in_period OR resolution_in_period OR rating_in_period OR close_in_period
    GROUP BY GROUPING SETS ((), (group_id, group_name))
), rating_buckets AS (
    SELECT stars, count(*) count FROM flags WHERE rating_in_period GROUP BY stars
), event_dates AS (
    SELECT created at, true is_creation FROM flags WHERE is_new
    UNION ALL SELECT resolved, false FROM flags WHERE resolution_in_period
), trends AS (
    SELECT grain, date_trunc(grain, at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date date,
           count(*) FILTER(WHERE is_creation) created, count(*) FILTER(WHERE NOT is_creation) resolved
    FROM event_dates CROSS JOIN (VALUES ('day'), ('week'), ('month')) grains(grain)
    GROUP BY grain, date_trunc(grain, at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
)
SELECT (SELECT row_to_json(a) FROM aggregates a WHERE is_total=1) metrics,
       COALESCE((SELECT json_agg(a ORDER BY a.resolved DESC, a.created DESC, a.group_name, a.group_id)
                 FROM aggregates a WHERE is_total=0), '[]'::json) groups,
       COALESCE((SELECT json_agg(r ORDER BY stars) FROM rating_buckets r), '[]'::json) rating_distribution,
       COALESCE((SELECT json_agg(t ORDER BY date) FROM trends t), '[]'::json) trend,
       (SELECT snapshot_at FROM bounds) snapshot_at
"""


def analytics(actor, start, end, group_id, type_id):
    lower = datetime.combine(start, time.min, VIETNAM)
    upper = datetime.combine(end + timedelta(days=1), time.min, VIETNAM)
    with manager_cursor(actor) as (cur, _):
        execute(cur, ANALYTICS_SQL, (lower, upper, group_id, group_id, type_id, type_id))
        return {**cur.fetchone(), 'start': start, 'end': end, 'group_id': str(group_id) if group_id else None,
                'type_id': str(type_id) if type_id else None}


def report_activity(actor, start, end, group_id, type_id, page):
    return activity(actor, page, 10, start, end, group_id=group_id, type_id=type_id)
