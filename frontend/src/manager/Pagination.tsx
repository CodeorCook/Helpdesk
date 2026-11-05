import { Button } from '../components';

type PageInfo = { page: number; page_size: number; total: number };
export const lastPage = ({ total, page_size }: PageInfo) => Math.max(1, Math.ceil(total / page_size));

export function ManagerPagination({ data, label, move, busy }: {
  data: PageInfo;
  label: string;
  move: (page: number) => void;
  busy?: boolean;
}) {
  const { page, page_size, total } = data;
  const pages = lastPage(data);
  const range = total ? `${(page - 1) * page_size + 1}–${Math.min(page * page_size, total)}` : '0';
  return <nav className="manager-pagination" aria-label={`Phân trang ${label}`}>
    <Button className="secondary" disabled={busy || page <= 1} onClick={() => move(page - 1)}>Trước</Button>
    <span aria-live="polite">
      <strong>Trang {page} / {pages}</strong>
      <small>Hiển thị {range} trên tổng {total} {label}</small>
    </span>
    <Button className="secondary" disabled={busy || page >= pages} onClick={() => move(page + 1)}>Sau</Button>
  </nav>;
}
