import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Headset, ShieldCheck } from 'lucide-react';
import { Button, Header, Input, PageContainer } from '../components';
import { useAuth } from '../auth';

export function Login() {
  const {user,login,loading}=useAuth(); const location=useLocation(); const navigate=useNavigate();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [show,setShow]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  if(!loading&&user) return <Navigate to={`/${user.role}`} replace/>;
  async function submit(event:FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const next=await login(email.trim(),password); setPassword('');
      const from=(location.state as {from?:string}|null)?.from;
      const destination=from && (['/support/new','/support/lookup'].includes(from)||(next.role==='customer'&&from.startsWith('/customer/'))) ? from : `/${next.role}`;
      navigate(destination,{replace:true});
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <><Header simple/><main id="main-content"><PageContainer className="login-grid"><section className="login-form"><span className="eyebrow">CỔNG HỖ TRỢ KHÁCH HÀNG</span><h1>Chào mừng trở lại!</h1><p>Đăng nhập để quản lý yêu cầu hỗ trợ và theo dõi những cập nhật mới nhất.</p>{(location.state as {registered?:boolean}|null)?.registered&&<p className="success-box" role="status">Đăng ký thành công. Vui lòng đăng nhập.</p>}<form onSubmit={submit}><Input label="Email" id="email" name="email" type="email" autoComplete="username" placeholder="Nhập địa chỉ email của bạn" required maxLength={150} value={email} onChange={e=>setEmail(e.target.value)}/><div className="password-field"><Input label="Mật khẩu" id="password" name="password" type={show?'text':'password'} autoComplete="current-password" placeholder="Nhập mật khẩu của bạn" required maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)}/><button className="password-toggle" type="button" aria-label={show?'Ẩn mật khẩu':'Hiện mật khẩu'} onClick={()=>setShow(!show)}>{show?<EyeOff size={19}/>:<Eye size={19}/>}</button></div><div className="unavailable-options"><label><input type="checkbox" disabled/> Ghi nhớ đăng nhập</label><span>Quên mật khẩu</span></div><small className="muted">Ghi nhớ đăng nhập và khôi phục mật khẩu chưa hỗ trợ.</small>{error&&<p className="error-box" role="alert">{error}</p>}<Button type="submit" disabled={busy||loading} className="full-width">{busy?'Đang đăng nhập…':'Đăng nhập'}<ArrowRight size={18}/></Button><p className="account-hint">Chưa có tài khoản? <Link className="text-link" to="/register">Đăng ký</Link></p></form><p className="login-help">Bạn gặp khó khăn khi đăng nhập?<br/>Vui lòng liên hệ người quản lý hệ thống của tổ chức.</p><Link className="text-link" to="/">Về trang chủ <ArrowRight size={16}/></Link></section><aside className="login-art"><div><span className="eyebrow">● LUÔN SẴN SÀNG HỖ TRỢ</span><h2>Mọi yêu cầu,<br/><em>đều được lắng nghe.</em></h2><p>Một nơi để gửi yêu cầu, theo dõi tiến độ và kết nối với đội ngũ hỗ trợ của bạn.</p></div><div className="support-orbit" aria-hidden="true"><span><Headset size={44}/></span><i className="orbit-check"><CheckCircle2/></i></div><div className="trust-row"><span><CheckCircle2/>Dễ dàng gửi yêu cầu</span><span><ShieldCheck/>Minh bạch tiến độ</span></div></aside></PageContainer></main><div className="login-footer container">© 2026 Hệ thống quản lý hỗ trợ khách hàng</div></>;
}
