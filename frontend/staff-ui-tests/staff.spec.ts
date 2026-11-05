import { test,expect,type Page } from '@playwright/test';
type Role='staff'|'customer'|'manager';
const statuses=['MOI','DANG_XU_LY','TAM_DUNG','DA_GIAI_QUYET','DA_DONG','DA_HUY'];
const labels=['Mới','Đang xử lý','Tạm dừng','Đã giải quyết','Đã đóng','Đã hủy'];
function ticket(index:number,scope:string,search=''){
 const code=scope==='queue'?'MOI':statuses[index%statuses.length];
 return {id:String(1000+index),title:`${search||scope} · Phiếu ${index+1}`,description:'Dữ liệu kiểm thử giao diện cô lập',type_id:'6',type_name:'Bảo hành sản phẩm',status:code,status_label:labels[statuses.indexOf(code)],priority:'Trung bình',priority_id:'2',created_at:'2026-11-02T08:00:00+07:00',updated_at:'2026-11-02T08:00:00+07:00',closed_at:null,group_id:'2',group_name:'Bảo hành và bảo trì',assigned_id:scope==='queue'?null:'77',assigned_to:scope==='queue'?null:'Nhân viên giao diện',recommended:scope==='queue'&&index===0,sla_name:null,response_due:null,resolution_due:null,first_response_at:null,resolved_at:null,sla_state:'Chưa cấu hình SLA'};
}
async function fixtures(page:Page,role:Role='staff',options:{mineTotal?:number;denyView?:boolean;uploadError?:boolean}={}){
 const calls:{method:string;url:URL;body:unknown;csrf:string|undefined}[]=[];let conflict=false;let failCreate=false;const accepted=new Set<string>();
 await page.route('**/api/v1/**',async route=>{
  const request=route.request();const url=new URL(request.url());const method=request.method();
  calls.push({method,url,body:request.headers()['content-type']?.includes('application/json')?request.postDataJSON():request.postData(),csrf:request.headers()['x-csrf-token']});
  let body:unknown;let status=200;
  if(url.pathname==='/api/v1/auth/me')body={user:{id:'77',name:'Nhân viên giao diện',email:'staff-layout@example.invalid',role,role_label:role==='staff'?'Nhân viên hỗ trợ':role==='manager'?'Quản lý':'Khách hàng'},csrf_token:null};
  else if(url.pathname==='/api/v1/auth/csrf')body={csrf_token:'ui-fixture-only-csrf'};
  else if(url.pathname==='/api/v1/auth/logout')status=204;
  else if(url.pathname==='/api/v1/staff/overview')body={assigned:17,queue:12,recommended:3,team:25,unrouted:0,groups:2,overdue:2};
  else if(url.pathname==='/api/v1/staff/ticket-types')body=[{id:'6',name:'Bảo hành sản phẩm'}];
  else if(url.pathname==='/api/v1/staff/ticket-statuses')body=statuses.map((code,i)=>({id:String(i+1),code,name:labels[i]}));
  else if(url.pathname==='/api/v1/staff/priorities')body=[{id:'2',name:'Trung bình'}];
  else if(url.pathname==='/api/v1/staff/attachment-policy')body={max_bytes:5242880,max_files:20,extensions:['.txt','.png','.jpg','.pdf']};
  else if(url.pathname==='/api/v1/staff/customers'){
   const query=url.searchParams.get('search');if(query==='old')await new Promise(r=>setTimeout(r,350));
   body=query==='empty'?[]:[{id:'111',name:'Khách hàng hợp lệ'}];
  }
  else if(url.pathname==='/api/v1/staff/tickets'&&method==='POST'){
   await new Promise(r=>setTimeout(r,100));if(failCreate){failCreate=false;status=503;body={detail:'Dịch vụ tạm thời không sẵn sàng. Vui lòng thử lại.'}}else{status=201;body={id:'9001',message:'Đã lập phiếu mới thay khách hàng. Phiếu đang chờ tiếp nhận; chưa phân công.'}}
  }
  else if(url.pathname==='/api/v1/staff/tickets/9001/attachments'&&method==='POST'){
   if(options.uploadError){status=415;body={detail:'Nội dung tệp không hợp lệ.'}}else{status=201;body={id:'88',name:'fixture.txt'}}
  }
  else if(url.pathname==='/api/v1/staff/tickets/9001'){
   if(options.denyView){status=404;body={detail:'Không tìm thấy phiếu.'}}else body={id:'9001'};
  }
  else if(url.pathname==='/api/v1/staff/tickets'){
   const scope=url.searchParams.get('scope')||'queue';const search=url.searchParams.get('search')||'';const p=Number(url.searchParams.get('page')||1);
   if(search==='old')await new Promise(r=>setTimeout(r,350));
   const size=Number(url.searchParams.get('page_size')||10);const total=scope==='mine'?(options.mineTotal??12):25;
   body={items:Array.from({length:Math.max(0,Math.min(size,total-(p-1)*size))},(_,i)=>ticket(i+(p-1)*size,scope,search)).filter(t=>!accepted.has(t.id)),total:total-accepted.size,page:p,page_size:size};
  }
  else if(/^\/api\/v1\/staff\/tickets\/\d+\/accept$/.test(url.pathname)&&method==='POST'){
   const id=url.pathname.split('/').at(-2)!;
   if(conflict){status=409;body={detail:'Phiếu vừa được tiếp nhận. Vui lòng làm mới.'}}else{accepted.add(id);body=ticket(0,'mine')}
  }
  else if(url.pathname==='/api/v1/customer/overview')body={total:0,active:0,resolved:0,closed:0};
  else if(url.pathname==='/api/v1/customer/tickets')body={items:[],total:0,page:1,page_size:10};
  else if(url.pathname==='/api/v1/manager/overview')body={total:0,waiting:0,processing:0,paused:0,resolved:0,closed:0,overdue:0,users:0,groups:0,by_status:[],by_group:[],by_type:[],by_priority:[]};
  else throw new Error('Unexpected API in UI-only fixture: '+url.pathname);
  await route.fulfill({status,contentType:'application/json',...(status===204?{}:{body:JSON.stringify(body)})});
 });
 return {calls,setConflict:()=>{conflict=true},failCreateOnce:()=>{failCreate=true}};
}

