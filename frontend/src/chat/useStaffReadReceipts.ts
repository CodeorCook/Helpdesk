import { useEffect, useRef, type RefObject } from 'react';
import { api, ApiError } from '../api';

export function useStaffReadReceipts(
  ticketId: string,
  viewport: RefObject<HTMLDivElement | null>,
  visibleMessages: readonly string[],
  enabled: boolean,
) {
  const receipts = useRef({ ticketId, sent: new Set<string>(), inFlight: new Set<string>() });
  useEffect(() => {
    const root = viewport.current;
    if (!enabled || !root || !visibleMessages.length) return;
    if (receipts.current.ticketId !== ticketId) {
      receipts.current = { ticketId, sent: new Set(), inFlight: new Set() };
    }
    const { sent, inFlight } = receipts.current;
    const eligible = new Set(visibleMessages);
    const pending = new Set<string>();
    let timer: number | undefined;
    let stopped = false;

    function schedule(delay = 300) {
      if (!stopped && timer === undefined && document.visibilityState === 'visible') {
        timer = window.setTimeout(() => void flush(), delay);
      }
    }

    async function flush() {
      timer = undefined;
      if (stopped || document.visibilityState !== 'visible' || !navigator.onLine) return;
      const ids = Array.from(pending).filter(id => !sent.has(id) && !inFlight.has(id)).slice(0, 100);
      if (!ids.length) return;
      ids.forEach(id => { pending.delete(id); inFlight.add(id); });
      let retry = 300;
      try {
        await api(`/staff/tickets/${ticketId}/conversation/read`, {
          method: 'POST', body: JSON.stringify({ message_ids: ids }),
        });
        ids.forEach(id => sent.add(id));
      } catch (error) {
        if (error instanceof ApiError && [401, 403, 404, 409, 422].includes(error.status)) {
          stopped = true;
        } else {
          ids.forEach(id => pending.add(id));
          retry = 5000;
        }
      } finally {
        ids.forEach(id => inFlight.delete(id));
        if (pending.size) schedule(retry);
      }
    }

    const observer = new IntersectionObserver(entries => {
      if (document.visibilityState !== 'visible') return;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageId;
        if (entry.isIntersecting && id && eligible.has(id) && !sent.has(id)) pending.add(id);
      }
      if (pending.size) schedule();
    });

    function observe() {
      observer.disconnect();
      if (document.visibilityState !== 'visible') return;
      root!.querySelectorAll<HTMLElement>('[data-message-id]').forEach(node => {
        const id = node.dataset.messageId;
        if (id && eligible.has(id) && !sent.has(id)) observer.observe(node);
      });
    }

    observe();
    document.addEventListener('visibilitychange', observe);
    window.addEventListener('online', observe);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', observe);
      window.removeEventListener('online', observe);
    };
  }, [ticketId, viewport, visibleMessages, enabled]);
}
