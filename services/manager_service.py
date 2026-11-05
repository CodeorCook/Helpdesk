"""Manager role boundary; no public privileged registration or destructive account API."""
from contextlib import contextmanager
from datetime import datetime,time,timedelta,timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.errors import UniqueViolation
from core.database import get_connection, database_schema
from core.security import PASSWORD_HASHER, verify_password
from core.coordination import lock_operations
from core.audit import record
from core.uploads import safe_path
from core.sla import attach_sla
from core.manager_limits import role_confirmation
from services import staff_service as staff
from services.auth_service import ROLES

TABLES=(*staff.TABLES,'quan_tri_vien')


def execute(cur,statement,params=()):
    cur.execute(sql.SQL(statement).format(**{t:sql.Identifier(database_schema(),t) for t in TABLES}),params)


@contextmanager
def manager_cursor(user_id,mutation=False):
    events=[]
    try:
        with get_connection() as conn,conn.transaction(),conn.cursor(row_factory=dict_row) as cur:
            if mutation:lock_operations(cur)
            execute(cur,"SELECT n.nd_ma FROM {quan_tri_vien} m JOIN {nguoi_dung} n USING(nd_ma) WHERE n.nd_ma=%s AND n.vai_tro='QUAN_TRI_VIEN' AND n.trang_thai='HOAT_DONG'",(user_id,))
            if cur.fetchone() is None:raise HTTPException(403,'Cần hồ sơ Quản lý đang hoạt động.')
            yield cur,events
    except UniqueViolation as exc:
        if exc.diag.constraint_name == 'uq_sla_muc_uu_tien_dang_dung':
            raise HTTPException(409, 'Mức ưu tiên này đã có chính sách SLA có hiệu lực. Hãy tắt chính sách hiện tại trước khi bật chính sách khác.') from exc
        raise HTTPException(409,'Dữ liệu trùng hoặc cấu hình đang có hiệu lực đã tồn tại. Hãy làm mới để kiểm tra.') from exc
    for action,target in events:record(user_id,action,target)


ACCOUNT="SELECT nd_ma::text id,ho_ten name,email,so_dien_thoai phone,vai_tro role,trang_thai status,ngay_tao created_at,ngay_cap_nhat updated_at FROM {nguoi_dung} "


def account_row(cur,user_id,lock=False):
    execute(cur,ACCOUNT+' WHERE nd_ma=%s'+(' FOR UPDATE' if lock else ''),(user_id,));row=cur.fetchone()
    if row is None:raise HTTPException(404,'Không tìm thấy tài khoản.')
    row['role_label']=ROLES[row['role']][1]
    return row


def users(actor,search='',role=None,status=None,page=1,page_size=10):
    conditions=['true'];params=[]
    if search:
        escaped=search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        conditions.append('(ho_ten ILIKE %s OR email ILIKE %s OR nd_ma::text=%s)');params += ['%'+escaped+'%','%'+escaped+'%',search]
    for value,column in [(role,'vai_tro'),(status,'trang_thai')]:
        if value:conditions.append(column+'=%s');params.append(value)
    where=' WHERE '+' AND '.join(conditions)
    with manager_cursor(actor) as (cur,_):
        execute(cur,'SELECT count(*) total FROM {nguoi_dung}'+where,params);total=cur.fetchone()['total']
        execute(cur,ACCOUNT+where+' ORDER BY nd_ma DESC LIMIT %s OFFSET %s',params+[page_size,(page-1)*page_size]);rows=cur.fetchall()
        for row in rows:row['role_label']=ROLES[row['role']][1]
        return dict(items=rows,total=total,page=page,page_size=page_size)


def account(actor,user_id):
    with manager_cursor(actor) as (cur,_):return account_row(cur,user_id)


def create_employee(actor,body):
    encoded=PASSWORD_HASHER.hash(body.password)
    with manager_cursor(actor,True) as (cur,events):
        execute(cur,"INSERT INTO {nguoi_dung}(ho_ten,email,so_dien_thoai,mat_khau_hash,vai_tro) VALUES(%s,%s,%s,%s,'NHAN_VIEN') RETURNING nd_ma",(body.name,body.email,body.phone,encoded));uid=cur.fetchone()['nd_ma']
        create_employee_profile(cur,uid)
        events.append(('employee.create',uid))
        return account_row(cur,uid)


def create_employee_profile(cur,user_id):
    execute(cur,'INSERT INTO {nhan_vien}(nd_ma) VALUES(%s)',(user_id,))


def check_version(row,expected):
    if row['updated_at']!=expected:raise HTTPException(409,'Dữ liệu đã thay đổi. Hãy làm mới trước khi lưu.')


def pending_assignments(cur,employee_id=None,group_id=None):
    condition='p.nhan_vien_phu_trach_ma=%s' if employee_id is not None else 'p.nhom_ma=%s'
    execute(cur,'SELECT count(*) n FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) WHERE NOT t.la_ket_thuc AND p.nhan_vien_phu_trach_ma IS NOT NULL AND '+condition,(employee_id if employee_id is not None else group_id,))
    return cur.fetchone()['n']


