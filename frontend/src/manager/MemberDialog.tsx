import { useState, type FormEvent } from 'react';
import { Button, Input } from '../components';
import { ManagerDialog } from './Dialog';
import { managerApi, type Account, type Page } from './api';

export function MemberDialog({ groupId, existing, close, added }: {
  groupId: string;
  existing: string[];
  close: () => void;
  added: () => Promise<void>;
}) {
  const [results, setResults] = useState<Account[]>();
  const [selection, setSelection] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setResults(undefined);
    setSelection('');
    const search = String(new FormData(event.currentTarget).get('search')).trim();
    try {
      const data = await managerApi<Page<Account>>(`/users?role=NHAN_VIEN&status=HOAT_DONG&page_size=20&search=${encodeURIComponent(search)}`);
      setResults(data.items.filter(person => !existing.includes(person.id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selection) return;
    setBusy(true);
    setError('');
    try {
      await managerApi(`/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ employee_id: selection }) });
      await added();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <ManagerDialog title="Thêm thành viên" onClose={close} busy={busy}>
    <form className="manager-form" onSubmit={search}>
      <Input id="group-employee-search" name="search" label="Tìm nhân viên theo tên, email hoặc ID" maxLength={150}/>
      <Button type="submit" className="secondary" disabled={busy}>Tìm nhân viên</Button>
    </form>
    <p className="muted">Hiển thị tối đa 20 kết quả mỗi lần tìm. Dùng email hoặc mã nhân viên để tìm chính xác hơn.</p>
    {results?.length === 0 && <p role="status">Chưa tìm thấy nhân viên có thể thêm.</p>}
    {error && <p role="alert" className="error-box">{error}</p>}
    <form className="manager-form" onSubmit={add}>
      {!!results?.length && <label className="field">Nhân viên
        <select required value={selection} disabled={busy} onChange={event => setSelection(event.target.value)}>
          <option value="">Chọn nhân viên</option>
          {results.map(person => <option key={person.id} value={person.id}>{person.name} · #{person.id} · {person.email}</option>)}
        </select>
      </label>}
      <div className="actions manager-dialog-actions">
        <Button type="button" className="secondary" onClick={close} disabled={busy}>Hủy</Button>
        <Button disabled={busy || !selection}>{busy ? 'Đang xử lý…' : 'Thêm vào nhóm'}</Button>
      </div>
    </form>
  </ManagerDialog>;
}
