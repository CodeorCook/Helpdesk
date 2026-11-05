import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '../components';
import type { Catalog } from '../customer/api';
import { formatDate } from '../customer/api';
import { staffApi, type StaffPage } from './api';

type StaffScope = 'queue' | 'mine';

export function StaffTickets({ scope }: { scope: StaffScope }) {
  const [data, setData] = useState<StaffPage>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Catalog[]>([]);
  const [statuses, setStatuses] = useState<Catalog[]>([]);
  const [priorities, setPriorities] = useState<Catalog[]>([]);
  const requestVersion = useRef(0);

  async function load() {
    const version = ++requestVersion.current;
    setBusy('load');
    setError('');
    try {
      const result = await staffApi<StaffPage>(`/tickets?scope=${scope}&page=${page}&${scope === 'mine' ? 'page_size=5&' : ''}${query}`);
      if (version === requestVersion.current) setData(result);
    }
    catch (e) { if (version === requestVersion.current) setError((e as Error).message); }
    finally { if (version === requestVersion.current) setBusy(''); }
  }
  useEffect(() => { void load(); return () => { requestVersion.current++; }; }, [scope, page, query]);
  useEffect(() => {
    void Promise.all([
      staffApi<Catalog[]>('/ticket-types'),
      staffApi<Catalog[]>('/ticket-statuses'),
      staffApi<Catalog[]>('/priorities'),
    ]).then(([a, b, c]) => { setTypes(a); setStatuses(b); setPriorities(c); }).catch(e => setError(e.message));
  }, []);

  async function accept(id: string) {
    setBusy(id);
    setError('');
    try { await staffApi(`/tickets/${id}/accept`, { method: 'POST' }); await load(); }
    catch (e) { await load(); setError((e as Error).message); }
    finally { setBusy(''); }
  }

  const isQueue = scope === 'queue';
  const currentPage = isQueue ? page : (data?.page ?? page);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const firstItem = data && data.total > 0 ? (data.page - 1) * data.page_size + 1 : 0;
  const lastItem = data ? Math.min(data.page * data.page_size, data.total) : 0;
  const title = isQueue ? 'Yêu cầu chờ tiếp nhận' : 'Phiếu của tôi';
  const description = isQueue
    ? 'Tất cả phiếu đang chờ trong nhóm. Phiếu được đề xuất riêng có nhãn “Ưu tiên cho bạn”.'
    : 'Danh sách phiếu đã được giao cho bạn để theo dõi và xử lý.';

  return (
    <>
      <div className="page-heading">
        <div><h1>{title}</h1><p>{description}</p></div>
        <Button disabled={!!busy} onClick={() => void load()}>Làm mới</Button>
      </div>
      <form
        className="panel filter-grid staff-filter-panel"
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
        <label className="field">Loại hỗ trợ
          <select name="type"><option value="">Tất cả</option>{types.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        </label>
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
        <section className={`panel staff-ticket-panel${isQueue ? '' : ' staff-mine-panel'}`} aria-label={title}>
          <div className="table-scroll staff-ticket-scroll">
            <table className="ticket-table">
              <thead><tr>{['Phiếu', 'Nhóm / Loại', 'Trạng thái', 'SLA', 'Thao tác'].map(x => <th key={x}>{x}</th>)}</tr></thead>
              <tbody>
                {data.items.map(t => (
                  <tr key={t.id}>
                    <td data-label="Phiếu">
                      <Link className="text-link" to={`/staff/tickets/${t.id}`}>#HT-{t.id} · {t.title}</Link>
                      <small>{formatDate(t.created_at)}</small>
                      {t.recommended && <span className="badge staff-recommended-badge">Ưu tiên cho bạn</span>}
                    </td>
                    <td data-label="Nhóm / Loại">{t.group_name}<small>{t.type_name}</small></td>
                    <td data-label="Trạng thái">
                      <span className={`staff-status-badge staff-status-${t.status.toLowerCase().replace(/[^a-z0-9_-]/g, '')}`}>
                        {t.status_label}
                      </span>
                      <small>{t.priority} · {t.assigned_to || 'Chưa phân công'}</small>
                    </td>
                    <td data-label="SLA">{t.sla_state}</td>
                    <td data-label="Thao tác">
                      {t.status === 'MOI' && !t.assigned_id
                        ? <Button disabled={!!busy} onClick={() => void accept(t.id)}>{busy === t.id ? 'Đang tiếp nhận…' : 'Tiếp nhận'}</Button>
                        : <Link className="button staff-view-button" to={`/staff/tickets/${t.id}`}>Xem phiếu</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && <p className="empty-state">Chưa có phiếu phù hợp. Nếu chưa được cấu hình nhóm, vui lòng liên hệ Quản lý.</p>}
          </div>
          <div className="staff-pagination" aria-label="Chuyển trang danh sách phiếu">
            <Button className="secondary" disabled={currentPage <= 1 || !!busy} onClick={() => setPage(currentPage - 1)}>Trước</Button>
            {isQueue ? <span>Trang <strong>{page}</strong> · {data.total} phiếu</span> :
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