def update_account(actor,user_id,body):
    with manager_cursor(actor,True) as (cur,events):
        row=account_row(cur,user_id,True);check_version(row,body.expected_updated_at)
        if body.status=='KHOA':
            if str(actor)==str(user_id):raise HTTPException(409,'Không thể tự khóa tài khoản đang đăng nhập.')
            if pending_assignments(cur,employee_id=user_id):raise HTTPException(409,'Nhân viên còn phiếu chưa kết thúc được giao. Hãy điều phối trước khi khóa.')
            if row['role']=='QUAN_TRI_VIEN':
                execute(cur,"SELECT count(*) n FROM {nguoi_dung} n JOIN {quan_tri_vien} q USING(nd_ma) WHERE vai_tro='QUAN_TRI_VIEN' AND trang_thai='HOAT_DONG' AND nd_ma<>%s",(user_id,))
                if cur.fetchone()['n']==0:raise HTTPException(409,'Phải giữ ít nhất một Quản lý hoạt động có hồ sơ hợp lệ.')
        execute(cur,"UPDATE {nguoi_dung} SET ho_ten=%s,so_dien_thoai=%s,trang_thai=%s,ngay_cap_nhat=GREATEST(clock_timestamp(), ngay_cap_nhat + interval '1 microsecond') WHERE nd_ma=%s",(body.name,body.phone,body.status,user_id))
        action = 'account.update'
        if row['status'] != body.status:
            action = 'account.lock' if body.status == 'KHOA' else 'account.unlock'
        events.append((action, user_id))
        return account_row(cur,user_id)


def change_role(actor,user_id,body):
    role_confirmation(actor)
    with manager_cursor(actor,True) as (cur,events):
        execute(cur,'SELECT mat_khau_hash FROM {nguoi_dung} WHERE nd_ma=%s',(actor,))
        if not verify_password(body.current_password,cur.fetchone()['mat_khau_hash']):raise HTTPException(403,'Mật khẩu xác nhận không chính xác.')
        row=account_row(cur,user_id,True);check_version(row,body.expected_updated_at)
        if str(actor)==str(user_id):raise HTTPException(409,'Không thể tự thay đổi vai trò đang đăng nhập.')
        if row['role']==body.role:raise HTTPException(409,'Tài khoản đã có vai trò này.')
        # Restrict changes to unused accounts. Preserve all historical role profiles/FKs.
        execute(cur,'''SELECT EXISTS(SELECT 1 FROM {phieu_ho_tro} WHERE khach_hang_ma=%s OR nguoi_lap_ma=%s OR nhan_vien_phu_trach_ma=%s)
          OR EXISTS(SELECT 1 FROM {thanh_vien_nhom} WHERE nhan_vien_ma=%s)
          OR EXISTS(SELECT 1 FROM {lich_su_phan_cong} WHERE nhan_vien_ma=%s OR nguoi_phan_cong_ma=%s)
          OR EXISTS(SELECT 1 FROM {tin_nhan} WHERE nguoi_gui_ma=%s)
          OR EXISTS(SELECT 1 FROM {lich_su_trang_thai} WHERE nguoi_thay_doi_ma=%s)
          OR EXISTS(SELECT 1 FROM {tep_dinh_kem} WHERE nguoi_tai_len_ma=%s) AS used''',(user_id,)*9)
        if cur.fetchone()['used']:raise HTTPException(409,'Tài khoản đã có nghiệp vụ/nhóm/lịch sử. Giữ vai trò để bảo toàn quyền và lịch sử; dùng khóa tài khoản khi phù hợp.')
        if row['role']=='QUAN_TRI_VIEN' and row['status']=='HOAT_DONG':
            execute(cur,"SELECT count(*) n FROM {nguoi_dung} n JOIN {quan_tri_vien} q USING(nd_ma) WHERE vai_tro='QUAN_TRI_VIEN' AND trang_thai='HOAT_DONG' AND nd_ma<>%s",(user_id,))
            if cur.fetchone()['n']==0:raise HTTPException(409,'Không thể làm mất Quản lý hoạt động cuối cùng.')
        profile={'KHACH_HANG':'khach_hang','NHAN_VIEN':'nhan_vien','QUAN_TRI_VIEN':'quan_tri_vien'}[body.role]
        execute(cur,'INSERT INTO {'+profile+'}(nd_ma) VALUES(%s) ON CONFLICT(nd_ma) DO NOTHING',(user_id,))
        execute(cur,'UPDATE {nguoi_dung} SET vai_tro=%s,ngay_cap_nhat=clock_timestamp() WHERE nd_ma=%s',(body.role,user_id))
        events.append(('account.role.'+body.role,user_id));return account_row(cur,user_id)


def ticket_counts(cur, where, params):
    execute(cur, '''
        SELECT count(*) total,
               count(*) FILTER (WHERE t.ma='MOI') waiting,
               count(*) FILTER (WHERE t.ma='DANG_XU_LY') processing,
               count(*) FILTER (WHERE t.ma='TAM_DUNG') paused,
               count(*) FILTER (WHERE t.ma='DA_GIAI_QUYET') resolved,
               count(*) FILTER (WHERE t.ma='DA_DONG') closed,
               count(*) FILTER (WHERE p.sla_ma IS NOT NULL AND NOT t.la_ket_thuc
                 AND t.ma<>'DA_GIAI_QUYET' AND (p.han_xu_ly<now()
                   OR (p.ngay_phan_hoi_dau IS NULL AND p.han_phan_hoi<now()))) overdue
    ''' + staff.FROM + where, params)
    return cur.fetchone()


