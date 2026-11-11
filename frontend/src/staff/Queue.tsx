import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlarmClock, Clock3, ListTodo, RefreshCw } from 'lucide-react';
import { Button } from '../components';
import { formatDate } from '../customer/api';
import { staffApi, type StaffPage } from './api';

export function responseClock(createdAt: string, responseDue: string | null, now: number) {
  const deadline = responseDue ? Date.parse(responseDue) : NaN;
  const duration = deadline - Date.parse(createdAt);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const remaining = deadline - now;
  const seconds = remaining > 0 ? Math.ceil(remaining / 1000) : Math.floor(-remaining / 1000);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const tone: keyof typeof labels = remaining <= 0 ? 'overdue' : remaining <= duration / 2 ? 'soon' : 'waiting';
  return { tone, time };
}

const labels = { waiting: 'Đang chờ', soon: 'Sắp đến hạn', overdue: 'Đã quá hạn' };

export function StaffQueue() {
  const navigate = useNavigate();
  const [data, setData] = useState<StaffPage>();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('newest');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const clock = useRef<{ server: number; received: number } | null>(null);
  const notice = useLocation().state?.rejected ? 'Đã đóng yêu cầu không tiếp nhận.' : '';
  const serverTime = () => clock.current
    ? clock.current.server + performance.now() - clock.current.received : Date.now();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(serverTime()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    staffApi<StaffPage>(`/tickets?scope=queue&sort=${sort}&page=${page}&page_size=5`).then(result => {
      if (!active) return;
      if (result.server_now) clock.current = { server: Date.parse(result.server_now), received: performance.now() };
      setNow(serverTime());
      const last = Math.max(1, Math.ceil(result.total / result.page_size));
      if (result.page > last) setPage(last);
      else { setData(result); setBusy(false); }
    }).catch(e => {
      if (active) { setError(e.message); setBusy(false); }
    });
    return () => { active = false; };
  }, [page, sort, refresh]);

  useEffect(() => {
    if (busy) return;
    const threshold = data?.next_transition ? Date.parse(data.next_transition) - serverTime() : Infinity;
    const timeout = window.setTimeout(() => {
      setBusy(true);
      setError('');
      setRefresh(value => value + 1);
    },
      Math.max(50, Math.min(15000, error ? 15000 : threshold)));
    return () => window.clearTimeout(timeout);
  }, [data, error, busy, refresh]);

  function move(next: number) {
    setBusy(true);
    setError('');
    if (page === next) setRefresh(value => value + 1);
    else setPage(next);
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return <>
    <div className="page-heading"><div><h1>Yêu cầu chờ tiếp nhận</h1><p>Mở yêu cầu để xem nội dung gốc và lập phiếu hỗ trợ.</p></div>
      <Button className="secondary" disabled={busy} aria-label="Làm mới hàng đợi" title="Làm mới hàng đợi"
        onClick={() => move(page)}><RefreshCw size={18} aria-hidden="true"/></Button>
    </div>
    {notice && <p className="success-box" role="status">{notice}</p>}
    <div className="staff-queue-cards">{([
      ['waiting', 'Yêu cầu đang chờ', data?.total, 'Tất cả yêu cầu chưa được tiếp nhận.', ListTodo],
      ['soon', 'Sắp đến hạn', data?.soon, 'Đã dùng ít nhất 50% thời gian phản hồi.', Clock3],
      ['overdue', 'Đã quá hạn', data?.overdue, 'Đã đến hoặc vượt hạn phản hồi.', AlarmClock],
    ] as const).map(([tone, label, count, hint, Icon]) => <section key={tone} className={`panel staff-queue-card queue-tone-${tone}`}>
      <h2><Icon size={18} aria-hidden="true"/> {label}</h2><strong>{count ?? '—'}</strong><small>{hint}</small>
    </section>)}</div>
    <div className="staff-queue-controls">
      <label className="field">Sắp xếp theo<select value={sort} onChange={event => {
        setBusy(true); setError(''); setPage(1); setSort(event.target.value);
      }}><option value="newest">Mới nhất</option><option value="due">Gần đến hạn</option></select></label>
    </div>
    {error && <p className="error-box" role="alert">{error}</p>}
    {busy && <p role="status">Đang tải yêu cầu…</p>}
    {data && <section className="panel staff-ticket-panel staff-queue-panel">
      {data.items.length ? <div className="table-scroll"><table className="ticket-table staff-queue-table">
        <thead><tr>{['Yêu cầu','Loại hỗ trợ','Thời điểm gửi','Trạng thái chờ'].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.items.map(ticket => {
          const path = `/staff/requests/${ticket.id}`;
          const timing = responseClock(ticket.created_at, ticket.sla_name ? ticket.response_due : null, now);
          return <tr key={ticket.id} onClick={event => {
            if (event.target instanceof Element && !event.target.closest('a, button')) navigate(path);
          }}>
            <td data-label="Yêu cầu"><Link className="text-link" to={path}>#HT-{ticket.id} · {ticket.title}</Link>
              {ticket.recommended && <span className="badge staff-recommended-badge">Ưu tiên cho bạn</span>}</td>
            <td data-label="Loại hỗ trợ">{ticket.type_name ?? 'Chưa phân loại'}</td>
            <td data-label="Thời điểm gửi">{formatDate(ticket.created_at)}</td>
            <td data-label="Trạng thái chờ">{timing ? <div className={`queue-clock queue-tone-${timing.tone}`} title="Theo hạn phản hồi tạm tính đã lưu">
              <span className="queue-clock-badge">{labels[timing.tone]}</span>
              <small>{timing.tone === 'overdue' ? 'Quá hạn ' : ''}{timing.time}</small>
            </div> : <span className="muted">Chưa có hạn</span>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="empty-state">Hiện không có yêu cầu chờ tiếp nhận.</p>}
      <nav className="staff-pagination" aria-label="Chuyển trang hàng đợi">
        <Button className="secondary" disabled={busy || data.page <= 1} onClick={() => move(data.page - 1)}>Trước</Button>
        <span>Trang {data.page} / {pages} · {data.total} yêu cầu</span>
        <Button className="secondary" disabled={busy || data.page >= pages} onClick={() => move(data.page + 1)}>Sau</Button>
      </nav>
    </section>}
  </>;
}