for(const theme of ['light','dark'])for(const path of ['/staff','/staff/queue','/staff/mine']){
 test(`${path} · ${theme}: layout, styles, menus and API contract`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(mode=>localStorage.setItem('helpdesk-theme',mode),theme);const {calls}=await fixtures(page);await page.goto(path);
  const sidebar=page.locator('.sidebar');await expect(sidebar.getByRole('link',{name:'Yêu cầu chờ tiếp nhận',exact:true})).toBeVisible();await expect(sidebar.getByRole('link',{name:'Đề xuất cho bạn',exact:true})).toHaveCount(0);await expect(sidebar.getByRole('link',{name:'Phiếu trong nhóm',exact:true})).toHaveCount(0);
  if(path==='/staff'){
   await expect(page.getByRole('button',{name:'Làm mới',exact:true})).toHaveCount(0);await expect(page.locator('.staff-stat-assigned h2')).toHaveText('17');await expect(page.locator('.staff-stat-queue h2')).toHaveText('12');await expect(page.locator('.staff-stat-overdue h2')).toHaveText('2');await expect(page.locator('.staff-stat-queue small')).toContainText('3 phiếu ưu tiên');
   const account=(await page.locator('.staff-account-panel').boundingBox())!;const stats=(await page.locator('.staff-stats-grid').boundingBox())!;expect(account.y+account.height).toBeLessThanOrEqual(stats.y);
   const backgrounds=await page.locator('.staff-stat').evaluateAll(items=>items.map(e=>getComputedStyle(e).backgroundColor));expect(new Set(backgrounds).size).toBe(3);
  }else{
   await expect(page.locator('.ticket-table tbody tr')).toHaveCount(path.endsWith('mine')?5:10);const panel=page.locator('.staff-ticket-panel');await expect(panel.locator('.staff-pagination')).toBeVisible();const scroller=page.locator('.staff-ticket-scroll');const height=(await scroller.boundingBox())!.height;expect(height).toBeGreaterThanOrEqual(330);if(path.endsWith('queue')){expect(await scroller.evaluate(e=>e.scrollHeight>e.clientHeight)).toBeTruthy();await scroller.hover();await page.mouse.wheel(0,450);await expect.poll(()=>scroller.evaluate(e=>e.scrollTop)).toBeGreaterThan(0)}else expect(await scroller.evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(1);await expect(panel.getByRole('button',{name:'Sau',exact:true})).toBeVisible();
   if(path.endsWith('queue'))await expect(page.getByText('Ưu tiên cho bạn',{exact:true})).toHaveCount(1);
   else{
    expect(new Set(await page.locator('.staff-status-badge').evaluateAll(items=>items.map(e=>getComputedStyle(e).backgroundColor))).size).toBe(5);
    expect(await page.locator('.staff-view-button').first().evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(await page.getByRole('button',{name:'Lọc phiếu',exact:true}).evaluate(e=>getComputedStyle(e).backgroundColor));
    await page.locator('.staff-pagination').getByRole('button',{name:'Sau',exact:true}).click();await expect(page.locator('.staff-pagination')).toContainText('Trang 2');await expect(page.locator('.ticket-table tbody tr').first()).toContainText('Phiếu 6');expect(Math.abs((await scroller.boundingBox())!.height-height)).toBeLessThan(1);
   }
   expect(calls.some(c=>c.url.pathname==='/api/v1/staff/tickets'&&c.url.searchParams.get('scope')===(path.endsWith('mine')?'mine':'queue'))).toBeTruthy();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`test-results/staff-ui-${path.split('/').at(-1)}-${theme}-${info.project.name}.png`,fullPage:true});
 });
}