def ticket_trend(cur, unit, step):
    # The buckets include the current period and seven previous periods in Vietnam.
    execute(cur, '''
        WITH calendar AS (
            SELECT generate_series(current_bucket - 7 * step, current_bucket, step) AS start_at, step
            FROM (SELECT date_trunc(%s, now() AT TIME ZONE 'Asia/Ho_Chi_Minh') current_bucket,
                         %s::interval AS step) period
        )
        SELECT to_char(c.start_at, %s) name, count(p.phieu_ma) count
        FROM calendar c LEFT JOIN {phieu_ho_tro} p
          ON p.ngay_tao >= (c.start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AND p.ngay_tao < ((c.start_at + c.step) AT TIME ZONE 'Asia/Ho_Chi_Minh')
        GROUP BY c.start_at ORDER BY c.start_at
    ''', (unit, step, 'DD/MM/YYYY' if unit == 'week' else 'MM/YYYY'))
    return cur.fetchall()


def overview(actor, *, include_trends=False, **options):
    where,params=filters(**options)
    with manager_cursor(actor) as (cur,_):
        result = ticket_counts(cur, where, params)
        if include_trends:
            result['by_week'] = ticket_trend(cur, 'week', '1 week')
            result['by_month'] = ticket_trend(cur, 'month', '1 month')
        for key,expression in [('by_status','t.ten'),('by_group',"COALESCE(g.ten,'Chưa xác định nhóm')"),('by_type',"COALESCE(l.ten,'Chưa phân loại')"),('by_priority','u.ten')]:
            execute(cur,'SELECT '+expression+' name,count(*) count'+staff.FROM+where+' GROUP BY '+expression+' ORDER BY count DESC,name',params)
            result[key]=cur.fetchall()
        for key,table in [('users','nguoi_dung'),('groups','nhom_ho_tro')]:
            execute(cur,'SELECT count(*) n FROM {'+table+'}');result[key]=cur.fetchone()['n']
        return result


GROUP_VIEW='''SELECT g.nhom_ma::text id,g.ten name,g.mo_ta description,g.dang_hoat_dong active,
 (SELECT count(*) FROM {thanh_vien_nhom} m WHERE m.nhom_ma=g.nhom_ma) members,
 (SELECT count(*) FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) WHERE p.nhom_ma=g.nhom_ma AND NOT t.la_ket_thuc AND p.nhan_vien_phu_trach_ma IS NOT NULL) pending
 FROM {nhom_ho_tro} g'''


def group_row(cur,group_id,lock=False):
    execute(cur,GROUP_VIEW+' WHERE g.nhom_ma=%s'+(' FOR UPDATE OF g' if lock else ''),(group_id,));row=cur.fetchone()
    if row is None:raise HTTPException(404,'Không tìm thấy nhóm hỗ trợ.')
    return row


def groups(actor,page=1,page_size=20):
    with manager_cursor(actor) as (cur,_):
        execute(cur,'SELECT count(*) total FROM {nhom_ho_tro}');total=cur.fetchone()['total']
        execute(cur,GROUP_VIEW+' ORDER BY g.nhom_ma LIMIT %s OFFSET %s',(page_size,(page-1)*page_size))
        return dict(items=cur.fetchall(),total=total,page=page,page_size=page_size)


def group_detail(actor,group_id):
    with manager_cursor(actor) as (cur,_):
        group=group_row(cur,group_id)
        group['stats'] = ticket_counts(cur, ' WHERE p.nhom_ma=%s', (group_id,))
        execute(cur,'''SELECT n.nd_ma::text id,n.ho_ten name,n.trang_thai status,
          (SELECT count(*) FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) WHERE p.nhan_vien_phu_trach_ma=n.nd_ma AND NOT t.la_ket_thuc AND t.ma<>'DA_GIAI_QUYET') workload
          FROM {thanh_vien_nhom} m JOIN {nguoi_dung} n ON n.nd_ma=m.nhan_vien_ma WHERE m.nhom_ma=%s ORDER BY n.nd_ma''',(group_id,));group['people']=cur.fetchall()
        execute(cur,'SELECT l.ht_ma::text id,l.ten name FROM {xu_ly_mac_dinh} x JOIN {loai_ho_tro} l USING(ht_ma) WHERE x.nhom_ma=%s ORDER BY l.ht_ma',(group_id,));group['types']=cur.fetchall()
        return group


def create_group(actor,body):
    with manager_cursor(actor,True) as (cur,events):
        execute(cur,'INSERT INTO {nhom_ho_tro}(ten,mo_ta,dang_hoat_dong) VALUES(%s,%s,%s) RETURNING nhom_ma',(body.name,body.description,body.active));gid=cur.fetchone()['nhom_ma']
        events.append(('group.create',gid));return group_row(cur,gid)


