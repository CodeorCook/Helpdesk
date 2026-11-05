import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components';
import { customerApi, formatDate, type Catalog, type Ticket } from './api';
export function TicketTable({items}:{items:Ticket[]}){return items.length?<div className="table-scroll"><table className="ticket-table"><thead><tr><th>Mã phiếu / Nội dung</th><th>Loại hỗ trợ</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead><tbody>{items.map(t=><tr key={t.id}><td><Link className="ticket-title" to={`/customer/tickets/${t.id}`}>{t.title}</Link><small>#HT-{t.id}</small></td><td data-label="Loại hỗ trợ">{t.type_name||'Chưa phân loại'}</td><td data-label="Trạng thái"><span className={`badge ${['MOI','DANG_XU_LY'].includes(t.status)?'yellow':''}`}>{t.status_label}</span></td><td data-label="Cập nhật">{formatDate(t.updated_at)}</td></tr>)}</tbody></table></div>:<div className="empty-state"><h3>Chưa có phiếu phù hợp</h3><p>Thử điều chỉnh bộ lọc hoặc tạo yêu cầu hỗ trợ đầu tiên.</p><Link className="text-link" to="/customer/tickets/new">Tạo phiếu hỗ trợ →</Link></div>;}
type TicketPage = { items: Ticket[]; total: number; page: number; page_size: number };

function pageCount(data: TicketPage) {
  return Math.max(1, Math.ceil(data.total / data.page_size));
}

export function Tickets() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<TicketPage | null>(null);
  const [types, setTypes] = useState<Catalog[]>([]);
  const [statuses, setStatuses] = useState<Catalog[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      customerApi<Catalog[]>('/ticket-types'),
      customerApi<Catalog[]>('/ticket-statuses'),
    ]).then(([ticketTypes, ticketStatuses]) => {
      if (active) {
        setTypes(ticketTypes);
        setStatuses(ticketStatuses);
      }
    }).catch(e => { if (active) setCatalogError(e.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    const query = new URLSearchParams(params);
    query.delete('history');
    query.set('page_size', '5');
    customerApi<TicketPage>(`/tickets?${query}`).then(result => {
      if (!active) return;
      const lastPage = pageCount(result);
      if (result.page > lastPage) {
        query.delete('page_size');
        query.set('page', String(lastPage));
        setParams(query, { replace: true });
        return;
      }
      setData(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [params, setParams]);

  function filter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = new URLSearchParams();
    new FormData(e.currentTarget).forEach((value, key) => {
      if (value) next.set(key, String(value));
    });
    next.set('page', '1');
    setParams(next);
  }

  function move(page: number) {
    const next = new URLSearchParams(params);
    next.delete('history');
    next.delete('page_size');
    next.set('page', String(page));
    setParams(next);
  }

  return <>
    <div className="page-heading">
      <div>
        <span className="eyebrow">PHIẾU HỖ TRỢ</span>
        <h1>Lịch sử yêu cầu</h1>
        <p>Tìm theo tiêu đề, loại hỗ trợ, trạng thái và thời gian tạo phiếu (giờ Việt Nam).</p>
      </div>
      <Link className="button" to="/customer/tickets/new">Tạo phiếu hỗ trợ</Link>
    </div>
    <form className="panel customer-history-filters" key={params.toString()} onSubmit={filter}>
      <label className="field">Tiêu đề phiếu
        <input name="search" maxLength={200} defaultValue={params.get('search') || ''} placeholder="Tìm theo tiêu đề…"/>
      </label>
      <label className="field">Loại hỗ trợ
        <select key={types.length} name="type" defaultValue={params.get('type') || ''}>
          <option value="">Tất cả loại</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">Trạng thái
        <select key={statuses.length} name="status" defaultValue={params.get('status') || ''}>
          <option value="">Tất cả trạng thái</option>
          {statuses.map(t => <option key={t.id} value={t.code ?? ''}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">Từ ngày
        <input name="from" type="date" defaultValue={params.get('from') || ''}/>
      </label>
      <label className="field">Đến ngày
        <input name="to" type="date" defaultValue={params.get('to') || ''}/>
      </label>
      <div className="actions">
        <Button type="submit">Áp dụng</Button>
        <Button className="secondary" type="button" onClick={e => {
          e.currentTarget.form?.reset();
          setParams({ page: '1' });
        }}>Xóa lọc</Button>
      </div>
    </form>
    {catalogError && <p className="error-box" role="alert">{catalogError}</p>}
    {error && <p className="error-box" role="alert">{error}</p>}
    {!data && !error && <p role="status">Đang tải danh sách…</p>}
    {data && <section className="panel customer-history-panel" aria-label="Danh sách phiếu hỗ trợ">
      <div className="customer-history-table"><TicketTable items={data.items}/></div>
      <nav className="customer-history-pagination" aria-label="Chuyển trang danh sách phiếu">
        <Button className="secondary" disabled={data.page <= 1} onClick={() => move(data.page - 1)}>Trước</Button>
        <span aria-live="polite">
          <span>Trang <strong>{data.page}</strong> / {pageCount(data)}</span>
          <small>{data.total === 0 ? 'Hiển thị 0 trên tổng 0 phiếu' :
            `Hiển thị ${(data.page - 1) * data.page_size + 1}–${Math.min(data.page * data.page_size, data.total)} trên tổng ${data.total} phiếu`}</small>
        </span>
        <Button className="secondary" disabled={data.page >= pageCount(data)} onClick={() => move(data.page + 1)}>Sau</Button>
      </nav>
    </section>}
  </>;
}