test('redirects, reset filters, stale fetch isolation, acceptance and visible409',async({page})=>{
 const {calls,setConflict}=await fixtures(page);await page.goto('/staff/recommended');await expect(page).toHaveURL('/staff/queue');await expect(page.locator('.ticket-table tbody tr')).toHaveCount(10);
 const form=page.locator('.staff-filter-panel');await page.getByLabel('Mã hoặc tiêu đề').fill('sofa');await page.getByRole('combobox',{name:'Loại hỗ trợ',exact:true}).selectOption('6');await page.getByRole('combobox',{name:'Trạng thái',exact:true}).selectOption('MOI');await page.getByRole('combobox',{name:'Ưu tiên',exact:true}).selectOption('2');await page.getByLabel('Từ ngày').fill('2026-11-01');await page.getByLabel('Đến ngày').fill('2026-11-02');await page.getByRole('button',{name:'Lọc phiếu',exact:true}).click();await expect(page.locator('.ticket-table tbody tr').first()).toContainText('sofa');
 const filtered=calls.filter(c=>c.url.searchParams.get('search')==='sofa').at(-1)!.url.searchParams;for(const [k,v] of Object.entries({type:'6',status:'MOI',priority:'2',from:'2026-11-01',to:'2026-11-02',page:'1',scope:'queue'}))expect(filtered.get(k)).toBe(v);
 await page.locator('.sidebar').getByRole('link',{name:'Phiếu của tôi',exact:true}).click();await expect(page.getByLabel('Mã hoặc tiêu đề')).toHaveValue('');await expect(page.locator('.ticket-table tbody tr').first()).toContainText('mine');
 await page.goto('/staff/team');await expect(page).toHaveURL('/staff/mine');await page.goto('/staff/queue');await expect(page.locator('.ticket-table tbody tr')).toHaveCount(10);
 // Deliberately overlap actual form loads; response for "old" must not overwrite "fresh".
 await page.getByLabel('Mã hoặc tiêu đề').fill('old');const oldResponse=page.waitForResponse(r=>r.url().includes('search=old'));await form.evaluate(e=>(e as HTMLFormElement).requestSubmit());await page.getByLabel('Mã hoặc tiêu đề').fill('fresh');await form.evaluate(e=>(e as HTMLFormElement).requestSubmit());await expect(page.locator('.ticket-table tbody tr').first()).toContainText('fresh');await oldResponse;await expect(page.locator('.ticket-table tbody tr').first()).toContainText('fresh');
 await page.locator('.ticket-table tbody tr').first().getByRole('button',{name:'Tiếp nhận',exact:true}).click();await expect(page.locator('.ticket-table tbody tr')).toHaveCount(9);const accept=calls.find(c=>c.method==='POST'&&c.url.pathname.endsWith('/accept'));expect(accept?.csrf).toBe('ui-fixture-only-csrf');
 setConflict();await page.locator('.ticket-table tbody tr').first().getByRole('button',{name:'Tiếp nhận',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Phiếu vừa được tiếp nhận. Vui lòng làm mới.');
});

for(const role of ['customer','manager'] as const)test(`${role}: staff styles do not recolor other dashboards`,async({page},info)=>{
 await fixtures(page,role);await page.goto('/'+role);await expect(page.getByRole('heading',{name:'Thông tin tài khoản',exact:true})).toBeVisible();await expect(page.locator('.staff-dashboard,.staff-stat,.staff-ticket-scroll')).toHaveCount(0);
 for(const theme of ['light','dark']){await page.getByRole('combobox',{name:'Giao diện',exact:true}).selectOption(theme);const bg=await page.locator(role==='manager'?'.manager-chart':'.stat-grid .panel').first().evaluate(e=>getComputedStyle(e).backgroundColor);expect(bg).toBe(theme==='light'?'rgb(255, 255, 255)':'rgb(21, 40, 45)');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()}
 if(info.project.name==='desktop'&&role==='manager')expect((await page.locator('.manager-stats').evaluate(e=>getComputedStyle(e).gridTemplateColumns)).split(' ')).toHaveLength(4);
 if(role==='customer')await expect(page.getByRole('button',{name:'Mở trợ lý AI Helpdesk',exact:true})).toBeVisible();
});

for(const total of [0,6,12])test(`mine pagination: ${total} tickets, backend pages of five and preserved filters`,async({page})=>{
 const {calls}=await fixtures(page,'staff',{mineTotal:total});await page.goto('/staff/mine');await expect(page.locator('.staff-pagination')).toContainText(`${total} phiếu`);
 const next=page.locator('.staff-pagination').getByRole('button',{name:'Sau',exact:true});const previous=page.locator('.staff-pagination').getByRole('button',{name:'Trước',exact:true});await expect(previous).toBeDisabled();
 const seen:string[]=[];const pages=Math.max(1,Math.ceil(total/5));
 for(let p=1;p<=pages;p++){
  await expect(page.locator('.ticket-table tbody tr')).toHaveCount(Math.max(0,Math.min(5,total-(p-1)*5)));await expect(page.locator('.staff-pagination')).toContainText(`Trang ${p}`);await expect(page.locator('.staff-pagination-details>span')).toHaveText(`Trang ${p} / ${pages}`);await expect(page.locator('.staff-pagination-details small')).toHaveText(`Hiển thị ${total?(p-1)*5+1:0}–${Math.min(p*5,total)} trên tổng ${total} phiếu`);
  seen.push(...await page.locator('.ticket-table tbody tr td:first-child>a').allTextContents());
  if(p<pages){await expect(next).toBeEnabled();await next.click()}else await expect(next).toBeDisabled();
 }
 expect(seen.length).toBe(total);expect(new Set(seen).size).toBe(total);
 if(!total)await expect(page.getByText('Chưa có phiếu phù hợp.',{exact:false})).toBeVisible();
 if(total>5){
  await page.getByLabel('Mã hoặc tiêu đề').fill('Sofa');await page.getByRole('button',{name:'Lọc phiếu',exact:true}).click();await expect(page.locator('.staff-pagination')).toContainText('Trang 1');await expect(page.locator('.ticket-table tbody tr').first()).toContainText('Sofa');
  await next.click();await expect(page.locator('.staff-pagination')).toContainText('Trang 2');await expect(page.locator('.ticket-table tbody tr').first()).toContainText('Sofa');
  const last=calls.filter(c=>c.url.pathname==='/api/v1/staff/tickets').at(-1)!.url.searchParams;expect(last.get('page_size')).toBe('5');expect(last.get('search')).toBe('Sofa');expect(last.get('page')).toBe('2');
  await previous.click();await expect(page.locator('.staff-pagination')).toContainText('Trang 1');
 }
 await page.goto('/staff/queue');await expect(page.locator('.ticket-table tbody tr')).toHaveCount(10);expect(calls.filter(c=>c.url.searchParams.get('scope')==='queue').every(c=>!c.url.searchParams.has('page_size'))).toBeTruthy();
});

test('mine footer recomputes total, pages and range from filtered API response',async({page})=>{
 await fixtures(page);
 await page.route('**/api/v1/staff/tickets?**',async route=>{
  const url=new URL(route.request().url());const filtered=!!url.searchParams.get('search');const total=filtered?2:6;const p=Number(url.searchParams.get('page')||1);const size=Number(url.searchParams.get('page_size')||10);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:Array.from({length:Math.max(0,Math.min(size,total-(p-1)*size))},(_,i)=>ticket(i+(p-1)*size,'mine',filtered?'Lọc':'')),page:p,page_size:size,total})});
 });
 await page.goto('/staff/mine');await expect(page.locator('.staff-pagination-details>span')).toHaveText('Trang 1 / 2');await expect(page.locator('.staff-pagination-details small')).toHaveText('Hiển thị 1–5 trên tổng 6 phiếu');
 await page.locator('.staff-pagination').getByRole('button',{name:'Sau',exact:true}).click();await expect(page.locator('.staff-pagination-details>span')).toHaveText('Trang 2 / 2');await expect(page.locator('.staff-pagination-details small')).toHaveText('Hiển thị 6–6 trên tổng 6 phiếu');
 await page.getByLabel('Mã hoặc tiêu đề').fill('Lọc');await page.getByRole('button',{name:'Lọc phiếu',exact:true}).click();await expect(page.locator('.staff-pagination-details>span')).toHaveText('Trang 1 / 1');await expect(page.locator('.staff-pagination-details small')).toHaveText('Hiển thị 1–2 trên tổng 2 phiếu');await expect(page.locator('.staff-pagination').getByRole('button',{name:'Sau',exact:true})).toBeDisabled();
 for(const theme of ['dark','light']){await page.getByRole('combobox',{name:'Giao diện',exact:true}).selectOption(theme);await expect(page.locator('.staff-mine-panel .staff-pagination-details')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()}
});

