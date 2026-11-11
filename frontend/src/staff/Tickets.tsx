import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { Button, Input } from '../components';
import type { Catalog } from '../customer/api';
import { formatDate } from '../customer/api';
import { staffApi, type StaffPage } from './api';

export function StaffTickets() {
  const navigate = useNavigate();
  const [data, setData] = useState<StaffPage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [statuses, setStatuses] = useState<Catalog[]>([]);
  const [priorities, setPriorities] = useState<Catalog[]>([]);
  const requestVersion = useRef(0);
  const pending = useRef(false);

  async function load(background = false) {
    if (background && (pending.current || document.visibilityState !== 'visible')) return;
    const version = ++requestVersion.current;
    pending.current = true;
    if (!background) { setBusy('load'); setError(''); }
    try {
      const result = await staffApi<StaffPage>(`/tickets?scope=mine&page=${page}&page_size=5&sort=${sort}&${query}`);
      if (version !== requestVersion.current) return;
      const lastPage = Math.max(1, Math.ceil(result.total / result.page_size));
      if (page > lastPage) setPage(lastPage);
      else setData(result);
    }
    catch (e) { if (!background && version === requestVersion.current) setError((e as Error).message); }
    finally { if (version === requestVersion.current) { pending.current = false; setBusy(''); } }
  }
  useEffect(() => {
    void load();
    const refresh = () => void load(true);
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      requestVersion.current++;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [page, query, sort]);
  useEffect(() => {
    void Promise.all([
      staffApi<Catalog[]>('/ticket-statuses'),
      staffApi<Catalog[]>('/priorities'),
    ]).then(([a, b]) => { setStatuses(a); setPriorities(b); }).catch(e => setError(e.message));
  }, []);

  const currentPage = data?.page ?? page;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const firstItem = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0;
  const lastItem = data ? Math.min(data.page * data.page_size, data.total) : 0;
  const title = 'Phiếu của tôi';
  const description = 'Danh sách phiếu đã được giao cho bạn để theo dõi và xử lý.';

  return (
    <>
      <div className="page-heading">
        <div><h1>{title}</h1><p>{description}</p></div>
        <Button disabled={!!busy} onClick={() => void load()}>Làm mới</Button>
      </div>
      <form
        className="panel filter-grid staff-filter-panel staff-mine-filter"
        onSubmit={e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const p = new URLSearchParams();
          fd.forEach((v, k) => { if (v) p.set(k, String(v)); });
          setPage(1);
          setQuery(p.toString());
        }}
      >
        <Input id="staff-search" name="search" label="Mã hoặc tiêu đề" maxLength={200} />
        <label className="field">Trạng thái
          <select name="status"><option value="">Tất cả</option>{statuses.map(i => <option key={i.id} value={i.code!}>{i.name}</option>)}</select>
        </label>
        <label className="field">Ưu tiên
          <select name="priority"><option value="">Tất cả</option>{priorities.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        </label>
        <Input id="staff-from" type="date" name="from" label="Từ ngày" />
        <Input id="staff-to" type="date" name="to" label="Đến ngày" />
        <Button className="staff-filter-submit" disabled={!!busy}>Lọc phiếu</Button>
      </form>
      {error && <p className="error-box" role="alert">{error}</p>}
      {busy === 'load' && <p role="status">Đang tải phiếu…</p>}
      {data && (
        <section className="panel staff-ticket-panel staff-mine-panel" aria-label={title}>
          <div className="staff-mine-toolbar">
            <h2>Danh sách phiếu được giao</h2>
            <label>Sắp xếp theo: <select value={sort} onChange={event => {
              setPage(1); setSort(event.target.value);
            }}><option value="newest">Mới nhất</option><option value="oldest">Cũ nhất</option></select></label>
          </div>
          <div className="table-scroll staff-ticket-scroll">
            <table className="ticket-table">
              <thead><tr>{['Phiếu', 'Nhóm hỗ trợ', 'Trạng thái', 'Mức độ ưu tiên'].map(x => <th key={x}>{x}</th>)}</tr></thead>
              <tbody>
                {data.items.map(t => (
                  <tr key={t.id} onClick={event => {
                    if (event.target instanceof Element && !event.target.closest('a') && !window.getSelection()?.toString()) {
                      navigate(`/staff/tickets/${t.id}`);
                    }
                  }}>
                    <td data-label="Phiếu">
                      <Link className="text-link" to={`/staff/tickets/${t.id}`} onKeyDown={event => {
                        if (event.key === ' ') { event.preventDefault(); navigate(`/staff/tickets/${t.id}`); }
                      }}>#HT-{t.id} · {t.title}</Link>
                      <small>{formatDate(t.created_at)}</small>
                      {!!t.unread_customer_messages && <span className="staff-unread-badge"><MessageCircle size={15} aria-hidden="true"/>
                        {t.unread_customer_messages} tin nhắn mới từ Khách hàng</span>}
                    </td>
                    <td data-label="Nhóm hỗ trợ">{t.group_name || 'Chưa xác định'}</td>
                    <td data-label="Trạng thái">
                      <span className={`staff-status-badge staff-status-${t.status.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`}>
                        {t.status_label}
                      </span>
                    </td>
                    <td data-label="Mức độ ưu tiên">
                      <span className={`staff-status-badge ${t.priority_rank === 3 ? 'staff-status-da_huy' :
                        t.priority_rank === 2 ? 'staff-status-tam_dung' : t.priority_rank === 1 ? 'staff-status-da_giai_quyet' : ''}`}>{t.priority}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && <p className="empty-state">Chưa có phiếu phù hợp. Nếu chưa được cấu hình nhóm, vui lòng liên hệ Quản lý.</p>}
          </div>
          <div className="staff-pagination" aria-label="Chuyển trang danh sách phiếu">
            <Button className="secondary" disabled={currentPage <= 1 || !!busy} onClick={() => setPage(currentPage - 1)}>Trước</Button>
            {
              <span className="staff-pagination-details" aria-live="polite">
                <span>Trang <strong>{data.page}</strong> / {totalPages}</span>
                <small>Hiển thị {firstItem}–{lastItem} trên tổng {data.total} phiếu</small>
              </span>}
            <Button className="secondary" disabled={currentPage * data.page_size >= data.total || !!busy} onClick={() => setPage(currentPage + 1)}>Sau</Button>
          </div>
        </section>
      )}
    </>
  );
}
