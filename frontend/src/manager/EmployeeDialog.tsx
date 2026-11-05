import { useState, type FormEvent } from 'react';
import { Button, Input } from '../components';
import { ManagerDialog } from './Dialog';
import { managerApi, type Account } from './api';

export function EmployeeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (account: Account) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password'));
    if (password !== fd.get('password_confirmation')) {
      setError('Xác nhận mật khẩu không khớp.');
      return;
    }
    if (!/\p{L}/u.test(password) || !/[^\p{L}]/u.test(password)) {
      setError('Mật khẩu cần có chữ và số hoặc ký tự đặc biệt.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const account = await managerApi<Account>('/users', {
        method: 'POST',
        body: JSON.stringify({ ...Object.fromEntries(fd), phone: fd.get('phone') || null }),
      });
      onCreated(account);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <ManagerDialog title="Tạo nhân viên hỗ trợ" onClose={onClose} busy={busy}>
    <form className="manager-form" onSubmit={create}>
      <Input id="employee-name" name="name" label="Họ tên nhân viên" required maxLength={100}/>
      <Input id="employee-email" name="email" label="Email nhân viên" type="email" required maxLength={150}/>
      <Input id="employee-phone" name="phone" label="Số điện thoại (tùy chọn)" type="tel" maxLength={20}/>
      <Input id="employee-password" name="password" label="Mật khẩu ban đầu" type="password" autoComplete="new-password" required minLength={12} maxLength={1024}/>
      <Input id="employee-confirm" name="password_confirmation" label="Xác nhận mật khẩu" type="password" autoComplete="new-password" required maxLength={1024}/>
      <small>Tối thiểu 12 ký tự, có chữ và số hoặc ký tự đặc biệt. Hãy bàn giao mật khẩu qua kênh riêng. Chưa hỗ trợ gửi email hoặc bắt buộc đổi mật khẩu lần đầu.</small>
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="actions manager-dialog-actions">
        <Button className="secondary" type="button" disabled={busy} onClick={onClose}>Hủy</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo nhân viên'}</Button>
      </div>
    </form>
  </ManagerDialog>;
}
