"""Read-only conversation feed; all scopes use the existing role/ownership checks."""
from contextlib import contextmanager
from services import customer_service as customer,staff_service as staff,manager_service as manager
from fastapi import HTTPException
from core.uploads import display_name,safe_path,verified_image


@contextmanager
def scope(role,user_id,ticket_id):
    if role=='customer':
        with customer.customer_cursor(user_id) as cur:
            yield cur,customer.ticket_row(cur,user_id,ticket_id)
    elif role=='staff':
        with staff.staff_cursor(user_id) as cur:
            yield cur,staff.row(cur,user_id,ticket_id)
    else:
        with manager.manager_cursor(user_id) as (cur,_):
            yield cur,manager.ticket_row(cur,ticket_id)


def conversation(role,user_id,ticket_id,after=None,before=None):
    with scope(role,user_id,ticket_id) as (cur,ticket):
        private=role!='customer'
        conditions=['m.phieu_ma=%s'];params=[ticket_id]
        # Filter BEFORE pagination: customer cursors/counts never include private notes.
        if not private:conditions.append('NOT m.la_ghi_chu_noi_bo')
        if after is not None:conditions.append('m.tn_ma>%s');params.append(after)
        if before is not None:conditions.append('m.tn_ma<%s');params.append(before)
        order='ASC' if after is not None else 'DESC'
        staff.execute(cur,'''SELECT m.tn_ma::text id,m.nguoi_gui_ma::text sender_id,n.ho_ten sender,
          m.noi_dung content,m.la_ghi_chu_noi_bo internal,m.thoi_gian created_at,
          m.nguoi_gui_ma=p.khach_hang_ma AND NOT m.la_ghi_chu_noi_bo from_customer
          FROM {tin_nhan} m JOIN {phieu_ho_tro} p USING(phieu_ma)
          JOIN {nguoi_dung} n ON n.nd_ma=m.nguoi_gui_ma WHERE '''+' AND '.join(conditions)+' ORDER BY m.tn_ma '+order+' LIMIT 101',params)
        rows=cur.fetchall();overflow=len(rows)>100;messages=rows[:100]
        if after is None:messages.reverse()
        staff.execute(cur,'''SELECT tep_ma::text id,ten name,mime_type,kich_thuoc_byte size,
          nguoi_tai_len_ma::text sender_id,COALESCE(n.ho_ten,'Người tải tệp') sender,ngay_tai_len created_at
          FROM {tep_dinh_kem} f LEFT JOIN {nguoi_dung} n ON n.nd_ma=f.nguoi_tai_len_ma WHERE phieu_ma=%s ORDER BY ngay_tai_len,tep_ma''',(ticket_id,));attachments=cur.fetchall()
        for file in attachments:file['name']=display_name(file['name'])
        staff.execute(cur,'''SELECT 'status-'||h.ls_ma id,'Trạng thái: '||t.ten content,h.thoi_diem created_at
          FROM {lich_su_trang_thai} h JOIN {trang_thai} t ON t.tt_ma=h.tt_moi_ma WHERE h.phieu_ma=%s''',(ticket_id,));events=cur.fetchall()
        staff.execute(cur,'''SELECT 'assignment-'||h.pc_ma id,
          CASE WHEN h.nhan_vien_ma=h.nguoi_phan_cong_ma THEN n.ho_ten||' đã tiếp nhận phiếu.' ELSE 'Phiếu được giao cho '||n.ho_ten||'.' END content,h.bat_dau created_at
          FROM {lich_su_phan_cong} h JOIN {nguoi_dung} n ON n.nd_ma=h.nhan_vien_ma WHERE h.phieu_ma=%s
          UNION ALL SELECT 'assignment-end-'||h.pc_ma,'Kết thúc phân công của '||n.ho_ten||'.',h.ket_thuc
          FROM {lich_su_phan_cong} h JOIN {nguoi_dung} n ON n.nd_ma=h.nhan_vien_ma WHERE h.phieu_ma=%s AND h.ket_thuc IS NOT NULL''',(ticket_id,ticket_id));events+=cur.fetchall()
        can_send=role=='customer' and ticket['status'] in ('MOI','DANG_XU_LY','TAM_DUNG')
        if role=='staff':
            active=staff.active_assignment(cur,ticket_id)
            can_send=ticket['status'] in ('DANG_XU_LY','TAM_DUNG') and ticket['assigned_id']==str(user_id) and active is not None and str(active['nhan_vien_ma'])==str(user_id) and str(user_id) in {p['id'] for p in staff.eligible(cur,ticket['group_id'])}
        # Customer TicketResponse intentionally has no assigned ID; retrieve only public identity.
        staff.execute(cur,'SELECT nhan_vien_phu_trach_ma::text id FROM {phieu_ho_tro} WHERE phieu_ma=%s',(ticket_id,));assigned=cur.fetchone()['id']
        return dict(ticket_id=str(ticket_id),status=ticket['status'],status_label=ticket['status_label'],assigned_id=assigned,assigned_to=ticket['assigned_to'],group_id=ticket.get('group_id') if private else None,can_send=can_send,can_view_internal=private,
                    can_send_internal=can_send if role=='staff' else role=='manager' and manager.can_reply_to_staff(cur,ticket),
                    can_mark_read=role=='staff' and assigned==str(user_id) and staff.read_receipts_available(cur),
                    messages=messages,has_older=overflow if after is None else False,has_more=overflow if after is not None else False,events=events,attachments=attachments)


def preview(role,user_id,ticket_id,attachment_id):
    with scope(role,user_id,ticket_id) as (cur,_):
        staff.execute(cur,'SELECT ten,duong_dan,mime_type FROM {tep_dinh_kem} WHERE phieu_ma=%s AND tep_ma=%s',(ticket_id,attachment_id));file=cur.fetchone()
        if file is None:raise HTTPException(404,'Không tìm thấy tệp.')
        path=safe_path(file['duong_dan']);mime=verified_image(path,file['mime_type'])
        return path,display_name(file['ten']),mime
