import {test,expect,type Page} from '@playwright/test';

const request=(id:string)=>({id:`e${id}`,ticket_id:id,requester_id:'77',requester:'Nhân viên fixture',source_group_id:'1',source_group:'Bảo hành',reason:`Cần chuyên môn khác cho phiếu ${id}`,created_at:'2026-09-01T01:00:00Z',status:'CHO_XU_LY',handled_at:null,outcome:null,manager:null,assigned_to:null,assigned_id:null,result_assignment_id:null});
const ticket=(id:string)=>({id,title:`Bảo hành sofa ${id}`,description:'Chân sofa cần kiểm tra',type_id:'6',type_name:'Bảo hành sản phẩm',group_id:'1',group_name:'Bảo hành',assigned_id:'77',assigned_to:'Nhân viên fixture',status:'DANG_XU_LY',status_label:'Đang xử lý',priority:'Cao',priority_rank:3,priority_id:'3',created_at:'2026-09-01T00:00:00Z',updated_at:'2026-11-20T01:00:00Z',sla_id:'1',sla_phase:'official',sla_name:'SLA Cao v1',sla_state:'Quá hạn',response_due:'2026-09-01T01:00:00Z',resolution_due:'2026-09-02T01:00:00Z',first_response_at:null,resolved_at:null});
async function auth(page:Page,role:string){
  await page.route('**/api/v1/auth/**',async route=>route.fulfill({json:route.request().url().endsWith('/csrf')?{csrf_token:'fixture-csrf'}:{user:{id:'77',name:'Tài khoản fixture',email:'fixture@example.invalid',role,role_label:role==='manager'?'Quản lý':'Nhân viên hỗ trợ'}}}));
}
for(const theme of ['light','dark'])test(`urgent dashboard · ${theme}`,async({page},info)=>{
  await page.addInitScript(t=>localStorage.setItem('helpdesk-theme',t),theme);await auth(page,'manager');
  let rows=Array.from({length:6},(_,i)=>({...ticket(String(i+1)),pending_escalation:request(String(i+1))}));
  const commands:{path:string;body:any}[]=[],queries:URLSearchParams[]=[];
  await page.route('**/api/v1/manager/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1/manager',''),method=req.method();let value:unknown={};
    if(path==='/overview')value={total:2,waiting:0,processing:2,paused:0,resolved:0,closed:0,overdue:1,users:3,groups:2,segments:[{code:'processing',count:2}],workload:[],by_status:[],by_group:[],by_type:[],by_priority:[],by_week:[],by_month:[],period_start:'2026-11-20',period_end:'2026-11-20',escalation_available:true,pending_escalations:rows.length};
    else if(path==='/reports/analytics')value={metrics:{response_samples:0,resolution_on_time:0,resolution_late:0,rating_count:0,rating_avg:null,response_avg:null}};
    else if(path==='/tickets'){
      queries.push(url.searchParams);const p=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('page_size'));
      value={items:rows.slice((p-1)*size,p*size),total:rows.length,page:p,page_size:size};
    }else if(path==='/groups')value={items:[{id:'1',name:'Bảo hành',active:true},{id:'2',name:'Chuyên môn khác',active:true}],total:2,page:1,page_size:100};
    else if(path.endsWith('/eligible-employees'))value=[{id:'88',name:'Người nhận fixture',workload:0}];
    else if(/^\/tickets\/\d+$/.test(path)){
      const id=path.split('/').at(-1)!;
      value={...ticket(id),customer:{id:'10',name:'Khách fixture'},assignment_id:'a1',assignments:[],history:[],messages:[],attachments:[],escalation_available:true,escalations:rows.filter(r=>r.id===id).map(r=>r.pending_escalation)};
    }else if(path.endsWith('/assignment')||path.endsWith('/reject')){
      commands.push({path,body:req.postDataJSON()});const id=path.split('/')[2];rows=rows.filter(r=>r.id!==id);value={...ticket(id),message:'Đã xử lý'};
    }else if(path.endsWith('/conversation'))value={ticket_id:'1',status:'DANG_XU_LY',status_label:'Đang xử lý',assigned_id:'88',assigned_to:'Người nhận fixture',group_id:'2',can_send:false,can_view_internal:true,messages:[],events:[],attachments:[],has_older:false,has_more:false};
    else throw Error(path);
    await route.fulfill({json:value});
  });
  await page.goto('/manager');
  await expect(page.getByText('Chờ điều phối khẩn: 6')).toBeVisible();
  await expect(page.locator('.furni-table th')).toHaveCount(7);
  await expect(page.getByText('Xem / Phân công lại',{exact:true})).toHaveCount(0);
  const scope=page.getByRole('combobox',{name:'Phạm vi điều phối'});
  await scope.selectOption('urgent');
  await expect.poll(()=>queries.at(-1)?.get('urgent_only')).toBe('true');
  expect(queries.at(-1)?.has('from')).toBe(false);
  const pagination=page.getByRole('navigation',{name:'Phân trang phiếu'});
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 6 phiếu');
  await pagination.getByRole('button',{name:'Sau',exact:true}).click();await expect(pagination).toContainText('Hiển thị 6–6 trên tổng 6 phiếu');
  await pagination.getByRole('button',{name:'Trước',exact:true}).click();
  await page.locator('tr[aria-label="Mở phiếu #HT-1"]').getByRole('button',{name:'Phân công lại',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Phân công lại phiếu',exact:true});await expect(dialog).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/manager');
  await expect(dialog).toContainText('Cần chuyên môn khác cho phiếu 1');
  await expect(dialog.locator('option[value="QUEUE"]')).toHaveCount(0);
  await dialog.getByRole('combobox',{name:'Nhóm đích'}).selectOption('2');
  await dialog.getByRole('combobox',{name:'Phương án nhận phiếu'}).selectOption('88');
  await dialog.getByRole('textbox',{name:'Lý do điều phối'}).fill('Giao chuyên môn khác');
  await page.screenshot({path:`test-results/escalation-dialog-${info.project.name}-${theme}.png`,fullPage:true});
  await dialog.getByRole('button',{name:'Xác nhận phân công lại'}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Chờ điều phối khẩn: 5')).toBeVisible();expect(commands[0].body.expected_escalation_id).toBe('e1');
  expect(commands[0].body).not.toHaveProperty('priority_id');expect(commands[0].body).not.toHaveProperty('sla_id');
  await page.locator('tr[aria-label="Mở phiếu #HT-2"]').getByRole('button',{name:'Xem điều phối phiếu 2'}).click();
  await dialog.getByRole('combobox',{name:'Xử lý yêu cầu điều phối'}).selectOption('reject');
  await dialog.getByRole('textbox',{name:'Lý do từ chối'}).fill('Tiếp tục xử lý trong nhóm');
  await dialog.getByRole('button',{name:'Xác nhận từ chối điều phối'}).click();await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Chờ điều phối khẩn: 4')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/escalation-dashboard-${info.project.name}-${theme}.png`,fullPage:true});
  await page.locator('tr[aria-label="Mở phiếu #HT-3"]').focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/manager\/tickets\/3$/);
});

