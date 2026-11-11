import { CircleCheck } from 'lucide-react';
import { RequestDialog } from './RequestDialog';
import { FileInput } from './FileInput';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from '../components';
import { customerApi, type Catalog, type Ticket, type UploadPolicy } from './api';

export function NewTicket(){
 const [policy,setPolicy]=useState<UploadPolicy|null>(null);
 const navigate=useNavigate();const [types,setTypes]=useState<Catalog[]|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;customerApi<UploadPolicy>('/attachment-policy').then(d=>{if(active)setPolicy(d);}).catch(e=>{if(active)setError(e.message);});customerApi<Catalog[]>('/ticket-types').then(d=>{if(active)setTypes(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 const [receipt, setReceipt] = useState<{id:string; uploadError:string}>();
 const sending = useRef(false);
 function history() { navigate('/customer/tickets', { replace: true }); }

 async function submit(event: FormEvent<HTMLFormElement>) {
   event.preventDefault();
   if (sending.current || receipt) return;
   const fields = new FormData(event.currentTarget);
   const file = fields.get('file');
   if (file instanceof File && file.size && policy && file.size > policy.max_bytes) {
     setError('Tệp vượt quá giới hạn dung lượng.');
     return;
   }
   sending.current = true;
   setBusy(true);
   setError('');
   try {
     const ticket = await customerApi<Ticket>('/tickets', {
       method: 'POST',
       body: JSON.stringify({ title: fields.get('title'), description: fields.get('description'), type_id: fields.get('type_id') }),
     });
     let uploadError = '';
     if (file instanceof File && file.size) {
       const upload = new FormData();
       upload.append('file', file);
       try {
         await customerApi(`/tickets/${ticket.id}/attachments`, { method: 'POST', body: upload });
       } catch (e) {
         uploadError = 'Phiếu đã được tạo, nhưng tệp chưa tải lên: ' + (e as Error).message;
       }
     }
     setReceipt({ id: ticket.id, uploadError });
   } catch (e) {
     setError((e as Error).message);
   } finally {
     sending.current = false;
     setBusy(false);
   }
 }
 return <div className="customer-new-ticket-page"><h1>Tạo phiếu yêu cầu</h1><p>Gửi yêu cầu về sản phẩm nội thất, đơn hàng, giao hàng, lắp đặt hoặc dịch vụ sau bán hàng.</p><form className="customer-form panel" onSubmit={submit}><h2>Thông tin yêu cầu</h2><Input id="title" name="title" label="Tiêu đề" required maxLength={200} placeholder="Ví dụ: Cần hỗ trợ lắp đặt bàn ăn đã giao"/><label className="field">Loại hỗ trợ<select name="type_id" required defaultValue="" disabled={!types}><option value="" disabled>Chọn loại hỗ trợ</option>{types?.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="field">Mô tả chi tiết<textarea name="description" required maxLength={20000} rows={7} placeholder="Tên sản phẩm, mã đơn hàng/hóa đơn nếu có, thời điểm phát sinh và vấn đề cần hỗ trợ.
 Ví dụ: Cánh tủ bị lệch sau lắp đặt; vui lòng kiểm tra và hướng dẫn xử lý."/></label><FileInput id="new-file" label="Tệp đính kèm (không bắt buộc)" accept={policy?.extensions.join(',')}/><small>Tối đa {policy?(policy.max_bytes/1048576).toFixed(1):'…'} MiB. Hỗ trợ {policy?.extensions.join(', ')}. Có thể thêm tệp sau khi tạo phiếu, chẳng hạn ảnh sản phẩm hoặc hóa đơn đã che thông tin không cần thiết.</small>{error&&<p className="error-box" role="alert">{error}</p>}<div className="actions"><Button disabled={busy||!!receipt||!types?.length} type="submit">{busy?'Đang gửi…':'Gửi yêu cầu hỗ trợ'}</Button><Link className="button secondary" to="/customer">Hủy</Link></div></form>{receipt && <RequestDialog title="Đã gửi yêu cầu hỗ trợ thành công!" close={history}>
   <div className="customer-request-success">
     <CircleCheck size={54} aria-hidden="true"/>
     <p><strong>#HT-{receipt.id}</strong></p>
     <p>Nhân viên hỗ trợ sẽ kiểm tra và liên lạc với quý khách trong chốc lát!</p>
     {receipt.uploadError && <p className="error-box" role="alert">{receipt.uploadError}</p>}
     <Button type="button" onClick={history}>Xem lịch sử yêu cầu</Button>
   </div>
 </RequestDialog>}</div>;
}
