import { ChatbotWidget } from '../chatbot/Widget';
import { ThemeSwitcher } from '../theme';
import { useEffect, useRef, useState } from 'react';
import { Profile } from './Profile';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Plus, LogOut, History } from 'lucide-react';
import { useAuth } from '../auth';
import { Brand, Button, PageContainer } from '../components';

export function CustomerLayout(){
 const {user,logout}=useAuth();const navigate=useNavigate();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const location = useLocation();
 const [profileOpen, setProfileOpen] = useState(false);
 const identity = useRef<HTMLButtonElement>(null);
 const openProfile = (location.state as { openProfile?: boolean } | null)?.openProfile;
 useEffect(() => {
   if (!openProfile) return;
   setProfileOpen(true);
   navigate(location.pathname + location.search + location.hash, { replace: true, state: null });
 }, [openProfile, navigate, location.pathname, location.search, location.hash]);

 function closeProfile() {
   setProfileOpen(false);
   requestAnimationFrame(() => identity.current?.focus());
 }

 async function exit(){setBusy(true);try{await logout();navigate('/login',{replace:true});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="dashboard customer-dashboard"><aside className="sidebar"><Brand dashboard/><button ref={identity} type="button" className="identity customer-profile-trigger" aria-haspopup="dialog"
   aria-label={`Thông tin cá nhân của ${user!.name}`} onClick={() => setProfileOpen(true)}>
   <span className="avatar" aria-hidden="true">{user!.name.slice(0,1)}</span>
   <span className="customer-profile-identity"><strong>{user!.name}</strong><small>Khách hàng</small></span>
 </button><div className="sidebar-menu"><nav className="customer-nav" aria-label="Không gian Khách hàng">{[
   { Icon: LayoutDashboard, path: '/customer', label: 'Tổng quan' },
   { Icon: Plus, path: '/customer/tickets/new', label: 'Tạo phiếu yêu cầu' },
   { Icon: History, path: '/customer/tickets', label: 'Lịch sử yêu cầu' },
 ].map(({ Icon, path, label }) => (
   <NavLink key={path} end to={path} className={({ isActive }) => isActive ? 'sidebar-active' : 'sidebar-link'}>
     <Icon size={19}/>{label}
   </NavLink>
 ))}</nav><div className="sidebar-banner"><strong>Mọi yêu cầu,<br/>đều được lắng nghe.</strong><p>Không gian hỗ trợ của bạn.</p></div></div><div className="sidebar-footer"><ThemeSwitcher/><Button className="secondary" onClick={()=>void exit()} disabled={busy}><LogOut size={17}/>{busy?'Đang đăng xuất…':'Đăng xuất'}</Button>{error&&<p role="alert" className="error-box">{error}</p>}</div></aside><main id="main-content" className="dashboard-main"><div className="dashboard-top"><span>Cổng khách hàng</span><span className="badge">Khách hàng</span></div><PageContainer><Outlet/></PageContainer></main><ChatbotWidget/>{profileOpen && <Profile onClose={closeProfile}/>}</div>;
}
