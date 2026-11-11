import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Conversation } from '../chat/Conversation';
import { Button } from '../components';
import { RequestDialog } from '../customer/RequestDialog';
import { formatDate } from '../customer/api';
import { staffApi, type StaffTicket } from './api';

type Detail = StaffTicket & {
  customer: { id: string; name: string };
  can_process: boolean;
  routing_warning: string | null;
  request_snapshot?: {
    title: string; description: string; type_name: string | null; sla_name: string | null;
    sla_state: string; response_due: string | null; resolution_due: string | null;
  } | null;
};

const transitions = {
  DANG_XU_LY: 'Tiếp tục xử lý',
  TAM_DUNG: 'Tạm dừng',
  DA_GIAI_QUYET: 'Đã giải quyết',
};
type Transition = keyof typeof transitions;

export function StaffDetail() {
  const { id } = useParams();
  return <TicketDetail key={id} id={id!}/>;
}

function TicketDetail({ id }: { id: string }) {
  const location = useLocation();
  const [data, setData] = useState<Detail>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nextStatus, setNextStatus] = useState<Transition | ''>('');
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const result = await staffApi<Detail>(`/tickets/${id}`);
      if (version === loadVersion.current) { setData(result); setError(''); }
    } catch (e) {
      if (version === loadVersion.current) { setData(undefined); setError((e as Error).message); }
    }
  }, [id]);
  useEffect(() => { void load(); return () => { loadVersion.current++; }; }, [load]);

  async function confirmStatus() {
    if (!nextStatus || !data?.can_process || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setStatusError('');
    setNotice('');
    try {
      const updated = await staffApi<StaffTicket>(`/tickets/${id}/status`, {
        method: 'POST', body: JSON.stringify({ status: nextStatus }),
      });
      setData(current => current && ({
        ...current, ...updated, can_process: updated.status !== 'DA_GIAI_QUYET' && current.can_process,
      }));
      setNextStatus('');
      setNotice('Đã cập nhật trạng thái phiếu.');
      await load();
    } catch (e) {
      setStatusError((e as Error).message);
      await load();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (data?.status === 'MOI') return <Navigate to={`/staff/requests/${id}`} replace/>;
  const allowed: Transition[] = data?.can_process && data.status === 'DANG_XU_LY' ? ['TAM_DUNG', 'DA_GIAI_QUYET']
    : data?.can_process && data.status === 'TAM_DUNG' ? ['DANG_XU_LY', 'DA_GIAI_QUYET'] : [];
  const snapshot = data?.request_snapshot;

  return <>
    <nav className="staff-review-breadcrumb staff-detail-breadcrumb" aria-label="Đường dẫn điều hướng">
      <Link to="/staff/mine" className="text-link">Phiếu của tôi</Link>
      <ChevronRight size={16} aria-hidden="true"/>
      <span aria-current="page">Phiếu #HT-{id}</span>
    </nav>
    {error && <p role="alert" className="error-box">{error}</p>}
    {(notice || location.state?.approved) && <p role="status" className="success-box">{notice || 'Đã lập phiếu hỗ trợ thành công.'}</p>}
    {!data && !error && <p role="status">Đang tải phiếu…</p>}
    {data && <>
      <div className="page-heading">
        <div><h1>{data.title}</h1><p>{data.customer.name} · Khách hàng #{data.customer.id}</p></div>
        <span className="badge">{data.status_label}</span>
      </div>
      {data.routing_warning && <p className="confirm-box">{data.routing_warning}</p>}
      <div className="detail-grid">
        <div>
          <section className="panel">
            <h2>Nội dung yêu cầu</h2>
            <p className="preserve-text">{data.description}</p>
            {snapshot && <details><summary>Nội dung gốc trước khi lập phiếu</summary>
              <h3 className="preserve-text">{snapshot.title}</h3>
              <p>{snapshot.type_name || 'Chưa phân loại'}</p>
              <p className="preserve-text">{snapshot.description}</p>
              <small>SLA tạm tính: {snapshot.sla_name || 'Chưa cấu hình'} · {snapshot.sla_state}</small>
              <p>Hạn phản hồi tạm tính: {snapshot.response_due ? formatDate(snapshot.response_due) : 'Chưa có'}</p>
              <p>Hạn xử lý tạm tính: {snapshot.resolution_due ? formatDate(snapshot.resolution_due) : 'Chưa có'}</p>
            </details>}
          </section>
          <Conversation role="staff" ticketId={data.id} revision={`${data.status}:${data.assigned_id}`} reload={load}
            headerStatus={data.status_label} headerAction={allowed.length > 0 && <select className="staff-chat-status"
              aria-label="Cập nhật trạng thái" value="" disabled={busy || !!nextStatus}
              onChange={event => { setStatusError(''); setNextStatus(event.target.value as Transition); }}>
              <option value="" disabled>Cập nhật trạng thái</option>
              {allowed.map(status => <option key={status} value={status}>{transitions[status]}</option>)}
            </select>}/>
        </div>
        <aside>
          <section className="panel"><h2>Thông tin phiếu</h2><dl className="detail-meta">
            {[['Nhóm', data.group_name || 'Chưa xác định'], ['Phụ trách', data.assigned_to || 'Chưa phân công'],
              ['Loại', data.type_name || 'Chưa phân loại'], ['Ưu tiên', data.priority],
              ['Tạo lúc', formatDate(data.created_at)]].map(([label, value]) =>
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl></section>
          <section className="panel"><h2>Theo dõi SLA</h2>
            <span className="badge">{data.sla_state}</span>
            {data.sla_name && <><p>{data.sla_name}</p><dl className="detail-meta">
              {[['Hạn phản hồi', data.response_due], ['Hạn xử lý', data.resolution_due]].map(([label, value]) =>
                <div key={label}><dt>{label}</dt><dd>{value ? formatDate(value) : 'Chưa có'}</dd></div>)}
            </dl></>}
          </section>
        </aside>
      </div>
    </>}
    {nextStatus && <RequestDialog title="Xác nhận cập nhật trạng thái" busy={busy}
      close={() => { if (!inFlight.current) setNextStatus(''); }}>
      <p>Phiếu <strong>#HT-{id}</strong></p>
      <p><strong>{data?.status_label ?? 'Không xác định'}</strong> → <strong>{transitions[nextStatus]}</strong></p>
      {statusError && <p role="alert" className="error-box">{statusError}</p>}
      <div className="actions">
        <Button className="secondary" disabled={busy} onClick={() => setNextStatus('')}>Hủy</Button>
        <Button disabled={busy || !allowed.includes(nextStatus)} onClick={() => void confirmStatus()}>
          {busy ? 'Đang cập nhật…' : 'Xác nhận'}
        </Button>
      </div>
    </RequestDialog>}
  </>;
}
