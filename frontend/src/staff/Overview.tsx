import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlarmClock, ArrowRight, CheckCircle2, ClipboardList, Hourglass, Inbox, Layers,
  MessageSquareText, Plus, RefreshCw, ShieldCheck, Sofa, Timer, Users, Zap,
} from 'lucide-react';
import { useAuth } from '../auth';
import { staffApi, type StaffPage, type StaffTicket } from './api';

type OverviewData = { assigned: number; queue: number; recommended: number; team: number; unrouted: number; groups: number; overdue: number };
type CatalogItem = { id: string; name: string; code?: string | null };
type RangeKey = 'today' | '7d' | 'month' | 'all';

const RANGES: [RangeKey, string][] = [['today', 'Hôm nay'], ['7d', '7 ngày qua'], ['month', 'Tháng này'], ['all', 'Tất cả']];
const STATUSES: { code: string; label: string; note: string; tone: string }[] = [
  { code: 'DANG_XU_LY', label: 'Đang xử lý', note: 'Đang làm việc với khách', tone: 'dang_xu_ly' },
  { code: 'TAM_DUNG', label: 'Tạm dừng', note: 'Chờ khách bổ sung thông tin', tone: 'tam_dung' },
  { code: 'DA_GIAI_QUYET', label: 'Đã giải quyết', note: 'Chờ khách xác nhận đóng', tone: 'da_giai_quyet' },
  { code: 'DA_DONG', label: 'Đã đóng', note: 'Khách đã xác nhận', tone: 'da_dong' },
  { code: 'DA_HUY', label: 'Đã hủy', note: 'Không tiếp nhận hoặc hủy', tone: 'da_huy' },
];
const ACTIVE = ['DANG_XU_LY', 'TAM_DUNG'];
const URGENCY: Record<string, number> = { 'Quá hạn': 0, 'Sắp quá hạn': 1, 'Trong hạn': 2 };

function vnToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}
function rangeFrom(range: RangeKey) {
  if (range === 'all') return '';
  const today = vnToday();
  if (range === 'today') return today;
  if (range === 'month') return today.slice(0, 8) + '01';
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}
function query(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
  return `/tickets?${q}`;
}
function nextDue(t: StaffTicket) {
  const due = [t.resolution_due, t.first_response_at ? null : t.response_due].filter(Boolean) as string[];
  return due.length ? Math.min(...due.map(d => new Date(d).getTime())) : null;
}
function remaining(t: StaffTicket, now: number) {
  const due = nextDue(t);
  if (due === null) return null;
  const minutes = Math.round((due - now) / 60000);
  const abs = Math.abs(minutes);
  const text = abs >= 1440 ? `${Math.floor(abs / 1440)} ngày` : abs >= 60 ? `${Math.floor(abs / 60)} giờ ${abs % 60 ? `${abs % 60} phút` : ''}`.trim() : `${abs} phút`;
  return minutes < 0 ? `Quá ${text}` : `Còn ${text}`;
}
function slaTone(state: string) {
  return state === 'Quá hạn' ? 'overdue' : state === 'Sắp quá hạn' ? 'soon' : state === 'Trong hạn' ? 'ok' : 'none';
}
function percent(part: number, total: number) {
  return total ? Math.round((part / total) * 100) : 0;
}

function Donut({ parts, total }: { parts: { tone: string; value: number }[]; total: number }) {
  const r = 70, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 180 180" className="sd-donut" role="img" aria-label={`Tổng ${total} phiếu`}>
      <circle cx="90" cy="90" r={r} className="sd-donut-track" />
      {total > 0 && parts.filter(p => p.value > 0).map(p => {
        const len = (p.value / total) * c;
        const el = <circle key={p.tone} cx="90" cy="90" r={r} className={`sd-donut-seg sd-seg-${p.tone}`}
          strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
        offset += len;
        return el;
      })}
    </svg>
  );
}