for(const theme of ['light','dark'])test(`staff escalation · ${theme}`,async({page},info)=>{
  await page.addInitScript(t=>localStorage.setItem('helpdesk-theme',t),theme);await auth(page,'staff');
  let items:any[]=[],denied=false;const commands:any[]=[];
  await page.route('**/api/v1/staff/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname.replace('/api/v1/staff','');let value:unknown={};
    if(path==='/tickets/1'&&denied){await route.fulfill({status:404,json:{detail:'Không còn quyền xem phiếu.'}});return;}
    if(path==='/attachment-policy')value={max_bytes:5242880,max_files:20,extensions:['.jpg','.pdf']};
    else if(path==='/tickets/1')value={...ticket('1'),customer:{id:'10',name:'Khách fixture'},can_process:true,routing_warning:null,assignment_id:'a1',escalation_available:true,escalations:items};
    else if(path==='/tickets/1/escalations'){
      if(req.method()==='POST'){
        commands.push(req.postDataJSON());await new Promise(r=>setTimeout(r,150));items=[request('1')];value=items[0];
        await route.fulfill({status:201,json:value});return;
      }value=items;
    }else if(path.includes('/conversation'))value={ticket_id:'1',status:'DANG_XU_LY',status_label:'Đang xử lý',assigned_id:'77',assigned_to:'Nhân viên fixture',group_id:'1',can_send:false,can_view_internal:true,messages:[],events:[],attachments:[],has_older:false,has_more:false};
    else throw Error(path);
    await route.fulfill({json:value});
  });
  await page.goto('/staff/tickets/1');
  await page.getByRole('button',{name:'Chuyển khẩn lên Quản lý',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Chuyển phiếu khẩn lên Quản lý',exact:true});
  await dialog.getByRole('textbox',{name:'Lý do cần điều phối'}).fill(' ');
  await dialog.getByRole('button',{name:'Xác nhận chuyển khẩn'}).click();await expect(dialog.getByRole('alert')).toContainText('mô tả cụ thể');
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Chuyển khẩn lên Quản lý',exact:true}).click();
  await dialog.getByRole('textbox',{name:'Lý do cần điều phối'}).fill('Cần chuyên môn kết cấu sofa');
  await dialog.getByRole('button',{name:'Xác nhận chuyển khẩn'}).click();
  await expect(dialog).not.toBeVisible();await expect(page.getByText('Đang chờ Quản lý điều phối',{exact:true})).toBeVisible();
  expect(commands).toHaveLength(1);await expect(page.getByRole('button',{name:'Chuyển khẩn lên Quản lý',exact:true})).toHaveCount(0);
  await page.screenshot({path:`test-results/escalation-staff-${info.project.name}-${theme}.png`,fullPage:true});
  items=[{...items[0],status:'DA_DIEU_PHOI',outcome:'Đã giao nhóm chuyên môn khác',assigned_to:'Nhân viên mới',assigned_id:'88',handled_at:'2026-11-20T02:00:00Z',manager:'Quản lý fixture'}];denied=true;
  await page.reload();await expect(page.getByRole('heading',{name:'Kết quả điều phối #HT-1'})).toBeVisible();
  await expect(page.getByText('Người nhận khi điều phối: Nhân viên mới')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