def update_group(actor,group_id,body):
    with manager_cursor(actor,True) as (cur,events):
        current=group_row(cur,group_id,True)
        if any(current[k]!=v for k,v in body.expected.model_dump().items()):raise HTTPException(409,'Nhóm đã thay đổi. Hãy làm mới.')
        if not body.active and current['pending']:
            raise HTTPException(409,'Nhóm còn phiếu được giao chưa kết thúc. Hãy điều phối trước khi vô hiệu hóa.')
        execute(cur,'UPDATE {nhom_ho_tro} SET ten=%s,mo_ta=%s,dang_hoat_dong=%s WHERE nhom_ma=%s',(body.name,body.description,body.active,group_id))
        events.append(('group.update',group_id));return group_row(cur,group_id)


def member_change(actor,group_id,employee_id,remove=False):
    with manager_cursor(actor,True) as (cur,events):
        group=group_row(cur,group_id,True)
        if remove:
            execute(cur,'SELECT 1 FROM {thanh_vien_nhom} WHERE nhom_ma=%s AND nhan_vien_ma=%s',(group_id,employee_id))
            if cur.fetchone() is None:raise HTTPException(404,'Nhân viên không thuộc nhóm này.')
            execute(cur,'SELECT count(*) n FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) WHERE p.nhom_ma=%s AND p.nhan_vien_phu_trach_ma=%s AND NOT t.la_ket_thuc',(group_id,employee_id))
            if cur.fetchone()['n']:raise HTTPException(409,'Thành viên còn phiếu chưa kết thúc trong nhóm. Hãy điều phối trước khi bỏ thành viên.')
            execute(cur,'DELETE FROM {thanh_vien_nhom} WHERE nhom_ma=%s AND nhan_vien_ma=%s',(group_id,employee_id))
        else:
            if not group['active']:raise HTTPException(409,'Không thêm thành viên vào nhóm đã vô hiệu hóa.')
            execute(cur,"SELECT v.nd_ma FROM {nhan_vien} v JOIN {nguoi_dung} n USING(nd_ma) WHERE n.nd_ma=%s AND n.vai_tro='NHAN_VIEN' AND n.trang_thai='HOAT_DONG' FOR SHARE OF n",(employee_id,))
            if cur.fetchone() is None:raise HTTPException(422,'Cần nhân viên có hồ sơ và tài khoản hoạt động.')
            execute(cur,'INSERT INTO {thanh_vien_nhom}(nhom_ma,nhan_vien_ma) VALUES(%s,%s) ON CONFLICT DO NOTHING',(group_id,employee_id))
        events.append(('group.member.remove' if remove else 'group.member.add',str(group_id)+':'+str(employee_id)))
        return {'message':'Đã bỏ thành viên.' if remove else 'Đã thêm thành viên.'}


MAX_GROUP_TYPES = 2


def routing(actor):
    with manager_cursor(actor) as (cur,_):
        execute(cur,'''SELECT l.ht_ma::text type_id,l.ten type_name,l.dang_hoat_dong type_active,x.nhom_ma::text group_id,g.ten group_name,g.dang_hoat_dong group_active,
          (SELECT count(*) FROM {phieu_ho_tro} p JOIN {trang_thai} t USING(tt_ma) WHERE p.ht_ma=l.ht_ma AND p.nhom_ma IS NULL AND p.nhan_vien_phu_trach_ma IS NULL AND t.ma='MOI') waiting
          FROM {loai_ho_tro} l LEFT JOIN {xu_ly_mac_dinh} x USING(ht_ma) LEFT JOIN {nhom_ho_tro} g USING(nhom_ma) WHERE l.dang_hoat_dong OR x.ht_ma IS NOT NULL ORDER BY l.ht_ma''')
        return cur.fetchall()


def check_routing_version(cur, type_id, expected_group_id):
    execute(cur, 'SELECT nhom_ma FROM {xu_ly_mac_dinh} WHERE ht_ma=%s FOR UPDATE', (type_id,))
    previous = cur.fetchone()
    if (previous['nhom_ma'] if previous else None) != expected_group_id:
        raise HTTPException(409, 'Ánh xạ đã thay đổi. Hãy làm mới trước khi lưu.')


def update_routing(actor, type_id, body):
    # This transaction shares the coordination lock with all mapping and assignment writes.
    with manager_cursor(actor, True) as (cur, events):
        execute(cur, 'SELECT dang_hoat_dong FROM {loai_ho_tro} WHERE ht_ma=%s FOR UPDATE', (type_id,))
        ticket_type = cur.fetchone()
        if ticket_type is None:
            raise HTTPException(404, 'Không tìm thấy loại hỗ trợ.')
        check_routing_version(cur, type_id, body.expected_group_id)
        if body.group_id == body.expected_group_id:
            return {'message': 'Ánh xạ đã thuộc nhóm này.'}
        if not ticket_type['dang_hoat_dong'] and body.expected_group_id is None:
            raise HTTPException(422, 'Chỉ có thể thêm loại hỗ trợ đang hoạt động.')
        group = group_row(cur, body.group_id, True)
        if not group['active']:
            raise HTTPException(422, 'Nhóm đích phải đang hoạt động.')
        execute(cur, 'SELECT count(*) AS total FROM {xu_ly_mac_dinh} WHERE nhom_ma=%s', (body.group_id,))
        if cur.fetchone()['total'] >= MAX_GROUP_TYPES:
            raise HTTPException(409, 'Nhóm đích đã đủ 2 loại yêu cầu.')
        execute(cur, '''INSERT INTO {xu_ly_mac_dinh}(ht_ma,nhom_ma) VALUES(%s,%s)
                        ON CONFLICT(ht_ma) DO UPDATE SET nhom_ma=EXCLUDED.nhom_ma''', (type_id, body.group_id))
        events.append(('routing.update', type_id))
        return {'message': 'Đã lưu ánh xạ. Phiếu chưa chốt nhóm dùng ánh xạ mới.'}