export function StaffOverview() {
  const { user } = useAuth();
  const [range, setRange] = useState<RangeKey>('7d');
  const [base, setBase] = useState<OverviewData>();
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<StaffTicket[]>([]);
  const [activeTotal, setActiveTotal] = useState(0);
  const [recent, setRecent] = useState<StaffTicket[]>([]);
  const [byType, setByType] = useState<{ name: string; value: number }[]>([]);
  const [teamTotal, setTeamTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState(Date.now());

  const load = useCallback(async () => {
    setBusy(true); setError('');
    const from = rangeFrom(range);
    try {
      const [overview, types, ...pages] = await Promise.all([
        staffApi<OverviewData>('/overview'),
        staffApi<CatalogItem[]>('/ticket-types'),
        ...STATUSES.map(s => staffApi<StaffPage>(query({ scope: 'mine', status: s.code, from, page_size: 1 }))),
        ...ACTIVE.map(code => staffApi<StaffPage>(query({ scope: 'mine', status: code, page_size: 50 }))),
        staffApi<StaffPage>(query({ scope: 'mine', from, page_size: 50 })),
        staffApi<StaffPage>(query({ scope: 'team', from, page_size: 1 })),
      ]);
      const counts: Record<string, number> = {};
      STATUSES.forEach((s, i) => { counts[s.code] = pages[i].total; });
      const activePages = pages.slice(STATUSES.length, STATUSES.length + ACTIVE.length);
      const recentPage = pages[STATUSES.length + ACTIVE.length];
      const teamPage = pages[STATUSES.length + ACTIVE.length + 1];
      const typeCounts = await Promise.all(types.map(t =>
        staffApi<StaffPage>(query({ scope: 'team', type: t.id, from, page_size: 1 })).then(p => ({ name: t.name, value: p.total }))));
      setBase(overview);
      setStatusCounts(counts);
      setActive(activePages.flatMap(p => p.items));
      setActiveTotal(activePages.reduce((sum, p) => sum + p.total, 0));
      setRecent(recentPage.items);
      setTeamTotal(teamPage.total);
      setByType(typeCounts.filter(t => t.value > 0).sort((a, b) => b.value - a.value));
      setLoadedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [range]);
  useEffect(() => { void load(); }, [load]);

  const totalMine = STATUSES.reduce((sum, s) => sum + (statusCounts[s.code] ?? 0), 0);
  const urgent = useMemo(() => [...active].sort((a, b) =>
    (URGENCY[a.sla_state] ?? 3) - (URGENCY[b.sla_state] ?? 3) ||
    (nextDue(a) ?? Infinity) - (nextDue(b) ?? Infinity)), [active]);
  const soon = active.filter(t => t.sla_state === 'Sắp quá hạn').length;
  const overdue = base?.overdue ?? 0;
  const unread = active.reduce((sum, t) => sum + (t.unread_customer_messages ?? 0), 0);

  const resolvedWithSla = recent.filter(t => t.resolved_at && t.resolution_due);
  const onTime = resolvedWithSla.filter(t => new Date(t.resolved_at!) <= new Date(t.resolution_due!)).length;
  const responded = recent.filter(t => t.first_response_at);
  const avgResponse = responded.length
    ? Math.round(responded.reduce((sum, t) => sum + (new Date(t.first_response_at!).getTime() - new Date(t.created_at).getTime()), 0) / responded.length / 60000)
    : null;
  const doneCount = (statusCounts.DA_GIAI_QUYET ?? 0) + (statusCounts.DA_DONG ?? 0);
  const rangeLabel = RANGES.find(([k]) => k === range)![1].toLowerCase();
  const maxType = Math.max(1, ...byType.map(t => t.value));

  return (
    <div className="sd-overview">
      <header className="sd-head">
        <div>
          <h1>Tổng quan hỗ trợ</h1>
          <p>Xin chào <strong>{user?.name}</strong>. Số liệu phiếu hỗ trợ của bạn và nhóm chuyên môn, cập nhật mỗi lần tải trang.</p>
        </div>
      </header>
      <div className="sd-toolbar">
        <div className="sd-segment" role="group" aria-label="Khoảng thời gian">
          {RANGES.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={range === key} className={range === key ? 'is-active' : ''} onClick={() => setRange(key)}>{label}</button>
          ))}
        </div>
        <button type="button" className="sd-btn sd-btn-ghost" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} className={busy ? 'sd-spin' : ''} /> {busy ? 'Đang tải…' : 'Làm mới'}
        </button>
        <Link to="/staff/new" className="sd-btn sd-btn-primary"><Plus size={16} /> Lập phiếu thay khách</Link>
      </div>

      {error && <p role="alert" className="error-box">{error}</p>}
      {base && (!base.groups || base.unrouted > 0) && (
        <p className="notice sd-notice" role="status">
          {!base.groups ? 'Bạn chưa thuộc nhóm hỗ trợ đang hoạt động. ' : ''}
          {base.unrouted > 0 ? `Có ${base.unrouted} yêu cầu chờ điều phối do thiếu nhóm hoặc nhân viên phù hợp; Quản lý cần cấu hình nhóm.` : ''}
        </p>
      )}

      <section className="sd-kpis" aria-label="Chỉ số chính">
        <Link to="/staff/queue" className="sd-kpi sd-tone-queue">
          <div className="sd-kpi-top"><span><Inbox size={15} /> Chờ tiếp nhận</span><i><Inbox size={17} /></i></div>
          <strong>{base?.queue ?? '–'}<small>yêu cầu</small></strong>
          <p>Hàng đợi của nhóm</p>
          <footer><span className="sd-chip">{base?.recommended ?? 0} ưu tiên cho bạn</span><span>Mở hàng đợi</span></footer>
        </Link>
        <Link to="/staff/mine" className="sd-kpi sd-tone-active">
          <div className="sd-kpi-top"><span><Zap size={15} /> Đang xử lý</span><em className="sd-live">Hiện tại</em></div>
          <strong>{statusCounts.DANG_XU_LY ?? '–'}<small>phiếu</small></strong>
          <p>Bạn đang phụ trách</p>
          <footer><span>{statusCounts.TAM_DUNG ?? 0} tạm dừng • {base?.assigned ?? 0} được giao</span></footer>
        </Link>
        <Link to="/staff/mine" className={`sd-kpi ${overdue ? 'sd-tone-risk' : 'sd-tone-plain'}`}>
          <div className="sd-kpi-top"><span><ShieldCheck size={15} /> Rủi ro SLA</span>
            <em className={overdue || soon ? 'sd-flag-bad' : 'sd-flag-good'}>{overdue || soon ? 'Cần xử lý' : 'An toàn'}</em></div>
          <strong>{overdue}<small>phiếu quá hạn</small></strong>
          <p>{soon} phiếu sắp đến hạn</p>
          <footer><span>Tính theo phiếu đang xử lý</span></footer>
        </Link>
        <div className="sd-kpi sd-tone-plain">
          <div className="sd-kpi-top"><span><Users size={15} /> Phiếu của nhóm</span><i><Layers size={17} /></i></div>
          <strong>{teamTotal}<small>phiếu</small></strong>
          <p>Tạo trong {rangeLabel}</p>
          <footer><span>{base?.groups ?? 0} nhóm hoạt động • tổng {base?.team ?? 0} phiếu</span></footer>
        </div>
        <Link to="/staff/mine" className="sd-kpi sd-tone-plain">
          <div className="sd-kpi-top"><span><CheckCircle2 size={15} /> Đã giải quyết</span><i><ClipboardList size={17} /></i></div>
          <strong>{doneCount}<small>phiếu</small></strong>
          <p>Giải quyết hoặc đã đóng</p>
          <footer><span>Phiếu tạo trong {rangeLabel}</span></footer>
        </Link>
      </section>

      <div className="sd-grid">
        <section className="sd-card sd-structure">
          <div className="sd-card-head">
            <div><span className="sd-eyebrow">Trực quan trạng thái</span><h2>Cơ cấu phiếu của tôi</h2></div>
            <span className="sd-chip">{totalMine} phiếu</span>
          </div>
          <div className="sd-donut-wrap">
            <Donut parts={STATUSES.map(s => ({ tone: s.tone, value: statusCounts[s.code] ?? 0 }))} total={totalMine} />
            <div className="sd-donut-label"><strong>{totalMine}</strong><span>Tổng phiếu</span><small>{rangeLabel}</small></div>
          </div>
          <h3 className="sd-subtitle">Theo trạng thái</h3>
          <ul className="sd-legend">
            {STATUSES.map(s => (
              <li key={s.code}>
                <i className={`sd-dot sd-seg-bg-${s.tone}`} />
                <div><strong>{s.label}</strong><small>{s.note}</small></div>
                <span className="sd-count">{statusCounts[s.code] ?? 0} phiếu</span>
                <span className="sd-chip">{percent(statusCounts[s.code] ?? 0, totalMine)}%</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="sd-side">
          <section className="sd-card">
            <div className="sd-card-head">
              <div><span className="sd-eyebrow">Phân bổ của nhóm</span><h2>Theo loại yêu cầu (Nội thất)</h2></div>
              <span className="sd-muted">{teamTotal} phiếu trong {rangeLabel}</span>
            </div>
            {byType.length === 0
              ? <p className="sd-empty">Chưa có phiếu nào của nhóm trong khoảng thời gian này.</p>
              : <ul className="sd-bars">
                {byType.map(t => (
                  <li key={t.name}>
                    <div className="sd-bar-label"><span><Sofa size={15} /> {t.name}</span><span><strong>{t.value} phiếu</strong><em className="sd-chip">{percent(t.value, teamTotal)}%</em></span></div>
                    <div className="sd-bar"><i style={{ width: `${(t.value / maxType) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>}
          </section>

          <div className="sd-metrics">
            <section className="sd-card sd-metric">
              <span className="sd-eyebrow">Giải quyết đúng hạn</span>
              <strong className="sd-good">{resolvedWithSla.length ? `${percent(onTime, resolvedWithSla.length)}%` : '–'}</strong>
              <p>Tỷ lệ đúng hạn SLA</p>
              <small><CheckCircle2 size={13} /> {onTime}/{resolvedWithSla.length} phiếu đã giải quyết có SLA</small>
            </section>
            <section className="sd-card sd-metric">
              <span className="sd-eyebrow">Thời gian phản hồi</span>
              <strong>{avgResponse === null ? '–' : avgResponse >= 60 ? `${Math.floor(avgResponse / 60)}g ${avgResponse % 60}p` : <>{avgResponse}<small> phút</small></>}</strong>
              <p>Phản hồi đầu trung bình</p>
              <small><Timer size={13} /> Trên {responded.length} phiếu gần nhất</small>
            </section>
            <section className="sd-card sd-metric">
              <span className="sd-eyebrow">Tin nhắn khách</span>
              <strong className={unread ? 'sd-warn' : ''}>{unread}</strong>
              <p>Tin nhắn chưa đọc</p>
              <small><MessageSquareText size={13} /> Trong phiếu đang xử lý</small>
            </section>
          </div>
        </div>
      </div>

      <section className="sd-card sd-table-card">
        <div className="sd-card-head">
          <div><h2><span className="sd-pulse" />Danh sách phiếu cần xử lý ngay</h2><p>Phiếu đang xử lý và tạm dừng của bạn, ưu tiên theo hạn SLA gần nhất.</p></div>
          <div className="sd-table-tools">
            <span className="sd-chip">{activeTotal} phiếu đang mở</span>
            <button type="button" className="sd-icon-btn" onClick={() => void load()} aria-label="Làm mới danh sách" disabled={busy}><RefreshCw size={16} className={busy ? 'sd-spin' : ''} /></button>
          </div>
        </div>
        <div className="sd-table-scroll">
          <table className="sd-table">
            <thead><tr><th>Mã phiếu</th><th>Nội dung yêu cầu & loại</th><th>Nhóm phụ trách</th><th>Trạng thái</th><th>Hạn SLA</th><th>Tác vụ</th></tr></thead>
            <tbody>
              {urgent.slice(0, 8).map(t => {
                const tone = slaTone(t.sla_state);
                const left = remaining(t, loadedAt);
                return (
                  <tr key={t.id}>
                    <td><Link className="sd-code" to={`/staff/tickets/${t.id}`}>#HT-{t.id}</Link></td>
                    <td>
                      <div className="sd-ticket">
                        <i><Sofa size={17} /></i>
                        <div><strong>{t.title}</strong><small>Loại: {t.type_name ?? 'Chưa phân loại'} • Ưu tiên {t.priority}</small>
                          {!!t.unread_customer_messages && <em className="sd-unread"><MessageSquareText size={12} /> {t.unread_customer_messages} tin chưa đọc</em>}</div>
                      </div>
                    </td>
                    <td><div className="sd-owner"><span className="avatar">{(user?.name ?? 'N').slice(0, 1)}</span><div><strong>{t.group_name ?? 'Chưa có nhóm'}</strong><small>{t.assigned_to ?? user?.name}</small></div></div></td>
                    <td><span className={`staff-status-badge staff-status-${t.status.toLowerCase()}`}>{t.status_label}</span></td>
                    <td><span className={`sd-sla sd-sla-${tone}`}>{tone === 'overdue' ? <AlarmClock size={14} /> : <Hourglass size={14} />}<span>{left ?? t.sla_state}</span></span></td>
                    <td><Link className="sd-btn sd-btn-ghost sd-btn-sm" to={`/staff/tickets/${t.id}`}>Chi tiết</Link></td>
                  </tr>
                );
              })}
              {!busy && urgent.length === 0 && (
                <tr><td colSpan={6} className="sd-empty">Bạn không có phiếu nào đang xử lý. Mở hàng đợi để tiếp nhận yêu cầu mới.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="sd-table-foot">
          <span>Hiển thị <strong>{Math.min(8, urgent.length)} / {activeTotal}</strong> phiếu đang mở</span>
          <Link to="/staff/mine" className="text-link">Xem toàn bộ phiếu của tôi <ArrowRight size={15} /></Link>
        </footer>
      </section>
    </div>
  );
}
