import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '../components';
import { FileInput } from '../customer/FileInput';
import type { Catalog, UploadPolicy } from '../customer/api';
import { staffApi } from './api';

type Person = { id: string; name: string };
type Receipt = { id: string; message: string; warning: string; canView: boolean };
export function StaffNewTicket() {
  const [types, setTypes] = useState<Catalog[]>([]);
  const [priorities, setPriorities] = useState<Catalog[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [policy, setPolicy] = useState<UploadPolicy>();
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const searchVersion = useRef(0);
  useEffect(() => {
    let active = true;
    void Promise.all([staffApi<Catalog[]>('/ticket-types'), staffApi<Catalog[]>('/priorities'), staffApi<UploadPolicy>('/attachment-policy')])
      .then(([a, b, c]) => { if (active) { setTypes(a); setPriorities(b); setPolicy(c); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; searchVersion.current++; };
  }, []);
  function changeSearch(value: string) {
    searchVersion.current++; setSearch(value); setPeople([]); setCustomerId(''); setSearched(false); setSearching(false);
  }
  async function find(e: FormEvent) {
    e.preventDefault();
    if (search.trim().length < 2 || busy) return;
    const version = ++searchVersion.current;
    setSearching(true); setError(''); setPeople([]); setCustomerId('');
    try {
      const result = await staffApi<Person[]>('/customers?search=' + encodeURIComponent(search.trim()));
      if (version === searchVersion.current) { setPeople(result); setSearched(true); }
    } catch (e) { if (version === searchVersion.current) setError((e as Error).message); }
    finally { if (version === searchVersion.current) setSearching(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    const fd = new FormData(e.currentTarget);
    if (!people.some(p => p.id === customerId)) { setError('Vui lòng tìm và chọn một khách hàng hợp lệ.'); return; }
    if (!String(fd.get('title') || '').trim() || !String(fd.get('description') || '').trim()) { setError('Tiêu đề và mô tả chi tiết không được để trống.'); return; }
    const file = fd.get('file');
    if (file instanceof File && policy && file.size > policy.max_bytes) { setError('Tệp vượt giới hạn dung lượng.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const body = Object.fromEntries(['title', 'description', 'type_id', 'priority_id'].map(k => [k, fd.get(k)]));
      const result = await staffApi<{ id: string; message: string }>('/tickets', { method: 'POST', body: JSON.stringify({ ...body, customer_id: customerId }) });
      let warning = '';
      if (file instanceof File && file.size) {
        const data = new FormData(); data.append('file', file);
        try { await staffApi(`/tickets/${result.id}/attachments`, { method: 'POST', body: data }); }
        catch (e) { warning = 'Phiếu đã tạo, tệp chưa tải lên: ' + (e as Error).message; }
      }
      setReceipt({ ...result, warning, canView: false });
      try { await staffApi(`/tickets/${result.id}`); setReceipt({ ...result, warning, canView: true }); } catch { /* Never offer a detail link unless access was confirmed. */ }
    } catch (e) { setError((e as Error).message + ' Dữ liệu đã nhập được giữ lại. Nếu mất kết nối, hãy kiểm tra danh sách phiếu trước khi gửi lại.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="staff-new-page">
    <div className="page-heading"><div><h1>Lập phiếu thay khách</h1><p>Dành cho liên hệ qua điện thoại hoặc trực tiếp. Đây là phiếu mới, không phải bước tạo lại phiếu khách đã gửi trên web.</p></div></div>
    {error && <p className="error-box" role="alert">{error}</p>}
    {receipt ? <section className="panel staff-new-receipt">
      <h2>Đã ghi nhận yêu cầu</h2><p role="status" className="success-box">#HT-{receipt.id}: {receipt.message}</p>
      {receipt.warning && <p role="alert" className="confirm-box">{receipt.warning} Không gửi lại biểu mẫu để tránh tạo trùng.</p>}
      <div className="staff-new-actions">{receipt.canView && <Link className="button" to={`/staff/tickets/${receipt.id}`}>Xem phiếu vừa lập</Link>}<Link className="button secondary" to="/staff/queue">Về hàng đợi</Link></div>
      <p>Phiếu đang chờ tiếp nhận, không tự phân công. {receipt.canView ? 'Bạn có thể xem chi tiết theo quyền hiện tại.' : 'Chưa thể mở chi tiết từ đây. Theo dõi trong hàng đợi của bạn hoặc liên hệ Quản lý để điều phối.'} Không gửi lại form để tránh tạo trùng.</p>
    </section> : <>
      <section className="panel staff-new-search"><h2>Tìm khách hàng</h2>
        <form className="staff-new-search-row" onSubmit={e => void find(e)}>
          <Input id="customer-search" label="Tìm khách hàng theo họ tên, email đầy đủ hoặc ID" value={search} onChange={e => changeSearch(e.target.value)} disabled={busy} maxLength={150} aria-describedby="staff-customer-search-help" />
          <Button type="submit" disabled={busy || searching || search.trim().length < 2}>{searching ? 'Đang tìm…' : 'Tìm khách hàng'}</Button>
        </form>
        <p id="staff-customer-search-help" aria-live="polite">{searching ? 'Đang tìm khách hàng hoạt động…' : searched ? people.length ? `Tìm thấy ${people.length} kết quả (tối đa 20). Chọn khách hàng ở biểu mẫu bên dưới.` : 'Không tìm thấy khách hàng hoạt động phù hợp. Vui lòng kiểm tra tên, email đầy đủ hoặc ID.' : 'Nhập ít nhất 2 ký tự để tìm; chỉ hiện khách hàng hoạt động.'}</p>
      </section>
      <form className="panel customer-form staff-new-form" onSubmit={e => void submit(e)} aria-label="Thông tin phiếu thay khách">
        <h2 className="staff-new-wide">Thông tin phiếu</h2>
        <fieldset disabled={busy} className="staff-new-fields">
          <label className="field staff-new-wide" htmlFor="staff-customer"><span>Khách hàng</span><select id="staff-customer" required name="customer_id" value={customerId} onChange={e => setCustomerId(e.target.value)} aria-describedby="staff-selected-help"><option value="" disabled>Chọn khách hàng</option>{people.map(p => <option value={p.id} key={p.id}>#{p.id} · {p.name}</option>)}</select></label>
          <small id="staff-selected-help" className="staff-new-wide">{customerId ? 'Khách hàng đã chọn: ' + people.find(p => p.id === customerId)?.name : 'Cần tìm và chọn khách hàng trước khi lập phiếu.'}</small>
          <div className="staff-new-wide"><Input id="staff-new-title" label="Tiêu đề" name="title" maxLength={200} required /></div>
          <label className="field" htmlFor="staff-new-type"><span>Loại hỗ trợ</span><select id="staff-new-type" required name="type_id" defaultValue=""><option value="" disabled>Chọn loại hỗ trợ</option>{types.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field" htmlFor="staff-new-priority"><span>Mức ưu tiên</span><select id="staff-new-priority" required name="priority_id" defaultValue=""><option value="" disabled>Chọn ưu tiên</option>{priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field staff-new-wide" htmlFor="staff-new-description"><span>Mô tả chi tiết</span><textarea id="staff-new-description" name="description" rows={5} maxLength={20000} required placeholder="Ghi nhận vấn đề về nội thất, kênh liên hệ và thông tin khách cung cấp." /></label>
          <div className="staff-new-wide"><FileInput id="staff-new-file" label="Tệp đính kèm (tùy chọn)" accept={policy?.extensions.join(',')} /><small>Tối đa {policy ? (policy.max_bytes / 1048576).toFixed(1) : '…'} MiB; {policy?.extensions.join(', ')}.</small></div>
          <div className="staff-new-actions staff-new-wide"><Button type="submit" disabled={busy || searching || !customerId || !types.length || !priorities.length}>{busy ? 'Đang lập phiếu…' : 'Lập phiếu mới'}</Button><Link className="text-link" to="/staff/queue">Về hàng đợi</Link></div>
        </fieldset>
      </form>
    </>}
  </div>;
}
