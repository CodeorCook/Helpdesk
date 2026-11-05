import { useEffect, useId, useState } from 'react';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Button, Input } from '../components';
import type { Catalog } from '../customer/api';
import { managerApi } from './api';
import { allGroups, type Group } from './Groups';

const advancedKeys = ['priority', 'employee', 'from', 'to', 'scope', 'customer_status'];

function CatalogSelect({ name, label, items }: { name: string; label: string; items: Catalog[] }) {
  return <label className="field">{label}
    <select name={name}><option value="">Tất cả</option>
      {items.map(item => <option key={item.id} value={name === 'status' ? item.code ?? '' : item.id}>{item.name}</option>)}
    </select>
  </label>;
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
  const advancedCount = advancedKeys.filter(key => applied.has(key) && applied.get(key) !== 'all').length;

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
    }} onReset={() => onFilter('')} onInvalidCapture={event => {
      const field = event.target as HTMLInputElement;
      if (monitoring && !expanded && field.closest('[hidden]')) {
        setExpanded(true);
        requestAnimationFrame(() => field.reportValidity());
      }
    }}>
      <div className="manager-filter-fields">
        <Input id="manager-ticket-search" label="Mã hoặc tiêu đề phiếu" name="search" maxLength={200}/>
        <CatalogSelect name="type" label="Loại hỗ trợ" items={types}/>
        <CatalogSelect name="status" label="Trạng thái phiếu" items={statuses}/>
        {!monitoring && <CatalogSelect name="priority" label="Mức ưu tiên" items={priorities}/>}
        <label className="field">Nhóm hỗ trợ
          <select name="group"><option value="">Tất cả</option>
            {groups.map(group => <option key={group.id} value={group.id}>{group.name}{!group.active ? ' (đã ngừng)' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="manager-filter-fields" id={advancedId} hidden={!!monitoring && !expanded}>
        {monitoring && <CatalogSelect name="priority" label="Mức ưu tiên" items={priorities}/>}
        <Input id="manager-employee-filter" label="ID nhân viên phụ trách" name="employee" inputMode="numeric" pattern="[1-9][0-9]{0,18}"/>
        <Input id="manager-ticket-from" label="Từ ngày tạo phiếu" name="from" type="date"/>
        <Input id="manager-ticket-to" label="Đến ngày tạo phiếu" name="to" type="date"/>
        <label className="field">Phạm vi hàng đợi
          <select name="scope"><option value="all">Tất cả</option><option value="waiting">Chờ tiếp nhận</option><option value="unrouted">Chờ điều phối / thiếu nhóm hoặc nhân viên</option></select>
        </label>
        <label className="field">Trạng thái khách hàng
          <select name="customer_status"><option value="">Tất cả</option><option value="HOAT_DONG">Hoạt động</option><option value="KHOA">Đã khóa</option></select>
        </label>
      </div>
      {monitoring ? <div className="manager-monitor-actions">
        <Button type="button" className="secondary" aria-expanded={expanded} aria-controls={advancedId}
          onClick={() => setExpanded(!expanded)}>
          <SlidersHorizontal size={16} aria-hidden="true"/> Bộ lọc nâng cao
          {advancedCount > 0 && <span className="badge">{advancedCount} đang áp dụng</span>}
        </Button>
        <div>
          <Button type="reset" className="secondary">Xóa lọc</Button>
          <Button type="submit">Lọc dữ liệu</Button>
          <Button type="button" className="secondary manager-icon-button" title="Làm mới danh sách phiếu"
            aria-label="Làm mới danh sách phiếu" disabled={monitoring.busy} onClick={monitoring.refresh}>
            <RefreshCw size={17} aria-hidden="true" className={monitoring.busy ? 'manager-refresh-spin' : undefined}/>
          </Button>
        </div>
      </div> : <Button>Lọc dữ liệu</Button>}
    </form>
    {error && <p role="alert" className="error-box">{error}</p>}
  </>;
}
