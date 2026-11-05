import { ChatbotWidget } from '../chatbot/Widget';
import { ThemeSwitcher } from '../theme';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Plus, UserRound, LogOut, History } from 'lucide-react';
import { useAuth } from '../auth';
import { Brand, Button, PageContainer } from '../components';

export function CustomerLayout(){
 const {user,logout}=useAuth();const navigate=useNavigate();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function exit(){setBusy(true);try{await logout();navigate('/login',{replace:true});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="dashboard customer-dashboard"><aside className="sidebar"><Brand dashboard/><div className="identity"><span className="avatar">{user!.name.slice(0,1)}</span><div><strong>{user!.name}</strong><small>Khách hàng</small></div></div><div className="sidebar-menu"><span className="eyebrow">KHÔNG GIAN CỦA BẠN</span><nav className="customer-nav" aria-label="Không gian Khách hàng">{[
   { Icon: LayoutDashboard, path: '/customer', label: 'Tổng quan' },
   { Icon: Plus, path: '/customer/tickets/new', label: 'Tạo phiếu hỗ trợ' },
   { Icon: History, path: '/customer/tickets', label: 'Lịch sử yêu cầu' },
   { Icon: UserRound, path: '/customer/profile', label: 'Thông tin cá nhân' },
 ].map(({ Icon, path, label }) => (
   <NavLink key={path} end to={path} className={({ isActive }) => isActive ? 'sidebar-active' : 'sidebar-link'}>
     <Icon size={19}/>{label}
   </NavLink>
 ))}</nav><div className="sidebar-banner"><strong>Mọi yêu cầu,<br/>đều được lắng nghe.</strong><p>Không gian hỗ trợ của bạn.</p></div></div><div className="sidebar-footer"><ThemeSwitcher/><Button className="secondary" onClick={()=>void exit()} disabled={busy}><LogOut size={17}/>{busy?'Đang đăng xuất…':'Đăng xuất'}</Button>{error&&<p role="alert" className="error-box">{error}</p>}</div></aside><main id="main-content" className="dashboard-main"><div className="dashboard-top"><span>Cổng khách hàng</span><span className="badge">Khách hàng</span></div><PageContainer><Outlet/></PageContainer></main><ChatbotWidget/></div>;
}