def remove_routing(actor, type_id, expected_group_id):
    with manager_cursor(actor, True) as (cur, events):
        check_routing_version(cur, type_id, expected_group_id)
        execute(cur, 'DELETE FROM {xu_ly_mac_dinh} WHERE ht_ma=%s AND nhom_ma=%s', (type_id, expected_group_id))
        events.append(('routing.remove', f'{type_id}:{expected_group_id}'))
        return {'message': 'Đã bỏ ánh xạ. Loại yêu cầu hiện chưa có nhóm mặc định.'}


def ticket_row(cur,ticket_id,lock=False):
    if lock:
        execute(cur,'SELECT phieu_ma FROM {phieu_ho_tro} WHERE phieu_ma=%s FOR UPDATE',(ticket_id,))
        if cur.fetchone() is None:raise HTTPException(404,'Không tìm thấy phiếu.')
    execute(cur,staff.VIEW+' WHERE p.phieu_ma=%s',(ticket_id,));row=cur.fetchone()
    if row is None:raise HTTPException(404,'Không tìm thấy phiếu.')
    return staff.decorate(row)


def filters(search='',type_id=None,status=None,priority=None,from_date=None,to_date=None,group_id=None,employee_id=None,customer_status=None,scope='all'):
    if from_date and to_date and from_date>to_date:raise HTTPException(422,'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.')
    conditions=['true'];params=[]
    if search:
        escaped=search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        conditions.append('(p.tieu_de ILIKE %s OR p.phieu_ma::text=%s)');params+=['%'+escaped+'%',search.removeprefix('#HT-')]
    for value,column in [(type_id,'p.ht_ma'),(status,'t.ma'),(priority,'p.mdut_ma'),(group_id,'g.nhom_ma'),(employee_id,'p.nhan_vien_phu_trach_ma')]:
        if value is not None:conditions.append(column+'=%s');params.append(value)
    for date,op,extra in [(from_date,'>=',0),(to_date,'<',1)]:
        if date:
            conditions.append('p.ngay_tao'+op+'%s');params.append(datetime.combine(date,time.min,timezone(timedelta(hours=7)))+timedelta(days=extra))
    if customer_status:
        conditions.append('EXISTS(SELECT 1 FROM {nguoi_dung} c WHERE c.nd_ma=p.khach_hang_ma AND c.trang_thai=%s)');params.append(customer_status)
    if scope in ('waiting','unrouted'):conditions.append("t.ma='MOI' AND p.nhan_vien_phu_trach_ma IS NULL")
    if scope=='unrouted':conditions.append("(g.nhom_ma IS NULL OR NOT g.dang_hoat_dong OR NOT EXISTS(SELECT 1 FROM {thanh_vien_nhom} m JOIN {nhan_vien} v ON v.nd_ma=m.nhan_vien_ma JOIN {nguoi_dung} a ON a.nd_ma=v.nd_ma WHERE m.nhom_ma=g.nhom_ma AND a.vai_tro='NHAN_VIEN' AND a.trang_thai='HOAT_DONG'))")
    return ' WHERE '+' AND '.join(conditions),params


def tickets(actor,page=1,page_size=10,**options):
    where,params=filters(**options)
    with manager_cursor(actor) as (cur,_):
        execute(cur,'SELECT count(*) total'+staff.FROM+where,params);total=cur.fetchone()['total']
        execute(cur,staff.VIEW+where+' ORDER BY p.ngay_cap_nhat DESC,p.phieu_ma DESC LIMIT %s OFFSET %s',params+[page_size,(page-1)*page_size]);rows=cur.fetchall()
        return dict(items=[staff.decorate(r) for r in rows],total=total,page=page,page_size=page_size)


