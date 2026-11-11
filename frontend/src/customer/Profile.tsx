import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { validPhone } from '../validation';
import { useAuth } from '../auth';
import { Button, Input } from '../components';
import { customerApi } from './api';

type ProfileData = { name: string; email: string; phone: string | null; gender: string | null };

export function Profile({ onClose }: { onClose: () => void }) {
  const { refresh } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  const [data, setData] = useState<ProfileData>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    let active = true;
    customerApi<ProfileData>('/profile').then(result => {
      if (active) setData(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const values = new FormData(event.currentTarget);
    setSuccess('');
    if (!validPhone(String(values.get('phone') || ''))) {
      setError('Số điện thoại không hợp lệ; cần 7–15 chữ số.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await customerApi<ProfileData>('/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name: String(values.get('name')).trim(),
          phone: values.get('phone') || null,
          gender: values.get('gender') || null,
        }),
      });
      setData(result);
      await refresh(true);
      setSuccess('Đã cập nhật hồ sơ.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function close() {
    if (!sending.current) onClose();
  }

  return <dialog ref={dialogRef} className="customer-profile-dialog" aria-labelledby="customer-profile-title" onCancel={event => {
    event.preventDefault();
    close();
  }}>
    <header>
      <h2 id="customer-profile-title">Thông tin cá nhân</h2>
      <Button type="button" className="secondary customer-profile-close" aria-label="Đóng" onClick={close} disabled={busy}>
        <X size={18} aria-hidden="true"/>
      </Button>
    </header>
    <div className="customer-profile-body">
      {error && <p role="alert" className="error-box">{error}</p>}
      {success && <p role="status" className="success-box">{success}</p>}
      {!data && !error && <p role="status">Đang tải hồ sơ…</p>}
      {data && <form onSubmit={submit} aria-busy={busy}>
        <fieldset key={JSON.stringify(data)} disabled={busy}>
          <Input id="customer-profile-name" name="name" label="Họ và tên" defaultValue={data.name} maxLength={100} required autoComplete="name"/>
          <Input id="customer-profile-email" label="Email" value={data.email} readOnly/>
          <Input id="customer-profile-phone" name="phone" label="Số điện thoại (không bắt buộc)" defaultValue={data.phone ?? ''} maxLength={20} type="tel" autoComplete="tel"/>
          <label className="field">Giới tính
            <select name="gender" defaultValue={data.gender ?? ''}>
              <option value="">Chưa cung cấp</option><option value="NAM">Nam</option><option value="NU">Nữ</option>
              <option value="KHAC">Khác</option><option value="KHONG_TIET_LO">Không muốn cung cấp</option>
              {data.gender && !['NAM','NU','KHAC','KHONG_TIET_LO'].includes(data.gender) &&
                <option value={data.gender} disabled>{data.gender} (giá trị hiện có; chọn lại để cập nhật)</option>}
            </select>
          </label>
          <small>Đổi email và mật khẩu chưa hỗ trợ; các thay đổi này cần quy trình xác minh riêng.</small>
        </fieldset>
        <div className="actions customer-profile-actions">
          <Button type="button" className="secondary" disabled={busy} onClick={close}>Hủy</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</Button>
        </div>
      </form>}
      {!data && <Button type="button" className="secondary" onClick={close}>Hủy</Button>}
    </div>
  </dialog>;
}
