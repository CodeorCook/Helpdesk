import { ThemeSwitcher } from '../theme';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Brand, Button, PageContainer } from '../components';
import { useAuth } from '../auth';

export function StaffLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const links = [
    ['', 'Tổng quan'],
    ['queue', 'Yêu cầu chờ tiếp nhận'],
    ['mine', 'Phiếu của tôi'],
    ['new', 'Lập phiếu thay khách'],
  ];

  return (
    <div className="dashboard customer-dashboard staff-dashboard">
      <aside className="sidebar">
        <Brand dashboard />
        <div className="identity">
          <span className="avatar">{user?.name.slice(0, 1)}</span>
          <div><strong>{user?.name}</strong><small>Nhân viên hỗ trợ</small></div>
        </div>
        <div className="sidebar-menu">
          <nav className="customer-nav" aria-label="Không gian Nhân viên hỗ trợ">
            {links.map(([path, label]) => (
              <NavLink
                end
                key={path}
                to={`/staff${path ? `/${path}` : ''}`}
                className={({ isActive }) => isActive ? 'sidebar-active' : 'sidebar-link'}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <p>Phiếu ưu tiên được đánh dấu trong danh sách chờ. Chỉ khi tiếp nhận thành công, phiếu mới được giao.</p>
        </div>
        <div className="sidebar-footer">
          <ThemeSwitcher />
          <Button className="secondary" onClick={() => void logout().then(() => navigate('/login')).catch(e => setError(e.message))}>
            Đăng xuất
          </Button>
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      <main id="main-content" className="dashboard-main">
        <div className="dashboard-top"><span>Không gian hỗ trợ nội thất</span><span className="badge">Nhân viên hỗ trợ</span></div>
        <PageContainer><Outlet /></PageContainer>
      </main>
    </div>
  );
}
