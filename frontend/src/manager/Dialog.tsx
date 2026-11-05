import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../components';
import './styles.css';

export function ManagerDialog({ title, children, onClose, busy = false, wide = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return <dialog ref={ref} className={`manager-dialog${wide ? ' manager-dialog-wide' : ''}`}
    aria-labelledby={titleId} onCancel={event => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
    <div className="manager-dialog-header">
      <h2 id={titleId}>{title}</h2>
      <Button className="secondary manager-icon-button" type="button" aria-label="Đóng" disabled={busy} onClick={onClose}>
        <X size={18} aria-hidden="true"/>
      </Button>
    </div>
    <div className="manager-dialog-body">{children}</div>
  </dialog>;
}

export function ManagerStatus({ active, inactiveLabel = 'Đã khóa' }: { active: boolean; inactiveLabel?: string }) {
  return <span className={`manager-status ${active ? 'manager-status-active' : 'manager-status-inactive'}`}>
    {active ? 'Hoạt động' : inactiveLabel}
  </span>;
}
