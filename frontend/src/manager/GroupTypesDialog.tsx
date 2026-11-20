import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../components';
import { managerApi } from './api';
import { ManagerDialog, ManagerStatus } from './Dialog';
import { allGroups, type Group } from './Groups';
import type { SupportType } from './SupportTypes';

type Data = {available:boolean;items:SupportType[];groups:Group[]};
type Change = {kind:'remove'|'default'|'clear';row:SupportType};

export function GroupTypesDialog({groupId,close,onTypes}:{groupId:string;close:()=>void;onTypes:(types:{id:string;name:string}[])=>void}) {
  const [data,setData]=useState<Data>();
  const [change,setChange]=useState<Change>();
  const [busy,setBusy]=useState(false);
  const gate=useRef(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  async function load() {
    const [catalog,groups]=await Promise.all([managerApi<Omit<Data,'groups'>>(`/groups/${groupId}/support-types`),allGroups()]);
    return {...catalog,groups};
  }
  useEffect(()=>{let alive=true;load().then(result=>{if(alive)setData(result);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[groupId]);
  const group=data?.groups.find(g=>g.id===groupId);
  const assigned=data?.items.filter(t=>t.groups.some(g=>g.id===groupId))??[];
  const eligible=data?.items.filter(t=>t.active&&!t.groups.some(g=>g.id===groupId))??[];
  async function mutate(path:string,method:string,body?:unknown) {
    if(gate.current)return;
    gate.current=true;setBusy(true);setError('');setNotice('');
    try {
      const result=await managerApi<{message:string}>(path,{method,...(body?{body:JSON.stringify(body)}:{})});
      setChange(undefined);setNotice(result.message);
      const next=await load();setData(next);
      onTypes(next.items.filter(t=>t.groups.some(g=>g.id===groupId)).map(t=>({id:t.id,name:t.name})));
    } catch(e){setError((e as Error).message);}
    finally{gate.current=false;setBusy(false);}
  }
  function confirm() {
    if(!change)return;
    const {row,kind}=change;
    const current=row.groups.find(g=>g.is_default)?.id??null;
    if(kind==='remove')void mutate(`/groups/${groupId}/support-types/${row.id}`,'DELETE');
    else if(kind==='clear')void mutate(`/routing/${row.id}?expected_group_id=${current}`,'DELETE');
    else void mutate(`/routing/${row.id}`,'PATCH',{group_id:groupId,expected_group_id:current});
  }
  return <>
    <ManagerDialog title="Cập nhật loại hỗ trợ" busy={busy||!!change} onClose={close} wide>
      {error&&!change&&<p className="error-box" role="alert">{error}</p>}
      {notice&&<p className="success-box" role="status">{notice}</p>}
      {!data&&!error&&<p role="status">Đang tải loại hỗ trợ…</p>}
      {data&&group&&<>
        <div className="manager-section-heading"><h3>{group.name}</h3><ManagerStatus active={group.active} inactiveLabel="Ngừng hoạt động"/></div>
        <p><strong>{assigned.length}/2 loại hỗ trợ{assigned.length>2?' – Vượt giới hạn':''}</strong></p>
        {assigned.length>2&&<p className="notice">Vui lòng chủ động bỏ bớt quan hệ phụ trách. Hệ thống không tự xóa hoặc chuyển loại.</p>}
        {!data.available&&<p className="notice" role="status">CSDL chưa có quan hệ nhiều nhóm cùng phụ trách. Cần áp dụng migration 006_group_support_types.sql sau khi được duyệt. Hiện đang hiển thị các nhóm mặc định; không thể thêm quan hệ chuyên môn mới.</p>}
        <p className="muted">Nhiều nhóm có thể cùng chuyên môn. Chỉ một nhóm mặc định tiếp nhận yêu cầu mới; thêm chuyên môn không tự đổi định tuyến.</p>
        <ul className="manager-routing-list">{assigned.map(row=>{
          const current=row.groups.find(g=>g.is_default);
          return <li key={row.id}><div><strong>{row.name}</strong>{!row.active&&<small>Ngừng hoạt động</small>}
            <small>Nhóm mặc định: {current?.name??'Chưa cấu hình'}</small>
            <small>Cùng phụ trách: {row.groups.map(g=>g.name).join(', ')}</small></div>
            <div className="manager-routing-actions">
              {current?.id===groupId?<Button className="secondary" disabled={busy} onClick={()=>{setError('');setChange({kind:'clear',row});}}>Bỏ mặc định</Button>:
                <Button className="secondary" disabled={busy||!row.active||!group.active||!data.available} onClick={()=>{setError('');setChange({kind:'default',row});}}>Đặt làm mặc định</Button>}
              <Button className="secondary manager-icon-button" title={current?.id===groupId?'Bỏ hoặc đổi nhóm mặc định trước':'Bỏ quan hệ phụ trách'} aria-label={`Bỏ quan hệ phụ trách ${row.name}`}
                disabled={busy||!data.available||current?.id===groupId} onClick={()=>{setError('');setChange({kind:'remove',row});}}><Trash2 size={17}/></Button>
            </div></li>;
        })}</ul>
        {!assigned.length&&<p>Nhóm chưa phụ trách loại hỗ trợ nào.</p>}
        {assigned.length>=2&&<p className="notice">Nhóm đã đạt giới hạn tối đa 2 loại hỗ trợ. Hãy bỏ bớt trước khi thêm mới.</p>}
        <form className="manager-form" onSubmit={e=>{e.preventDefault();const id=String(new FormData(e.currentTarget).get('type_id'));if(id)void mutate(`/groups/${groupId}/support-types/${id}`,'POST');}}>
          <label className="field">Thêm nhóm cùng phụ trách<select name="type_id" required defaultValue="" disabled={busy||!data.available||!eligible.length||assigned.length>=2||!group.active}>
            <option value="">Chọn loại hỗ trợ đang hoạt động</option>{eligible.map(t=><option key={t.id} value={t.id}>{t.name} · {t.groups.length} nhóm đang phụ trách</option>)}
          </select></label>
          {data.available&&!eligible.length&&<p className="muted">Không còn loại đang hoạt động chưa thuộc nhóm này. Có thể thêm danh mục tại tab Loại hỗ trợ.</p>}
          <Button disabled={busy||!data.available||!eligible.length||assigned.length>=2||!group.active}>Thêm loại hỗ trợ</Button>
        </form>
      </>}
      <div className="actions manager-dialog-actions"><Button className="secondary" disabled={busy} onClick={close}>Đóng</Button></div>
    </ManagerDialog>
    {change&&<ManagerDialog title={change.kind==='remove'?'Xác nhận bỏ quan hệ phụ trách':change.kind==='clear'?'Xác nhận bỏ nhóm mặc định':'Xác nhận thay đổi nhóm mặc định'} busy={busy} onClose={()=>setChange(undefined)}>
      <p>Loại hỗ trợ: <strong>{change.row.name}</strong></p><p>Nhóm: <strong>{group?.name}</strong></p>
      {change.kind==='clear'?<p>Loại này tạm thời không có nhóm mặc định. Yêu cầu Mới chưa chốt nhóm sẽ chờ Quản lý cấu hình lại. Quan hệ chuyên môn vẫn được giữ.</p>:
        change.kind==='default'?<p>Chuyển mặc định từ <strong>{change.row.groups.find(g=>g.is_default)?.name??'Chưa cấu hình'}</strong> sang <strong>{group?.name}</strong>. Các nhóm cùng chuyên môn vẫn được giữ.</p>:
        <p>Chỉ bỏ quan hệ chuyên môn giữa nhóm và loại này. Không xóa danh mục hoặc phiếu.</p>}
      <p className="muted">Phiếu đã tiếp nhận giữ nguyên nhóm, người phụ trách và lịch sử.</p>
      {error&&<p className="error-box" role="alert">{error}</p>}
      <div className="actions"><Button className="secondary" disabled={busy} onClick={()=>setChange(undefined)}>Hủy</Button>
        <Button disabled={busy} onClick={confirm}>{busy?'Đang xử lý…':'Xác nhận'}</Button></div>
    </ManagerDialog>}
  </>;
}
