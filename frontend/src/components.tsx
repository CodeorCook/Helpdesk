import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Headset, Menu, X } from 'lucide-react';
import { ThemeSwitcher } from './theme';
import { useAuth } from './auth';
import type { Role } from './api';

export function Button({className='', ...props}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}/>;
}
export function Input({label, id, ...props}: InputHTMLAttributes<HTMLInputElement> & {label:string; id:string}) {
  return <label className="field" htmlFor={id}><span>{label}</span><input id={id} {...props}/></label>;
}
export function PageContainer({children, className=''}: {children:ReactNode; className?:string}) {
  return <div className={`container ${className}`}>{children}</div>;
}
export function Brand({dashboard=false}:{dashboard?:boolean}={}) {
  const {user}=useAuth();const target=dashboard&&user?`/${user.role}`:'/';
  return <Link to={target} className="brand" aria-label={`Hệ thống quản lý hỗ trợ khách hàng — ${dashboard&&user?'Tổng quan '+user.role_label:'Trang chủ'}`}><span className="brand-icon"><Headset size={25}/></span><span><strong>Hệ thống quản lý</strong><small>hỗ trợ khách hàng</small></span></Link>;
}
export function Header({simple=false}: {simple?:boolean}) {
  const {user}=useAuth(); const [open,setOpen]=useState(false);
  return <header className="header"><PageContainer className="header-inner"><Brand/>{simple ? null  : <>
    <button className="menu-toggle" onClick={()=>setOpen(!open)} aria-expanded={open} aria-label={open?'Đóng điều hướng':'Mở điều hướng'}>{open?<X/>:<Menu/>}</button>
    <nav className={open?'navigation open':'navigation'} aria-label="Điều hướng chính"><Link onClick={()=>setOpen(false)} to="/">Trang chủ</Link>{[['Tính năng','features'],['Quy trình','process'],['Câu hỏi thường gặp','faq']].map(([label,id])=><a onClick={()=>setOpen(false)} key={id} href={`/#${id}`}>{label}</a>)}</nav>
    <Link className="button secondary header-action" to={user?`/${user.role}`:'/login'}>{user?'Không gian của bạn':'Đăng nhập'}<ArrowUpRight size={17}/></Link></>}<ThemeSwitcher/></PageContainer></header>;
}
export function Footer() {
  return <footer><PageContainer><div className="footer-grid"><div><Brand/><p>Một nơi để tiếp nhận, xử lý và theo dõi yêu cầu hỗ trợ khách hàng.</p></div><div><strong>Khám phá</strong><a href="/#features">Tính năng</a><a href="/#process">Quy trình hỗ trợ</a><a href="/#faq">Câu hỏi thường gặp</a></div><div><strong>Hỗ trợ</strong><Link to="/support/new">Gửi yêu cầu hỗ trợ</Link><Link to="/support/lookup">Tra cứu phiếu</Link><Link to="/login">Đăng nhập</Link></div></div><div className="footer-bottom">© 2026 Hệ thống quản lý hỗ trợ khách hàng <span>Trải nghiệm hỗ trợ rõ ràng.</span></div></PageContainer></footer>;
}
export function StatusPage({title,children}: {title:string;children:ReactNode}) {
  return <><Header simple/><main className="status-page container"><span className="eyebrow">CỔNG HỖ TRỢ KHÁCH HÀNG</span><h1>{title}</h1>{children}<Link className="button" to="/">Về trang chủ <ArrowUpRight size={17}/></Link></main></>;
}
export function ProtectedRoute({role}: {role?:Role}) {
  const {user,loading,error,refresh}=useAuth(); const location=useLocation();
  if(loading) return <StatusPage title="Đang kiểm tra phiên…"><p role="status">Vui lòng chờ trong giây lát.</p></StatusPage>;
  if(error) return <StatusPage title="Chưa thể kiểm tra phiên"><p role="alert">{error}</p><Button onClick={()=>void refresh()}>Thử lại</Button></StatusPage>;
  if(!user) return <Navigate to="/login" replace state={{from:location.pathname}}/>;
  if(role && user.role!==role) return <StatusPage title="Không đủ quyền truy cập"><p>Khu vực này dành cho một nhóm người dùng khác.</p><Link className="text-link" to={`/${user.role}`}>Đến không gian của bạn</Link></StatusPage>;
  return <Outlet/>;
}