for(const theme of ['light','dark'])test(`new ticket form: equal panels, lookup/required/error preservation/double-submit · ${theme}`,async({page},info)=>{
 await page.addInitScript(mode=>localStorage.setItem('helpdesk-theme',mode),theme);const {calls,failCreateOnce}=await fixtures(page);await page.goto('/staff/new');
 const submit=page.getByRole('button',{name:'Lập phiếu mới',exact:true});await expect(submit).toBeDisabled();
 const search=page.getByLabel('Tìm khách hàng theo họ tên, email đầy đủ hoặc ID');await search.fill('empty');await search.press('Enter');await expect(page.getByText('Không tìm thấy khách hàng hoạt động phù hợp.',{exact:false})).toBeVisible();await expect(submit).toBeDisabled();
 for(const query of ['Khách','customer@example.invalid','111']){await search.fill(query);await search.press('Enter');await expect(page.getByText('Tìm thấy 1 kết quả',{exact:false})).toBeVisible();expect(calls.filter(c=>c.url.pathname.endsWith('/customers')).at(-1)!.url.searchParams.get('search')).toBe(query)}
 await page.getByRole('combobox',{name:'Khách hàng',exact:true}).selectOption('111');await submit.click();expect(calls.filter(c=>c.method==='POST'&&c.url.pathname==='/api/v1/staff/tickets')).toHaveLength(0);
 await page.getByLabel('Tiêu đề',{exact:true}).fill('   ');await page.getByRole('combobox',{name:'Loại hỗ trợ',exact:true}).selectOption('6');await page.getByRole('combobox',{name:'Mức ưu tiên',exact:true}).selectOption('2');await page.getByLabel('Mô tả chi tiết',{exact:true}).fill('Khách gọi điện yêu cầu kiểm tra sofa.');await submit.click();await expect(page.getByRole('alert')).toContainText('không được để trống');
 await page.getByLabel('Tiêu đề',{exact:true}).fill('Bảo hành sofa qua điện thoại');
 const top=(await page.locator('.staff-new-search').boundingBox())!;const bottom=(await page.locator('.staff-new-form').boundingBox())!;expect(Math.abs(top.x-bottom.x)).toBeLessThan(1);expect(Math.abs(top.width-bottom.width)).toBeLessThan(1);
 const kind=(await page.locator('#staff-new-type').boundingBox())!;const priority=(await page.locator('#staff-new-priority').boundingBox())!;if(info.project.name==='mobile'){expect(Math.abs(kind.x-priority.x)).toBeLessThan(1);expect(priority.y).toBeGreaterThan(kind.y)}else{expect(Math.abs(kind.y-priority.y)).toBeLessThan(1);expect(priority.x).toBeGreaterThan(kind.x+50)};expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`test-results/staff-new-${theme}-${info.project.name}.png`,fullPage:true});
 failCreateOnce();await submit.click();await expect(page.getByRole('alert')).toContainText('Dữ liệu đã nhập được giữ lại');await expect(page.getByLabel('Tiêu đề',{exact:true})).toHaveValue('Bảo hành sofa qua điện thoại');await expect(page.getByRole('combobox',{name:'Khách hàng',exact:true})).toHaveValue('111');
 await page.locator('.staff-new-form').evaluate(e=>{const form=e as HTMLFormElement;form.requestSubmit();form.requestSubmit()});await expect(page.getByRole('status')).toContainText('Đã lập phiếu mới thay khách hàng');await expect(page.getByRole('link',{name:'Xem phiếu vừa lập',exact:true})).toHaveAttribute('href','/staff/tickets/9001');
 const posted=calls.filter(c=>c.method==='POST'&&c.url.pathname==='/api/v1/staff/tickets');expect(posted).toHaveLength(2);expect(posted[1].body).toMatchObject({customer_id:'111',type_id:'6',priority_id:'2',title:'Bảo hành sofa qua điện thoại'});expect(posted[1].csrf).toBe('ui-fixture-only-csrf');expect(JSON.stringify(posted[1].body)).not.toContain('assigned');
});

test('new ticket upload errors keep receipt and unavailable detail link is hidden',async({page})=>{
 const {calls}=await fixtures(page,'staff',{denyView:true,uploadError:true});await page.goto('/staff/new');await page.getByLabel('Tìm khách hàng theo họ tên, email đầy đủ hoặc ID').fill('111');await page.getByRole('button',{name:'Tìm khách hàng',exact:true}).click();await page.getByRole('combobox',{name:'Khách hàng',exact:true}).selectOption('111');await page.getByLabel('Tiêu đề',{exact:true}).fill('Ghi nhận sofa');await page.getByLabel('Mô tả chi tiết',{exact:true}).fill('Khách liên hệ trực tiếp.');await page.getByRole('combobox',{name:'Loại hỗ trợ',exact:true}).selectOption('6');await page.getByRole('combobox',{name:'Mức ưu tiên',exact:true}).selectOption('2');
 await page.locator('#staff-new-file').setInputFiles({name:'too-big.txt',mimeType:'text/plain',buffer:Buffer.alloc(5242881)});await page.getByRole('button',{name:'Lập phiếu mới',exact:true}).click();await expect(page.getByRole('alert')).toContainText('vượt giới hạn');expect(calls.filter(c=>c.method==='POST'&&c.url.pathname==='/api/v1/staff/tickets')).toHaveLength(0);
 await page.locator('#staff-new-file').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture only')});await page.getByRole('button',{name:'Lập phiếu mới',exact:true}).click();await expect(page.getByRole('status')).toContainText('#HT-9001');await expect(page.getByRole('alert')).toContainText('Phiếu đã tạo, tệp chưa tải lên');await expect(page.getByRole('link',{name:'Xem phiếu vừa lập',exact:true})).toHaveCount(0);expect(calls.filter(c=>c.method==='POST'&&c.url.pathname==='/api/v1/staff/tickets')).toHaveLength(1);
});

