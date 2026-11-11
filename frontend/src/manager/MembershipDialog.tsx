import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components';
import { ManagerDialog } from './Dialog';
import { allGroups, type Group } from './Groups';
import { managerApi, type Membership } from './api';

export function MembershipDialog({ person, currentGroup, close, saved }: {
  person: { id: string; name: string; memberships: Membership[] };
  currentGroup: string;
  close: () => void;
  saved: (message: string) => Promise<void>;
}) {
  const [groups, setGroups] = useState<Group[]>();
  const [target, setTarget] = useState(person.memberships.length > 1 ? currentGroup : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const removed = person.memberships.filter(group => group.id !== target);
  const blocked = removed.some(group => group.pending > 0);
  const destination = groups?.find(group => group.id === target && group.active);

  useEffect(() => {
    let active = true;
    allGroups().then(items => { if (active) setGroups(items); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !destination || blocked) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await managerApi<{message: string}>(`/groups/${destination.id}/members/move`, {
        method: 'POST',
        body: JSON.stringify({ employee_id: person.id, expected_groups: person.memberships.map(group => group.id) }),
      });
      await saved(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <ManagerDialog title="Chuyển nhóm nhân viên" onClose={close} busy={busy}>
    <p>{person.name} · #{person.id}</p>
    <ul>{person.memberships.map(group => <li key={group.id}>{group.name} · {group.pending} phiếu được giao chưa kết thúc</li>)}</ul>
    <form className="manager-form" onSubmit={submit}>
      <label className="field">Nhóm duy nhất sau khi cập nhật
        <select value={target} required onChange={event => setTarget(event.target.value)} disabled={busy || !groups}>
          <option value="">Chọn nhóm hoạt động</option>
          {groups?.filter(group => group.active && (person.memberships.length > 1 || group.id !== currentGroup))
            .map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </label>
      {!!target && removed.length > 0 && <p>Bỏ liên kết với {removed.map(group => group.name).join(', ')}.</p>}
      {!!target && blocked && <p className="error-box" role="alert">Hãy điều phối các phiếu chưa kết thúc của nhóm sẽ bỏ trước khi xác nhận.</p>}
      {error && <p className="error-box" role="alert">{error}</p>}
      <div className="actions manager-dialog-actions">
        <Button type="button" className="secondary" onClick={close} disabled={busy}>Hủy</Button>
        <Button disabled={busy || !destination || blocked}>{busy ? 'Đang cập nhật…' : 'Xác nhận chuyển nhóm'}</Button>
      </div>
    </form>
  </ManagerDialog>;
}