def ticket_detail(actor,ticket_id):
    with manager_cursor(actor) as (cur,_):
        ticket=ticket_row(cur,ticket_id)
        execute(cur,'SELECT n.nd_ma::text id,n.ho_ten name FROM {phieu_ho_tro} p JOIN {nguoi_dung} n ON n.nd_ma=p.khach_hang_ma WHERE p.phieu_ma=%s',(ticket_id,));ticket['customer']=cur.fetchone()
        execute(cur,'''SELECT m.tn_ma::text id,n.ho_ten sender,m.noi_dung content,m.la_ghi_chu_noi_bo internal,m.thoi_gian created_at
          FROM {tin_nhan} m JOIN {nguoi_dung} n ON n.nd_ma=m.nguoi_gui_ma WHERE m.phieu_ma=%s ORDER BY m.thoi_gian DESC,m.tn_ma DESC LIMIT 201''',(ticket_id,));rows=cur.fetchall();ticket['messages_truncated']=len(rows)>200;ticket['messages']=list(reversed(rows[:200]))
        execute(cur,'SELECT tep_ma::text id,ten name,mime_type,kich_thuoc_byte size,ngay_tai_len created_at FROM {tep_dinh_kem} WHERE phieu_ma=%s ORDER BY tep_ma',(ticket_id,));ticket['attachments']=cur.fetchall()
        execute(cur,'''SELECT old.ten previous,new.ten current,h.thoi_diem created_at FROM {lich_su_trang_thai} h
          LEFT JOIN {trang_thai} old ON old.tt_ma=h.tt_cu_ma JOIN {trang_thai} new ON new.tt_ma=h.tt_moi_ma WHERE h.phieu_ma=%s ORDER BY h.thoi_diem,h.ls_ma''',(ticket_id,));ticket['history']=cur.fetchall()
        execute(cur,'''SELECT h.pc_ma::text id,n.ho_ten employee,h.bat_dau started_at,h.ket_thuc ended_at
          FROM {lich_su_phan_cong} h JOIN {nguoi_dung} n ON n.nd_ma=h.nhan_vien_ma WHERE h.phieu_ma=%s ORDER BY h.bat_dau,h.pc_ma''',(ticket_id,));ticket['assignments']=cur.fetchall()
        active=staff.active_assignment(cur,ticket_id);ticket['assignment_id']=str(active['pc_ma']) if active else None
        ticket['can_process']=False;ticket['routing_warning']=None
        return ticket


def eligible_employees(actor,group_id):
    with manager_cursor(actor) as (cur,_):
        group_row(cur,group_id)
        return staff.eligible(cur,group_id)


def status_history(cur,actor,ticket_id,old,target,reason):
    execute(cur,'SELECT tt_ma,ma FROM {trang_thai} WHERE ma=ANY(%s)',([old,target],));states={r['ma']:r['tt_ma'] for r in cur.fetchall()}
    if len(states)!=2:raise HTTPException(409,'Thiếu trạng thái phù hợp trong danh mục.')
    execute(cur,'UPDATE {phieu_ho_tro} SET tt_ma=%s WHERE phieu_ma=%s',(states[target],ticket_id))
    execute(cur,'INSERT INTO {lich_su_trang_thai}(phieu_ma,tt_cu_ma,tt_moi_ma,nguoi_thay_doi_ma,ghi_chu) VALUES(%s,%s,%s,%s,%s)',(ticket_id,states[old],states[target],actor,reason))


def assign(actor,ticket_id,body):
    with manager_cursor(actor,True) as (cur,events):
        ticket=ticket_row(cur,ticket_id,True);check_version(ticket,body.expected_updated_at)
        if ticket['status'] not in ('MOI','DANG_XU_LY','TAM_DUNG'):raise HTTPException(409,'Chỉ điều phối phiếu mới/đang xử lý/tạm dừng. Giữ bước khách xác nhận đóng.')
        previous=staff.active_assignment(cur,ticket_id)
        if (previous['pc_ma'] if previous else None)!=body.expected_assignment_id:raise HTTPException(409,'Phân công đã thay đổi. Hãy làm mới phiếu.')
        if bool(ticket['assigned_id'])!=bool(previous) or (previous and str(previous['nhan_vien_ma'])!=ticket['assigned_id']):raise HTTPException(409,'Phân công hiện tại không nhất quán; cần kiểm tra trước khi điều phối.')
        group=group_row(cur,body.group_id,True)
        if not group['active']:raise HTTPException(422,'Nhóm đích phải đang hoạt động.')
        if body.employee_id is not None and str(body.employee_id) not in {p['id'] for p in staff.eligible(cur,body.group_id)}:raise HTTPException(422,'Nhân viên đích phải hoạt động và thuộc nhóm đích.')
        if ticket['group_id']==str(body.group_id) and ticket['assigned_id']==(str(body.employee_id) if body.employee_id is not None else None):raise HTTPException(409,'Nhóm và phân công đã giống lựa chọn; không tạo thêm lịch sử trùng.')
        if previous:execute(cur,'UPDATE {lich_su_phan_cong} SET ket_thuc=clock_timestamp() WHERE pc_ma=%s',(previous['pc_ma'],))
        if body.employee_id is not None:insert_assignment(cur,ticket_id,body.employee_id,actor,body.reason)
        execute(cur,'UPDATE {phieu_ho_tro} SET nhom_ma=%s,nhan_vien_phu_trach_ma=%s WHERE phieu_ma=%s',(body.group_id,body.employee_id,ticket_id))
        target='DANG_XU_LY' if body.employee_id is not None and ticket['status']=='MOI' else 'MOI' if body.employee_id is None else ticket['status']
        if target!=ticket['status']:status_history(cur,actor,ticket_id,ticket['status'],target,body.reason)
        events.append(('ticket.assign',ticket_id));return ticket_row(cur,ticket_id)


def insert_assignment(cur,ticket_id,employee_id,actor,reason):
    execute(cur,'INSERT INTO {lich_su_phan_cong}(phieu_ma,nhan_vien_ma,nguoi_phan_cong_ma,bat_dau,ghi_chu) VALUES(%s,%s,%s,clock_timestamp(),%s)',(ticket_id,employee_id,actor,reason))


