import { useEffect, useId, useState } from 'react';
import { ChevronDown, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { Button, Input } from '../components';
import type { Catalog } from '../customer/api';
import { managerApi } from './api';
import { allGroups, type Group } from './Groups';

const advancedKeys = ['group', 'employee', 'scope', 'customer_status', 'sla_state', 'from', 'to'];

function CatalogSelect({ name, label, items, defaultValue = '' }: { name: string; label: string; items: Catalog[]; defaultValue?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue}>
        <option value="">Tất cả</option>
        {items.map(item => (
          <option key={item.id} value={name === 'status' ? item.code ?? '' : item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ManagerFilters({ onFilter, monitoring }: {
  onFilter: (query: string) => void;
  monitoring?: { query: string; refresh: () => void; busy: boolean };
}) {
  const [types, setTypes] = useState<Catalog[]>([]);
  const [statuses, setStatuses] = useState<Catalog[]>([]);
  const [priorities, setPriorities] = useState<Catalog[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const advancedId = useId();
  const applied = new URLSearchParams(monitoring?.query);
  const advancedCount = advancedKeys.filter(key => applied.has(key) && applied.get(key) !== '' && applied.get(key) !== 'all').length;

  useEffect(() => {
    let active = true;
    Promise.all([
      managerApi<Catalog[]>('/catalog/types'), managerApi<Catalog[]>('/catalog/statuses'),
      managerApi<Catalog[]>('/catalog/priorities'), allGroups(),
    ]).then(([typeItems, statusItems, priorityItems, groupItems]) => {
      if (!active) return;
      setTypes(typeItems);
      setStatuses(statusItems);
      setPriorities(priorityItems);
      setGroups(groupItems);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  return <>
    <form className={monitoring ? 'panel manager-monitor-filters' : 'panel filter-grid'} onSubmit={event => {
      event.preventDefault();
      const params = new URLSearchParams();
      new FormData(event.currentTarget).forEach((value, key) => {
        if (value && (key !== 'scope' || value !== 'all')) params.set(key, String(value));
      });
      onFilter(params.toString());
    }} onReset={event => {
      event.preventDefault();
      const form = event.currentTarget;
      form.reset();
      Array.from(form.elements).forEach(el => {
        if (el instanceof HTMLInputElement) {
          el.value = '';
        } else if (el instanceof HTMLSelectElement) {
          el.selectedIndex = 0;
        }
      });
      onFilter('');
    }} onInvalidCapture={event => {
      const field = event.target as HTMLInputElement;
      if (monitoring && !expanded && field.closest('[hidden]')) {
        setExpanded(true);
        requestAnimationFrame(() => field.reportValidity());
      }
    }}>
      {/* Hàng 1 mặc định: 4 trường quan trọng nhất */}
      <div className="manager-filter-fields manager-filter-primary">
        <Input
          id="manager-ticket-search"
          label="Mã hoặc tiêu đề phiếu"
          name="search"
          maxLength={200}
          placeholder="Nhập mã TK-... hoặc từ khóa"
          defaultValue={applied.get('search') ?? ''}
          icon={<Search size={16} />}
        />
        <CatalogSelect name="type" label="Loại hỗ trợ" items={types} defaultValue={applied.get('type') ?? ''}/>
        <CatalogSelect name="status" label="Trạng thái phiếu" items={statuses} defaultValue={applied.get('status') ?? ''}/>
        <CatalogSelect name="priority" label="Mức ưu tiên" items={priorities} defaultValue={applied.get('priority') ?? ''}/>
      </div>

      {/* 7 trường còn lại: Thu gọn mặc định, mở ra khi bấm Bộ lọc nâng cao */}
      <div className="manager-advanced-section" id={advancedId} hidden={!expanded}>
        {/* 6 trường nâng cao (Từ ngày và Đến ngày đã được gộp thành 1 cụm Thời gian) chia lưới 3 cột đều */}
        <div className="manager-filter-fields manager-filter-row-3">
          <label className="field">
            <span>Nhóm hỗ trợ</span>
            <select name="group" defaultValue={applied.get('group') ?? ''}>
              <option value="">Tất cả</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}{!group.active ? ' (đã ngừng)' : ''}
                </option>
              ))}
            </select>
          </label>
          <Input
            id="manager-employee-filter"
            label="ID nhân viên phụ trách"
            name="employee"
            placeholder="Nhập mã/tên nhân viên"
            inputMode="numeric"
            pattern="[1-9][0-9]{0,18}"
            defaultValue={applied.get('employee') ?? ''}
          />
          <label className="field">
            <span>Phạm vi hàng đợi</span>
            <select name="scope" defaultValue={applied.get('scope') ?? 'all'}>
              <option value="all">Tất cả</option>
              <option value="waiting">Chờ tiếp nhận</option>
              <option value="unrouted">Chờ điều phối / thiếu nhóm hoặc nhân viên</option>
            </select>
          </label>

          <label className="field">
            <span>Trạng thái khách hàng</span>
            <select name="customer_status" defaultValue={applied.get('customer_status') ?? ''}>
              <option value="">Tất cả</option>
              <option value="HOAT_DONG">Hoạt động</option>
              <option value="KHOA">Đã khóa</option>
            </select>
          </label>
          <label className="field">
            <span>Tình trạng SLA</span>
            <select name="sla_state" defaultValue={applied.get('sla_state') ?? ''}>
              <option value="">Tất cả</option>
              <option value="within">Trong hạn</option>
              <option value="soon">Sắp đến hạn</option>
              <option value="overdue">Quá hạn</option>
              <option value="ended">Đã kết thúc theo dõi</option>
              <option value="none">Chưa có SLA</option>
            </select>
          </label>
          <label className="field manager-date-range-field" htmlFor="manager-ticket-from">
            <span>Khoảng ngày tạo phiếu</span>
            <div className="manager-date-range-box">
              <span className="manager-date-sublabel">Từ</span>
              <input
                id="manager-ticket-from"
                name="from"
                type="date"
                aria-label="Từ ngày tạo phiếu"
                defaultValue={applied.get('from') ?? ''}
              />
              <span className="manager-date-range-sep">đến</span>
              <input
                id="manager-ticket-to"
                name="to"
                type="date"
                aria-label="Đến ngày tạo phiếu"
                defaultValue={applied.get('to') ?? ''}
              />
            </div>
          </label>
        </div>
      </div>

      {/* Cụm nút hành động */}
      {monitoring ? <div className="manager-monitor-actions">
        <Button
          type="button"
          className={`secondary manager-advanced-toggle ${expanded ? 'active' : ''}`}
          aria-expanded={expanded}
          aria-controls={advancedId}
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal size={15} aria-hidden="true"/>
          <span>Bộ lọc nâng cao</span>
          <ChevronDown size={14} aria-hidden="true" className={`manager-toggle-chevron ${expanded ? 'is-expanded' : ''}`}/>
          {advancedCount > 0 && <span className="badge">{advancedCount} đang áp dụng</span>}
        </Button>
        <div>
          <Button type="reset" className="secondary">Xóa lọc</Button>
          <Button type="submit">Lọc dữ liệu</Button>
          <Button
            type="button"
            className="secondary manager-icon-button"
            title="Làm mới danh sách phiếu"
            aria-label="Làm mới danh sách phiếu"
            disabled={monitoring.busy}
            onClick={monitoring.refresh}
          >
            <RefreshCw size={17} aria-hidden="true" className={monitoring.busy ? 'manager-refresh-spin' : undefined}/>
          </Button>
        </div>
      </div> : <Button>Lọc dữ liệu</Button>}
    </form>
    {error && <p role="alert" className="error-box">{error}</p>}
  </>;
}