test('staff mine panel reserves five rows on desktop and grows for long titles', async ({ page }, testInfo) => {
  await fixtures(page, 'staff', { mineTotal: 7 });
  await page.route('**/api/v1/staff/tickets?*', async route => {
    const current = Number(new URL(route.request().url()).searchParams.get('page'));
    const items = current === 1
      ? Array.from({ length: 5 }, (_, i) => ticket(i, 'mine'))
      : current === 2 ? [ticket(5, 'mine')] : [{ ...ticket(6, 'mine'), title: 'Tiêu đề rất dài '.repeat(13) }];
    await route.fulfill({ json: { items, total: current === 2 ? 6 : 7, page: current, page_size: 5 } });
  });
  await page.goto('/staff/mine');
  const panel = page.locator('.staff-mine-panel');
  const rows = panel.locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const fullHeight = (await panel.boundingBox())!.height;
  await panel.getByRole('button', { name: 'Sau', exact: true }).click();
  await expect(rows).toHaveCount(1);
  const shortHeight = (await panel.boundingBox())!.height;
  if (testInfo.project.name === 'desktop') expect(Math.abs(fullHeight - shortHeight)).toBeLessThanOrEqual(1);
  else expect(shortHeight).toBeLessThan(fullHeight);
  await page.route('**/api/v1/staff/tickets?*', route => route.fulfill({ json: {
    items: Array.from({ length: 5 }, (_, i) => ({ ...ticket(i, 'mine'), title: 'Tiêu đề rất dài '.repeat(13) })),
    total: 5, page: 1, page_size: 5,
  } }));
  await panel.getByRole('button', { name: 'Trước', exact: true }).click();
  await expect(rows).toHaveCount(5);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(fullHeight);
  expect(await panel.locator('.staff-ticket-scroll').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
});

test('customer overview and history use server pages, preserve filters and keep links working', async ({ page }, testInfo) => {
  await fixtures(page, 'customer');
  const calls: URLSearchParams[] = [];
  const session = { id: '1', ticket_id: '1000', created_at: ticket(0, 'mine').created_at };
  await page.route('**/api/v1/customer/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1/customer', '');
    const params = url.searchParams;
    if (path === '/tickets' && route.request().method() === 'POST') return route.fulfill({ json: ticket(0, 'customer') });
    if (path === '/tickets') {
      calls.push(params);
      const size = Number(params.get('page_size') || 10);
      const current = Number(params.get('page') || 1);
      const total = params.get('search') === 'Trống' ? 0 : params.get('search') === '12 phiếu' ? 12 :
        params.has('type') ? 6 : params.get('search') === 'Ít phiếu' ? 2 : params.has('page') ? 6 : 30;
      const count = Math.max(0, Math.min(size, total - (current - 1) * size));
      return route.fulfill({ json: { items: Array.from({ length: count }, (_, i) =>
        ticket(i + (current - 1) * size, 'customer')), total, page: current, page_size: size } });
    }
    if (path === '/overview') return route.fulfill({ json: { total: 30, active: 10, resolved: 10, closed: 10 } });
    if (path === '/ticket-types') return route.fulfill({ json: [{ id: '6', name: 'Bảo hành sản phẩm' }] });
    if (path === '/ticket-statuses') return route.fulfill({ json: statuses.map((code, i) => ({ id: String(i + 1), code, name: labels[i] })) });
    if (path === '/attachment-policy') return route.fulfill({ json: { max_bytes: 5242880, extensions: ['.txt'] } });
    if (path === '/tickets/1000') return route.fulfill({ json: { ...ticket(0, 'customer'), history: [], attachments: [], rating: null } });
    if (path === '/tickets/1000/conversation') return route.fulfill({ json: { messages: [], attachments: [], events: [], has_older: false } });
    if (path === '/chatbot/sessions') return route.fulfill({ json: { items: [session], total: 1, page: 1 } });
    if (path === '/chatbot/sessions/1') return route.fulfill({ json: { session, messages: [], has_older: false } });
    return route.fallback();
  });
  await page.goto('/customer');
  const sidebar = page.getByRole('navigation', { name: 'Không gian Khách hàng' });
  await expect(sidebar.getByRole('link')).toHaveText(['Tổng quan', 'Tạo phiếu hỗ trợ', 'Lịch sử yêu cầu', 'Thông tin cá nhân']);
  await expect(page.locator('.ticket-table tbody tr')).toHaveCount(5);
  await expect(page.getByText('Thông tin tài khoản')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Chuyển trang danh sách phiếu' })).toHaveCount(0);
  expect(calls.at(-1)?.get('page_size')).toBe('5');
  await page.getByRole('link', { name: /Xem tất cả/ }).click();
  await expect(page.getByRole('heading', { name: 'Lịch sử yêu cầu' })).toBeVisible();

  await page.goto('/customer/tickets?history=1&type=6&page=1');
  const panel = page.locator('.customer-history-panel');
  const rows = panel.locator('tbody tr');
  const pagination = panel.getByRole('navigation');
  await expect(rows).toHaveCount(5);
  await expect(page.getByLabel('Loại hỗ trợ')).toHaveValue('6');
  await expect(sidebar.getByRole('link', { name: 'Lịch sử yêu cầu' })).toHaveAttribute('aria-current', 'page');
  await expect(pagination).toContainText('Trang 1 / 2');
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 6 phiếu');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const fullHeight = (await panel.boundingBox())!.height;
  await pagination.getByRole('button', { name: 'Sau', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText('Trang 2 / 2');
  await expect(pagination).toContainText('Hiển thị 6–6 trên tổng 6 phiếu');
  expect(calls.at(-1)?.get('type')).toBe('6');
  expect(calls.at(-1)?.has('history')).toBe(false);
  const shortHeight = (await panel.boundingBox())!.height;
  if (testInfo.project.name === 'desktop') expect(Math.abs(fullHeight - shortHeight)).toBeLessThanOrEqual(1);
  else expect(shortHeight).toBeLessThan(fullHeight);
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Giao diện' }).selectOption(theme);
    await expect(pagination).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  }
  await page.getByRole('button', { name: 'Xóa lọc' }).click();
  await expect(page.getByLabel('Loại hỗ trợ')).toHaveValue('');
  await page.getByLabel('Tiêu đề phiếu').fill('12 phiếu');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(pagination).toContainText('Trang 1 / 3');
  await expect(rows).toHaveCount(5);
  await pagination.getByRole('button', { name: 'Sau', exact: true }).click();
  await expect(pagination).toContainText('Trang 2 / 3');
  await expect(rows).toHaveCount(5);
  await pagination.getByRole('button', { name: 'Sau', exact: true }).click();
  await expect(pagination).toContainText('Hiển thị 11–12 trên tổng 12 phiếu');
  await expect(rows).toHaveCount(2);
  expect(calls.at(-1)?.get('search')).toBe('12 phiếu');

  await page.goto('/customer/tickets?search=%C3%8Dt+phi%E1%BA%BFu&page=8');
  await expect(pagination).toContainText('Hiển thị 1–2 trên tổng 2 phiếu');
  await expect(page).toHaveURL(/page=1$/);
  await page.getByLabel('Tiêu đề phiếu').fill('Trống');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(page.getByText('Chưa có phiếu phù hợp')).toBeVisible();
  await expect(pagination).toContainText('Hiển thị 0 trên tổng 0 phiếu');
  await expect(pagination.getByRole('button', { name: 'Sau' })).toBeDisabled();

  await sidebar.getByRole('link', { name: 'Tạo phiếu hỗ trợ' }).click();
  await expect(sidebar.locator('[aria-current=page]')).toHaveText('Tạo phiếu hỗ trợ');
  await page.getByLabel('Tiêu đề', { exact: true }).fill('Kiểm tra điều hướng');
  await page.getByLabel('Loại hỗ trợ').selectOption('6');
  await page.getByLabel('Mô tả chi tiết').fill('Nội dung thử bằng fixture');
  await page.getByRole('button', { name: 'Gửi yêu cầu hỗ trợ' }).click();
  await expect(page).toHaveURL(/\/customer\/tickets\/1000$/);
  await page.getByRole('link', { name: '← Lịch sử yêu cầu' }).click();
  await expect(page.getByRole('heading', { name: 'Lịch sử yêu cầu' })).toBeVisible();
  await page.getByRole('button', { name: 'Mở trợ lý AI Helpdesk' }).click();
  await page.getByRole('link', { name: 'Xem chi tiết phiếu' }).click();
  await expect(page).toHaveURL(/\/customer\/tickets\/1000$/);
});

test('manager account and group pagination, filters and stale status confirmation', async ({ page }, testInfo) => {
  await fixtures(page, 'manager');
  const version = '2026-11-05T10:00:00.000001Z';
  const accounts = Array.from({ length: 13 }, (_, index) => ({
    id: String(100 + index), name: `Tài khoản ${index + 1}`, email: `staff-${index + 1}@example.invalid`,
    role: index < 6 ? 'NHAN_VIEN' : 'KHACH_HANG', role_label: index < 6 ? 'Nhân viên hỗ trợ' : 'Khách hàng',
    phone: null, status: 'HOAT_DONG', updated_at: version,
  }));
  const requests: URLSearchParams[] = [];
  const patches: Record<string, string>[] = [];
  await page.route(/\/api\/v1\/manager\/users(?:\/105|\?|$)/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith('/105')) {
      const target = accounts[5];
      if (req.method() === 'GET') return route.fulfill({ json: target });
      const body = req.postDataJSON();
      patches.push(body);
      if (patches.length === 1) {
        target.updated_at = '2026-11-05T10:00:00.000002Z';
        target.name = 'Tài khoản 6 đã đổi tên';
        return route.fulfill({ status: 409, json: { detail: 'Dữ liệu đã thay đổi.' } });
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      target.status = body.status;
      return route.fulfill({ json: target });
    }
    const params = url.searchParams;
    requests.push(params);
    const pageIndex = Number(params.get('page'));
    const size = Number(params.get('page_size'));
    const items = accounts.filter(account =>
      (!params.get('search') || account.name.includes(params.get('search')!)) &&
      (!params.get('role') || account.role === params.get('role')) &&
      (!params.get('status') || account.status === params.get('status')));
    return route.fulfill({ json: { items: items.slice((pageIndex - 1) * size, pageIndex * size), total: items.length, page: pageIndex, page_size: size } });
  });
  await page.route('**/api/v1/manager/groups?*', async route => {
    const current = Number(new URL(route.request().url()).searchParams.get('page'));
    await route.fulfill({ json: {
      items: Array.from({ length: current === 1 ? 20 : 1 }, (_, i) => ({
        id: String(i + current * 20), name: `Nhóm ${i + 1}`, description: null, members: 0, pending: 0, active: true,
      })), total: 21, page: current, page_size: 20,
    } });
  });

  await page.goto('/manager/users');
  const panel = page.getByRole('region', { name: 'Danh sách tài khoản' });
  const pagination = panel.getByRole('navigation');
  const rows = panel.locator('tbody tr');
  const next = pagination.getByRole('button', { name: 'Sau' });
  const previous = pagination.getByRole('button', { name: 'Trước' });
  await expect(rows).toHaveCount(5);
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 13 tài khoản');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const full = (await panel.boundingBox())!.height;
  await next.click();
  await expect(pagination).toContainText('Trang 2 / 3');
  await expect(rows).toHaveCount(5);
  await next.click();
  await expect(pagination).toContainText('Hiển thị 11–13 trên tổng 13 tài khoản');
  await expect(rows).toHaveCount(3);
  await expect(next).toBeDisabled();
  if (testInfo.project.name === 'desktop') {
    expect(Math.abs((await panel.boundingBox())!.height - full)).toBeLessThanOrEqual(1);
    const filter = page.locator('.manager-users-filter');
    const bottoms = await filter.locator('input, select, button').evaluateAll(fields => fields.map(field => field.getBoundingClientRect().bottom));
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(1);
  }
  await page.getByLabel('Tên, email hoặc ID').fill('Tài khoản');
  await page.getByRole('combobox', { name: 'Vai trò', exact: true }).selectOption('NHAN_VIEN');
  await page.getByLabel('Trạng thái tài khoản').selectOption('HOAT_DONG');
  await page.getByRole('button', { name: 'Lọc tài khoản' }).click();
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 6 tài khoản');
  await next.click();
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText('Hiển thị 6–6 trên tổng 6 tài khoản');
  expect(Object.fromEntries(requests.at(-1)!)).toMatchObject({ page: '2', page_size: '5', search: 'Tài khoản', role: 'NHAN_VIEN', status: 'HOAT_DONG' });

  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Giao diện' }).selectOption(theme);
    await rows.getByRole('button', { name: /^Khóa tài khoản/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    await page.getByRole('dialog').getByRole('button', { name: 'Hủy' }).click();
  }
  expect(patches).toHaveLength(0);
  await rows.getByRole('button', { name: /^Khóa tài khoản/ }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Xác nhận khóa' });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText('Dữ liệu đã thay đổi.');
  await expect(dialog.getByText('Tài khoản 6 đã đổi tên', { exact: true })).toBeVisible();
  await confirm.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(dialog).toHaveCount(0);
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 5 tài khoản');
  await expect(previous).toBeDisabled();
  expect(patches).toEqual([
    { name: 'Tài khoản 6', phone: null, status: 'KHOA', expected_updated_at: version },
    { name: 'Tài khoản 6 đã đổi tên', phone: null, status: 'KHOA', expected_updated_at: accounts[5].updated_at },
  ]);
  await page.getByLabel('Tên, email hoặc ID').fill('Không có kết quả');
  await page.getByRole('button', { name: 'Lọc tài khoản' }).click();
  await expect(panel.getByText('Không có tài khoản phù hợp.')).toBeVisible();
  await expect(pagination).toContainText('Hiển thị 0 trên tổng 0 tài khoản');

  await page.goto('/manager/groups');
  const groups = page.getByRole('region', { name: 'Danh sách nhóm hỗ trợ' });
  const groupPages = groups.getByRole('navigation');
  await expect(groupPages).toContainText('Hiển thị 1–20 trên tổng 21 nhóm');
  await groupPages.getByRole('button', { name: 'Sau' }).click();
  await expect(groups.locator('tbody tr')).toHaveCount(1);
  await expect(groupPages).toContainText('Trang 2 / 2');
  await expect(groupPages).toContainText('Hiển thị 21–21 trên tổng 21 nhóm');
});

test('manager monitoring retains advanced filters and paginates five tickets', async ({ page }, testInfo) => {
  await fixtures(page, 'manager');
  const calls: URLSearchParams[] = [];
  await page.route(/\/api\/v1\/manager\/(catalog\/(types|priorities|statuses)|groups\?|tickets\?)/, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/types')) return route.fulfill({ json: [{ id: '6', name: 'Bảo hành' }] });
    if (url.pathname.endsWith('/priorities')) return route.fulfill({ json: [{ id: '2', name: 'Trung bình' }] });
    if (url.pathname.endsWith('/statuses')) return route.fulfill({ json: statuses.map((code, i) => ({ id: String(i + 1), code, name: labels[i] })) });
    if (url.pathname.endsWith('/groups')) return route.fulfill({ json: { items: [], total: 0, page: 1, page_size: 100 } });
    const query = url.searchParams;
    calls.push(query);
    const current = Number(query.get('page'));
    const size = Number(query.get('page_size'));
    const total = query.get('search') === 'rỗng' ? 0 : query.has('priority') ? 6 : 12;
    const count = Math.max(0, Math.min(size, total - (current - 1) * size));
    return route.fulfill({ json: { items: Array.from({ length: count }, (_, i) =>
      ticket(i + (current - 1) * size, 'mine')), total, page: current, page_size: size } });
  });

  await page.goto('/manager/tickets');
  const panel = page.getByRole('region', { name: 'Danh sách giám sát phiếu' });
  const rows = panel.locator('tbody tr');
  const pagination = panel.getByRole('navigation');
  const next = pagination.getByRole('button', { name: 'Sau' });
  const advanced = page.getByRole('button', { name: /Bộ lọc nâng cao/ });
  const priority = page.getByRole('combobox', { name: 'Mức ưu tiên' });
  const search = page.getByLabel('Mã hoặc tiêu đề phiếu');
  await expect(priority).toBeHidden();
  await expect(rows).toHaveCount(5);
  await expect(panel.locator('.staff-status-moi')).toHaveText('Mới');
  await expect(panel.locator('.staff-status-dang_xu_ly')).toHaveText('Đang xử lý');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const height = (await panel.boundingBox())!.height;
  await next.click();
  await expect(pagination).toContainText('Trang 2 / 3');
  await expect(rows).toHaveCount(5);
  await next.click();
  await expect(rows).toHaveCount(2);
  await expect(pagination).toContainText('Hiển thị 11–12 trên tổng 12 phiếu');
  if (testInfo.project.name === 'desktop') expect(Math.abs((await panel.boundingBox())!.height - height)).toBeLessThanOrEqual(1);

  await advanced.click();
  await priority.selectOption('2');
  await advanced.click();
  await expect(priority).toBeHidden();
  await page.getByRole('button', { name: 'Lọc dữ liệu' }).click();
  await expect(advanced).toContainText('1 đang áp dụng');
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 6 phiếu');
  await next.click();
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText('Hiển thị 6–6 trên tổng 6 phiếu');
  await advanced.click();
  await expect(priority).toHaveValue('2');
  await search.fill('chưa áp dụng');
  const refresh = page.getByRole('button', { name: 'Làm mới danh sách phiếu' });
  const reload = page.waitForRequest(request => request.url().includes('/api/v1/manager/tickets?'));
  await refresh.click();
  await reload;
  await expect(pagination).toContainText('Trang 2 / 2');
  expect(Object.fromEntries(calls.at(-1)!)).toEqual({ page: '2', page_size: '5', priority: '2' });

  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Giao diện' }).selectOption(theme);
    await expect(panel.locator('.staff-status-da_huy')).toHaveText('Đã hủy');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await search.fill('rỗng');
  await page.getByRole('button', { name: 'Lọc dữ liệu' }).click();
  await expect(panel.getByText('Chưa có phiếu phù hợp.')).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'Xóa lọc' }).click();
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 12 phiếu');
});

