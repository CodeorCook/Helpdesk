import { StaffQueue } from './staff/Queue';
import { RequestReview } from './staff/RequestReview';
import { ManagerReports } from './manager/Reports';
import { ManagerSLA } from './manager/SLA';
import { ManagerTickets } from './manager/Tickets';
import { ManagerTicketDetail } from './manager/TicketDetail';
import { ManagerGroups,ManagerGroup } from './manager/Groups';
import { StaffNewTicket } from './staff/NewTicket';
import { StaffDetail } from './staff/Detail';
import './staff/styles.css';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ProtectedRoute, StatusPage } from './components';
import { StaffLayout } from './staff/Layout';
import { StaffOverview } from './staff/Overview';
import { StaffTickets } from './staff/Tickets';
import { ManagerLayout } from './manager/Layout';
import { ManagerOverview } from './manager/Overview';
import { ManagerUsers,ManagerUser } from './manager/Users';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { CustomerLayout } from './customer/Layout';
import { NewTicket } from './customer/NewTicket';
import { CustomerOverview } from './customer/Overview';
import { Tickets } from './customer/Tickets';
import { TicketDetail } from './customer/Detail';
function ManagerUserRoute(){const {id}=useParams();return <ManagerUser key={id}/>;}
function ManagerGroupRoute(){const {id}=useParams();return <ManagerGroup key={id}/>;}
function ManagerTicketRoute(){const {id}=useParams();return <ManagerTicketDetail key={id}/>;}
function StaffRequestRoute(){const {id}=useParams();return <RequestReview key={id}/>;}
function StaffDetailRoute(){const {id}=useParams();return <StaffDetail key={id}/>;}
function TicketDetailRoute(){const {id}=useParams();return <TicketDetail key={id}/>;}
export function App(){return <><a className="skip-link" href="#main-content">Bỏ qua điều hướng</a><Routes><Route path="/" element={<Home/>}/><Route path="/login" element={<Login/>}/><Route path="/register" element={<Register/>}/><Route element={<ProtectedRoute role="manager"/>}><Route path="/manager" element={<ManagerLayout/>}><Route index element={<ManagerOverview/>}/><Route path="users" element={<ManagerUsers/>}/><Route path="users/:id" element={<ManagerUserRoute/>}/><Route path="groups" element={<ManagerGroups/>}/><Route path="groups/:id" element={<ManagerGroupRoute/>}/><Route path="routing" element={<Navigate to="/manager/groups" replace/>}/><Route path="sla" element={<ManagerSLA/>}/><Route path="reports" element={<ManagerReports/>}/><Route path="tickets" element={<ManagerTickets/>}/><Route path="tickets/:id" element={<ManagerTicketRoute/>}/></Route></Route><Route element={<ProtectedRoute role="staff"/>}><Route path="/staff" element={<StaffLayout/>}><Route index element={<StaffOverview/>}/><Route path="new" element={<StaffNewTicket/>}/><Route path="tickets/:id" element={<StaffDetailRoute/>}/><Route path="queue" element={<StaffQueue/>}/><Route path="requests/:id" element={<StaffRequestRoute/>}/><Route path="mine" element={<StaffTickets/>}/><Route path="recommended" element={<Navigate to="/staff/queue" replace/>}/><Route path="team" element={<Navigate to="/staff/mine" replace/>}/></Route></Route><Route element={<ProtectedRoute role="customer"/>}><Route path="/customer" element={<CustomerLayout/>}><Route index element={<CustomerOverview/>}/><Route path="tickets" element={<Tickets/>}/><Route path="tickets/:id" element={<TicketDetailRoute/>}/><Route path="tickets/new" element={<NewTicket/>}/><Route path="profile" element={<Navigate to="/customer" state={{ openProfile: true }} replace/>}/></Route><Route path="/support/new" element={<Navigate to="/customer/tickets/new" replace/>}/><Route path="/support/lookup" element={<Navigate to="/customer/tickets" replace/>}/></Route><Route path="*" element={<StatusPage title="404 · Không tìm thấy trang"><p>Đường dẫn này không tồn tại. Bạn có thể quay về trang chủ để tiếp tục.</p></StatusPage>}/></Routes></>;}
