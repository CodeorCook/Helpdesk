import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../components';

export function RequestDialog({ title, close, busy, children }: {
  title: string; close: () => void; busy?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return <dialog ref={ref} className="customer-profile-dialog customer-request-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header><h2 id={titleId}>{title}</h2><Button type="button" className="secondary customer-profile-close"
      aria-label="Đóng" disabled={busy} onClick={close}><X size={18} aria-hidden="true"/></Button></header>
    <div className="customer-profile-body">{children}</div>
  </dialog>;
}
