import { FileInput } from './FileInput';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components';
import { ApiError } from '../api';
import { customerApi, type UploadPolicy } from './api';
import type { DetailData } from './Detail';

export function Interaction({data,reload}:{data:DetailData;reload:()=>Promise<void>}){
 const [policy,setPolicy]=useState<UploadPolicy|null>(null);useEffect(()=>{let active=true;customerApi<UploadPolicy>('/attachment-policy').then(d=>{if(active)setPolicy(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 const [error,setError]=useState('');const [success,setSuccess]=useState('');const [busy,setBusy]=useState(false);
 const interactive=['MOI','DANG_XU_LY','TAM_DUNG'].includes(data.status);
 async function send(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const content=new FormData(form).get('content');setBusy(true);setError('');setSuccess('');try{await customerApi(`/tickets/${data.id}/messages`,{method:'POST',body:JSON.stringify({content})});form.reset();setSuccess('Đã gửi phản hồi.');await reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function upload(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget;const body=new FormData(form);const file=body.get('file');if(file instanceof File&&policy&&file.size>policy.max_bytes){setError('Tệp vượt quá giới hạn dung lượng.');return;}setBusy(true);setError('');setSuccess('');try{await customerApi(`/tickets/${data.id}/attachments`,{method:'POST',body});form.reset();setSuccess('Đã tải tệp lên.');await reload();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function download(id:string,name:string){setError('');try{const response=await fetch(`/api/v1/customer/tickets/${data.id}/attachments/${id}`,{credentials:'include'});if(!response.ok){const body=await response.json().catch(()=>({}));throw new ApiError(response.status,body.detail||'Không thể tải tệp.');}const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError((e as Error).message);}}
 return <>{error&&<p role="alert" className="error-box">{error}</p>}{success&&<p role="status" className="success-box">{success}</p>}<section className="panel"><h2>Tệp đính kèm</h2>{data.attachments.length?data.attachments.map(a=><div className="attachment-row" key={a.id}><div><strong>{a.name}</strong><small>{(a.size/1024).toFixed(1)} KB</small></div><Button className="secondary" onClick={()=>void download(a.id,a.name)}>Tải xuống</Button></div>):<p>Chưa có tệp đính kèm.</p>}{interactive&&<form onSubmit={upload}><FileInput id="attachment-file" label="Tệp cần tải lên" required accept={policy?.extensions.join(',')}/><small>Tối đa {policy?(policy.max_bytes/1048576).toFixed(1):'…'} MiB/tệp, 20 tệp/phiếu. TXT UTF-8, PDF tối đa 100 trang không mã hóa, PNG/JPEG tối đa 25 triệu điểm ảnh.</small><Button type="submit" disabled={busy}>Tải tệp lên</Button></form>}</section></>;
}
