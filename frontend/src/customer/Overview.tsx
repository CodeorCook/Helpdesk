import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { customerApi, type Ticket } from './api';
import { TicketTable } from './Tickets';

export function CustomerOverview(){
 const {user}=useAuth();const [data,setData]=useState<{total:number;active:number;resolved:number;closed:number}|null>(null);const [recent,setRecent]=useState<Ticket[]>([]);const [error,setError]=useState('');
 useEffect(()=>{let active=true;Promise.all([customerApi<{total:number;active:number;resolved:number;closed:number}>('/overview'),customerApi<{items:Ticket[]}>('/tickets?page_size=5')]).then(([d,t])=>{if(active){setData(d);setRecent(t.items);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 return <><div className="page-heading"><div><span className="eyebrow">TỔNG QUAN</span><h1>Xin chào, {user!.name}.</h1><p>Theo dõi yêu cầu và những cập nhật mới nhất của bạn.</p></div><Link className="button" to="/customer/tickets/new">Tạo phiếu hỗ trợ</Link></div>{error&&<p className="error-box" role="alert">{error}</p>}{!data&&!error&&<p role="status">Đang tải tổng quan…</p>}{data&&<><div className="stat-grid">{[['Tổng số phiếu',data.total],['Đang tiếp nhận / xử lý',data.active],['Đã giải quyết',data.resolved],['Đã đóng',data.closed]].map(([label,count])=><article className="panel stat" key={label}><p>{label}</p><strong>{count}</strong></article>)}</div><section className="panel"><div className="page-heading"><h2>Phiếu hỗ trợ gần đây</h2><Link className="text-link" to="/customer/tickets">Xem tất cả →</Link></div><TicketTable items={recent}/></section><section className="account-card"><div><h2>Thông tin tài khoản</h2><dl><div><dt>Họ tên</dt><dd>{user!.name}</dd></div><div><dt>Email</dt><dd>{user!.email}</dd></div><div><dt>Vai trò</dt><dd>Khách hàng</dd></div></dl><Link className="text-link" to="/customer/profile">Cập nhật hồ sơ →</Link></div></section></>}</>;
}
