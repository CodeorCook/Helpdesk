import { validPhone } from '../validation';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Headset } from 'lucide-react';
import { api } from '../api';
import { Button, Header, Input, PageContainer } from '../components';

export function Register(){
  const navigate=useNavigate(); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); const data=new FormData(e.currentTarget);
    const values=Object.fromEntries(data) as Record<string,string>;if(!validPhone(values.phone)){setError('Số điện thoại không hợp lệ; cần 7–15 chữ số.');return;}
    if(values.password!==values.password_confirmation){setError('Xác nhận mật khẩu không khớp.');return;}
    if(!/[\p{L}]/u.test(values.password)||!/[\P{L}]/u.test(values.password)){setError('Mật khẩu cần có chữ và số hoặc ký tự đặc biệt.');return;}
    setBusy(true);setError('');
    try{await api('/auth/register',{method:'POST',body:JSON.stringify({...values,name:values.name.trim(),email:values.email.trim(),phone:values.phone||null})});navigate('/login',{replace:true,state:{registered:true}});}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><Header simple/><main id="main-content"><PageContainer className="login-grid"><section className="login-form"><span className="eyebrow">TÀI KHOẢN KHÁCH HÀNG</span><h1>Tạo tài khoản của bạn</h1><p>Kết nối với đội ngũ hỗ trợ và theo dõi mọi yêu cầu tại một nơi.</p><form onSubmit={submit}><Input id="name" name="name" label="Họ và tên" required maxLength={100} autoComplete="name"/><Input id="email" name="email" label="Email" type="email" required maxLength={150} autoComplete="email"/><Input id="phone" name="phone" label="Số điện thoại (không bắt buộc)" type="tel" maxLength={20} autoComplete="tel"/><Input id="password" name="password" label="Mật khẩu" type="password" minLength={12} maxLength={1024} required autoComplete="new-password"/><small>Từ 12 ký tự, có chữ và số hoặc ký tự đặc biệt. Có thể dùng một cụm từ dài; tối đa 1024 ký tự để giới hạn chi phí xử lý.</small><Input id="password_confirmation" name="password_confirmation" label="Xác nhận mật khẩu" type="password" required maxLength={1024} autoComplete="new-password"/>{error&&<p role="alert" className="error-box">{error}</p>}<Button type="submit" disabled={busy}>{busy?'Đang đăng ký…':'Đăng ký'}<ArrowRight size={18}/></Button></form><p className="login-help">Đã có tài khoản? <Link className="text-link" to="/login">Đăng nhập</Link></p></section><aside className="login-art"><div><span className="eyebrow">LUÔN SẴN SÀNG HỖ TRỢ</span><h2>Mọi yêu cầu,<br/><em>đều được lắng nghe.</em></h2><p>Tài khoản dành riêng cho Khách hàng. Thông tin yêu cầu được lưu và bảo vệ trong không gian của bạn.</p></div><div className="support-orbit" aria-hidden="true"><span><Headset size={44}/></span></div></aside></PageContainer></main></>;
}
