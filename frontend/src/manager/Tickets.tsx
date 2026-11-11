import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { StaffPage } from '../staff/api';
import { managerApi } from './api';
import { ManagerFilters } from './Filters';
import { lastPage, ManagerPagination } from './Pagination';

export function ManagerTickets() {
  const navigate = useNavigate();
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
          <thead><tr><th>Mã phiếu</th><th>Tiêu đề phiếu</th><th>Nhóm / Loại hỗ trợ</th><th>Trạng thái phiếu</th><th>Mức ưu tiên</th></tr></thead>
          <tbody>{data.items.map(ticket => {
            const path = `/manager/tickets/${ticket.id}`;
            const color = ticket.priority_rank === 3 ? 'da_huy' : ticket.priority_rank === 2 ? 'tam_dung' :
              ticket.priority_rank === 1 ? 'da_giai_quyet' : '';
            return <tr key={ticket.id} onClick={event => {
              if (event.target instanceof Element && !event.target.closest('a') && !window.getSelection()?.toString()) navigate(path);
            }}>
            <td data-label="Mã phiếu">
              <Link className="text-link" to={path} aria-label={`#HT-${ticket.id} · ${ticket.title}`}
                onKeyDown={event => { if (event.key === ' ') { event.preventDefault(); navigate(path); } }}>#HT-{ticket.id}</Link>
            </td>
            <td data-label="Tiêu đề phiếu"><span className="manager-monitor-title" title={ticket.title}>{ticket.title}</span></td>
            <td data-label="Nhóm / Loại hỗ trợ">{ticket.group_name || 'Chưa xác định nhóm'}<small>{ticket.type_name || 'Chưa phân loại'}</small></td>
            <td data-label="Trạng thái phiếu">
              <span className={`staff-status-badge staff-status-${ticket.status.toLowerCase()}`}>{ticket.status_label}</span>
            </td>
            <td data-label="Mức ưu tiên"><span className={`staff-status-badge staff-status-${color}`}>{ticket.priority}</span></td>
          </tr>; })}</tbody>
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