test('manager SLA table paginates and referenced policies allow only activation changes', async ({ page }) => {
  await fixtures(page, 'manager');
  const policies = Array.from({ length: 6 }, (_, i) => ({
    id: String(i + 1), name: `Chính sách ${i + 1}`, priority_id: 3, priority: 'Cao',
    response_minutes: 15, resolution_minutes: 120, active: i === 5, referenced: i === 5 ? 2 : 0,
  }));
  let empty = true;
  const writes: unknown[] = [];
  await page.route('**/api/v1/manager/catalog/priorities', route => route.fulfill({ json: [{ id: '3', name: 'Cao' }] }));
  await page.route(/\/api\/v1\/manager\/sla(?:\/6|\?|$)/, async route => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push(body);
      policies[5].active = body.active;
      return route.fulfill({ json: policies[5] });
    }
    const query = new URL(request.url()).searchParams;
    const current = Number(query.get('page'));
    const size = Number(query.get('page_size'));
    return route.fulfill({ json: {
      items: empty ? [] : policies.slice((current - 1) * size, current * size),
      total: empty ? 0 : policies.length, page: current, page_size: size,
    } });
  });
  await page.goto('/manager/sla');
  const panel = page.getByRole('region', { name: 'Danh sách chính sách SLA' });
  await expect(panel.getByRole('heading', { name: 'Chưa có chính sách SLA' })).toBeVisible();
  await panel.getByRole('button', { name: 'Tạo chính sách đầu tiên' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  empty = false;
  await page.reload();
  const pagination = panel.getByRole('navigation');
  const rows = panel.locator('tbody tr');
  await expect(rows).toHaveCount(5);
  await expect(pagination).toContainText('Hiển thị 1–5 trên tổng 6 chính sách');
  await pagination.getByRole('button', { name: 'Sau' }).click();
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText('Hiển thị 6–6 trên tổng 6 chính sách');
  await expect(rows.getByText('120 phút (2 giờ)')).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: 'Giao diện' }).selectOption(theme);
    await rows.getByRole('button', { name: 'Chỉnh sửa Chính sách 6' }).click();
    const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa chính sách SLA' });
    await expect(dialog.getByLabel('Tên chính sách')).toHaveAttribute('readonly', '');
    await expect(dialog.getByRole('combobox', { name: 'Mức ưu tiên SLA' })).toBeDisabled();
    await expect(dialog.getByText(/2 phiếu tham chiếu/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await dialog.getByRole('button', { name: 'Hủy' }).click();
  }
  await rows.getByRole('button', { name: 'Chỉnh sửa Chính sách 6' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chỉnh sửa chính sách SLA' });
  await dialog.getByRole('checkbox', { name: 'Chính sách đang có hiệu lực' }).uncheck();
  await dialog.getByRole('button', { name: 'Lưu chính sách' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows.getByText('Đã tắt', { exact: true })).toBeVisible();
  await expect(pagination).toContainText('Trang 2 / 2');
  expect(writes).toEqual([{
    name: 'Chính sách 6', priority_id: 3, response_minutes: 15, resolution_minutes: 120, active: false,
    expected: { name: 'Chính sách 6', priority_id: 3, response_minutes: 15, resolution_minutes: 120, active: true },
  }]);
});

test('manager report activity pages keep the applied date and scope', async ({ page }) => {
  await fixtures(page, 'manager');
  const requests: URLSearchParams[] = [];
  await page.route(/\/api\/v1\/manager\/(reports\/(analytics|activity)\?|groups\?|catalog\/types)/, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/groups')) return route.fulfill({ json: { items: [{ id: '2', name: 'Bảo hành' }], total: 1, page: 1, page_size: 100 } });
    if (url.pathname.endsWith('/types')) return route.fulfill({ json: [{ id: '6', name: 'Sofa' }] });
    if (url.pathname.endsWith('/analytics')) return route.fulfill({ json: {
      start: '2026-11-01', end: '2026-11-05', snapshot_at: '2026-11-05T12:00:00Z',
      group_id: url.searchParams.get('group'), type_id: url.searchParams.get('type'), groups: [], trend: [], rating_distribution: [],
      metrics: {
        created: 0, resolved: 0, response_samples: 0, response_avg: null, resolution_avg: null,
        response_on_time: 0, response_late: 0, resolution_on_time: 0, resolution_late: 0,
        response_missing: 0, resolution_missing: 0, response_open_late: 0, response_open_on_time: 0,
        resolution_open_late: 0, resolution_open_on_time: 0, intake_missing_sla: 0, missing_resolution_time: 0,
        closed_in_period: 0, closed_with_rating: 0, ratings: 0, rating_avg: null, positive: 0,
      },
    } });
    requests.push(url.searchParams);
    const current = Number(url.searchParams.get('page'));
    return route.fulfill({ json: {
      items: Array.from({ length: current === 1 ? 10 : 1 }, (_, i) => ({
        id: `${current}-${i}`, ticket_id: '1000', happened_at: '2026-11-05T12:00:00Z',
        kind: 'Phản hồi công khai', actor: 'Nhân viên', detail: 'Có trao đổi mới',
      })), total: 11, page: current, page_size: 10,
    } });
  });
  await page.goto('/manager/reports');
  await page.getByRole('combobox', { name: 'Nhóm hỗ trợ' }).selectOption('2');
  await page.getByRole('combobox', { name: 'Loại yêu cầu' }).selectOption('6');
  await page.getByRole('button', { name: 'Áp dụng', exact: true }).click();
  await expect(page.locator('.report-metadata')).toContainText('Nhóm: Bảo hành · Loại yêu cầu: Sofa');
  const history = page.getByRole('region', { name: 'Lịch sử hoạt động hỗ trợ' });
  await expect(history.locator('tbody tr')).toHaveCount(10);
  await history.getByRole('button', { name: 'Sau' }).click();
  await expect(history.locator('tbody tr')).toHaveCount(1);
  await expect(history.getByRole('navigation')).toContainText('Hiển thị 11–11 trên tổng 11 hoạt động');
  expect(Object.fromEntries(requests.at(-1)!)).toEqual({
    preset: 'custom', start: '2026-11-01', end: '2026-11-05', page: '2', group: '2', type: '6',
  });
  await page.getByRole('button', { name: 'Đặt lại', exact: true }).click();
  await expect(history.locator('tbody tr')).toHaveCount(10);
  expect(requests.at(-1)?.get('group')).toBeNull();
});