def download(actor,ticket_id,attachment_id):
    with manager_cursor(actor) as (cur,_):
        ticket_row(cur,ticket_id)
        execute(cur,'SELECT ten,duong_dan FROM {tep_dinh_kem} WHERE phieu_ma=%s AND tep_ma=%s',(ticket_id,attachment_id));record=cur.fetchone()
        if record is None:raise HTTPException(404,'Không tìm thấy tệp.')
        path=safe_path(record['duong_dan'])
        if not path.is_file():raise HTTPException(404,'Không tìm thấy tệp.')
        return path,record['ten']


POLICY_VIEW='''SELECT s.sla_ma::text id,s.ten name,s.mdut_ma priority_id,u.ten priority,
 s.thoi_gian_phan_hoi_phut response_minutes,s.thoi_gian_xu_ly_phut resolution_minutes,s.dang_hoat_dong active,
 (SELECT count(*) FROM {phieu_ho_tro} p WHERE p.sla_ma=s.sla_ma) referenced
 FROM {chinh_sach_sla} s JOIN {muc_do_uu_tien} u USING(mdut_ma)'''


def policy_row(cur,policy_id,lock=False):
    if lock:
        execute(cur,'SELECT sla_ma FROM {chinh_sach_sla} WHERE sla_ma=%s FOR UPDATE',(policy_id,))
        if cur.fetchone() is None:raise HTTPException(404,'Không tìm thấy chính sách SLA.')
    execute(cur,POLICY_VIEW+' WHERE s.sla_ma=%s',(policy_id,));row=cur.fetchone()
    if row is None:raise HTTPException(404,'Không tìm thấy chính sách SLA.')
    return row


def policies(actor,page=1,page_size=20):
    with manager_cursor(actor) as (cur,_):
        execute(cur,'SELECT count(*) total FROM {chinh_sach_sla}');total=cur.fetchone()['total']
        execute(cur,POLICY_VIEW+' ORDER BY s.sla_ma DESC LIMIT %s OFFSET %s',(page_size,(page-1)*page_size))
        return dict(items=cur.fetchall(),total=total,page=page,page_size=page_size)


def save_policy(actor,body,policy_id=None):
    with manager_cursor(actor,True) as (cur,events):
        execute(cur,'SELECT mdut_ma FROM {muc_do_uu_tien} WHERE mdut_ma=%s',(body.priority_id,))
        if cur.fetchone() is None:raise HTTPException(422,'Mức ưu tiên không hợp lệ.')
        values=(body.name,body.priority_id,body.response_minutes,body.resolution_minutes,body.active)
        if policy_id is not None:
            current=policy_row(cur,policy_id,True)
            if any(current[k]!=v for k,v in body.expected.model_dump().items()):raise HTTPException(409,'Chính sách đã thay đổi. Hãy làm mới.')
            if current['referenced'] and any(current[k]!=getattr(body,k) for k in ['name','priority_id','response_minutes','resolution_minutes']):raise HTTPException(409,'Chính sách đã được phiếu tham chiếu: chỉ bật/tắt hiệu lực. Hãy tạo phiên bản mới để giữ lịch sử và deadline cũ.')
            execute(cur,'UPDATE {chinh_sach_sla} SET ten=%s,mdut_ma=%s,thoi_gian_phan_hoi_phut=%s,thoi_gian_xu_ly_phut=%s,dang_hoat_dong=%s WHERE sla_ma=%s',(*values,policy_id))
        else:
            execute(cur,'INSERT INTO {chinh_sach_sla}(ten,mdut_ma,thoi_gian_phan_hoi_phut,thoi_gian_xu_ly_phut,dang_hoat_dong) VALUES(%s,%s,%s,%s,%s) RETURNING sla_ma',values);policy_id=cur.fetchone()['sla_ma']
        events.append(('sla.update' if hasattr(body,'expected') else 'sla.create',policy_id));return policy_row(cur,policy_id)


