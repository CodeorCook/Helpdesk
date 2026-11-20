import {formatDate,type Ticket} from './api';

export function TicketSLAInfo({ticket}:{ticket:Ticket}) {
  return <section className="panel"><h2>SLA của yêu cầu</h2>
    <small>{ticket.sla_phase==='provisional'?'Tạm tính khi chờ xét duyệt':ticket.sla_phase==='official'?'Chính thức đã gắn với phiếu':'Dữ liệu cũ chưa xác định giai đoạn SLA'}</small>
    <p>{ticket.sla_name || 'Chưa có SLA được lưu'}{ticket.sla_id && <> · #{ticket.sla_id}</>}</p>
    <dl className="detail-meta"><div><dt>Hạn phản hồi</dt><dd>{ticket.response_due?formatDate(ticket.response_due):'Chưa có'}</dd></div>
      <div><dt>Hạn xử lý</dt><dd>{ticket.resolution_due?formatDate(ticket.resolution_due):'Chưa có'}</dd></div></dl>
    <small>Hiển thị thời hạn đã lưu trên yêu cầu, tính liên tục từ lúc gửi. Thay đổi chính sách không tự cập nhật thời hạn này.</small>
  </section>;
}
