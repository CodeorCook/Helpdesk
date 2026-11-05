import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../customer/api';
import type { StaffPage } from '../staff/api';
import { managerApi } from './api';
import { ManagerFilters } from './Filters';
import { lastPage, ManagerPagination } from './Pagination';

export function ManagerTickets() {
  const [data, setData] = useState<StaffPage>();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    setError('');
    managerApi<StaffPage>(`/tickets?page=${page}&page_size=5&${query}`).then(result => {
      if (!active) return;
      if (result.page > lastPage(result)) {
        setPage(lastPage(result));
        return;
      }
      setData(result);
      setBusy(false);
    }).catch(e => {
      if (active) {
        setError(e.message);
        setBusy(false);
      }
    });
    return () => { active = false; };
  }, [page, query, revision]);

  function refresh() {
    setBusy(true);
    setRevision(value => value + 1);
  }

  return <>
    <div className="page-heading"><div>
      <h1>Giám sát và điều phối phiếu</h1>
      <p>Theo dõi phiếu toàn hệ thống và mở chi tiết để điều phối.</p>
    </div></div>
    <ManagerFilters monitoring={{ query, refresh, busy }} onFilter={value => {
      setPage(1);
      setQuery(value);
      refresh();
    }}/>
    {error && <p className="error-box" role="alert">{error}</p>}
    {busy && <p role="status">Đang tải phiếu…</p>}
    {data && <section className="panel manager-list-panel" aria-label="Danh sách giám sát phiếu" aria-busy={busy}>
      <div className="table-scroll manager-monitor-table">
        <table className="ticket-table">
          <thead><tr><th>Phiếu</th><th>Nhóm / phụ trách</th><th>Trạng thái / ưu tiên</th><th>SLA</th></tr></thead>
          <tbody>{data.items.map(ticket => <tr key={ticket.id}>
            <td data-label="Phiếu">
              <Link className="text-link" to={`/manager/tickets/${ticket.id}`}>#HT-{ticket.id} · {ticket.title}</Link>
              <small>{ticket.type_name} · {formatDate(ticket.created_at)}</small>
            </td>
            <td data-label="Nhóm / phụ trách">{ticket.group_name || 'Chưa xác định nhóm'}<small>{ticket.assigned_to || 'Chưa phân công'}</small></td>
            <td data-label="Trạng thái / ưu tiên">
              <span className={`staff-status-badge staff-status-${ticket.status.toLowerCase()}`}>{ticket.status_label}</span>
              <small>{ticket.priority}</small>
            </td>
            <td data-label="SLA">{ticket.sla_state}</td>
          </tr>)}</tbody>
        </table>
        {!data.items.length && <p className="empty-state">Chưa có phiếu phù hợp.</p>}
      </div>
      <ManagerPagination data={data} label="phiếu" busy={busy} move={next => {
        if (next === page) refresh();
        else {
          setBusy(true);
          setPage(next);
        }
      }}/>
    </section>}
  </>;
}