def apply_sla(actor,ticket_id,body):
    with manager_cursor(actor,True) as (cur,events):
        ticket=ticket_row(cur,ticket_id,True);check_version(ticket,body.expected_updated_at)
        if ticket['status'] not in ('MOI','DANG_XU_LY','TAM_DUNG'):raise HTTPException(409,'Không thay SLA của phiếu đã giải quyết/kết thúc.')
        execute(cur,'SELECT sla_ma,han_phan_hoi,han_xu_ly FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,));current=cur.fetchone()
        if any(v is not None for v in current.values()) and not body.recalculate:raise HTTPException(409,'Phiếu đã có SLA/hạn. Cần chọn tính lại và xác nhận rõ để thay đổi.')
        if not attach_sla(cur,ticket_id):raise HTTPException(409,'Chưa có chính sách SLA hoạt động cho mức ưu tiên của phiếu.')
        events.append(('ticket.sla.recalculate' if body.recalculate else 'ticket.sla.apply',ticket_id));return ticket_row(cur,ticket_id)


def reports(actor,page=1,page_size=10,**options):
    summary=overview(actor,**options)
    where,params=filters(**options)
    with manager_cursor(actor) as (cur,_):
        execute(cur,'SELECT count(DISTINCT p.nhan_vien_phu_trach_ma) total'+staff.FROM+where,params);total=cur.fetchone()['total']
        execute(cur,'''SELECT n.nd_ma::text id,n.ho_ten name,count(*) assigned,
          count(*) FILTER(WHERE NOT t.la_ket_thuc AND t.ma<>'DA_GIAI_QUYET') active,
          count(*) FILTER(WHERE t.ma='DA_GIAI_QUYET') resolved,count(*) FILTER(WHERE t.ma='DA_DONG') closed,
          count(*) FILTER(WHERE p.ngay_giai_quyet IS NOT NULL AND p.han_xu_ly IS NOT NULL) completed_with_deadline,
          count(*) FILTER(WHERE p.ngay_giai_quyet<=p.han_xu_ly) on_time,
          avg(EXTRACT(epoch FROM (p.ngay_phan_hoi_dau-p.ngay_tao))/60) average_first_response_minutes,
          avg(d.so_sao) average_rating'''+staff.FROM+' LEFT JOIN {danh_gia} d ON d.phieu_ma=p.phieu_ma'+where+''' AND n.nd_ma IS NOT NULL
          GROUP BY n.nd_ma,n.ho_ten ORDER BY active DESC,n.nd_ma LIMIT %s OFFSET %s''',params+[page_size,(page-1)*page_size])
        return dict(summary=summary,items=cur.fetchall(),total=total,page=page,page_size=page_size,locality_supported=False)


def activity(actor,page=1,page_size=20,event_from=None,event_to=None,**options):
    if event_from and event_to and event_from>event_to:raise HTTPException(422,'Khoảng thời gian hoạt động không hợp lệ.')
    where,params=filters(**options)
    query='WITH selected AS (SELECT p.phieu_ma,p.tieu_de'+staff.FROM+where+'''), events AS (
      SELECT 'status-'||h.ls_ma id,p.phieu_ma::text ticket_id,p.tieu_de title,h.thoi_diem happened_at,
       'Trạng thái' kind,COALESCE(n.ho_ten,'Không lưu người thực hiện') actor,t.ten detail
       FROM selected p JOIN {lich_su_trang_thai} h USING(phieu_ma) JOIN {trang_thai} t ON t.tt_ma=h.tt_moi_ma LEFT JOIN {nguoi_dung} n ON n.nd_ma=h.nguoi_thay_doi_ma
      UNION ALL SELECT 'assignment-'||h.pc_ma,p.phieu_ma::text,p.tieu_de,h.bat_dau,'Phân công',COALESCE(n.ho_ten,'Không lưu người thực hiện'),e.ho_ten
       FROM selected p JOIN {lich_su_phan_cong} h USING(phieu_ma) JOIN {nguoi_dung} e ON e.nd_ma=h.nhan_vien_ma LEFT JOIN {nguoi_dung} n ON n.nd_ma=h.nguoi_phan_cong_ma
      UNION ALL SELECT 'assignment-end-'||h.pc_ma,p.phieu_ma::text,p.tieu_de,h.ket_thuc,'Kết thúc phân công','Không lưu người kết thúc',e.ho_ten
       FROM selected p JOIN {lich_su_phan_cong} h USING(phieu_ma) JOIN {nguoi_dung} e ON e.nd_ma=h.nhan_vien_ma WHERE h.ket_thuc IS NOT NULL
      UNION ALL SELECT 'message-'||m.tn_ma,p.phieu_ma::text,p.tieu_de,m.thoi_gian,CASE WHEN m.la_ghi_chu_noi_bo THEN 'Ghi chú nội bộ' ELSE 'Phản hồi công khai' END,n.ho_ten,'Có trao đổi mới'
       FROM selected p JOIN {tin_nhan} m USING(phieu_ma) JOIN {nguoi_dung} n ON n.nd_ma=m.nguoi_gui_ma
      UNION ALL SELECT 'file-'||f.tep_ma,p.phieu_ma::text,p.tieu_de,f.ngay_tai_len,'Tệp đính kèm',COALESCE(n.ho_ten,'Không lưu người thực hiện'),'Có tệp được tải lên'
       FROM selected p JOIN {tep_dinh_kem} f USING(phieu_ma) LEFT JOIN {nguoi_dung} n ON n.nd_ma=f.nguoi_tai_len_ma
    ) '''
    event_where=' WHERE true'
    for value,op,extra in [(event_from,'>=',0),(event_to,'<',1)]:
        if value:
            event_where+=' AND happened_at'+op+'%s';params.append(datetime.combine(value + timedelta(days=extra), time.min, ZoneInfo('Asia/Ho_Chi_Minh')))
    with manager_cursor(actor) as (cur,_):
        execute(cur,query+'SELECT count(*) total FROM events'+event_where,params);total=cur.fetchone()['total']
        execute(cur,query+'SELECT id,ticket_id,title,happened_at,kind,actor,detail FROM events'+event_where+' ORDER BY happened_at DESC,id DESC LIMIT %s OFFSET %s',params+[page_size,(page-1)*page_size])
        return dict(items=cur.fetchall(),total=total,page=page,page_size=page_size)
