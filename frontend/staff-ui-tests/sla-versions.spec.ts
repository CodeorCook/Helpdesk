import {test,expect} from '@playwright/test';

for(const theme of ['light','dark']) test(`SLA versions manager · ${theme}`,async({page},info)=>{
  await page.addInitScript(t=>localStorage.setItem('helpdesk-theme',t),theme);
  let policies=Array.from({length:7},(_,i)=>({id:String(8-i),name:i===0?'SLA Trung bình v1':i===1?'SLA Trung bình v2':`Bản dự thảo ${i}`,
    priority_id:2,priority:'Trung bình',response_minutes:15,resolution_minutes:60,active:i===0,referenced:i===0?3:0}));
  const calls:{path:string;method:string;body:any}[]=[];
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1',''),method=req.method(),body=req.postData()?req.postDataJSON():undefined;
    calls.push({path,method,body});let result:unknown={},status=200;
    if(path==='/auth/me')result={user:{id:'77',name:'Quản lý SLA fixture',role:'manager',email:'fixture@example.invalid',role_label:'Quản lý'}};
    else if(path==='/auth/csrf')result={csrf_token:'fixture-csrf'};
    else if(path==='/manager/catalog/priorities')result=[{id:'2',name:'Trung bình'}];
    else if(path==='/manager/sla'&&method==='GET'){
      const p=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('page_size'));
      result={items:policies.slice((p-1)*size,p*size),total:policies.length,page:p,page_size:size};
    }else if(path==='/manager/sla'&&method==='POST'){
      expect(body.active).toBe(false);const policy={id:'9',...body,priority:'Trung bình',referenced:0};policies.unshift(policy);result=policy;status=201;
    }else if(/^\/manager\/sla\/\d+\/state$/.test(path)){
      const id=path.split('/').at(-2)!;
      if(method==='GET')result={policy:policies.find(p=>p.id===id),current:policies.find(p=>p.active)||null};
      else{expect(body.expected_active_id).toBe('8');policies=policies.map(p=>({...p,active:p.id===id}));result=policies.find(p=>p.id===id);}
    }else if(/^\/manager\/sla\/\d+$/.test(path)&&method==='PATCH'){
      const id=path.split('/').at(-1);policies=policies.map(p=>p.id===id?{...p,...body}:p);result=policies.find(p=>p.id===id);
    }else throw Error(`${method} ${path}`);
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('/manager/sla');
  await expect(page.getByText('Hiển thị 1–5 trên tổng 7 chính sách')).toBeVisible();
  await page.getByRole('button',{name:'Sau',exact:true}).click();
  await expect(page.getByText('Hiển thị 6–7 trên tổng 7 chính sách')).toBeVisible();
  await page.getByRole('button',{name:'Trước',exact:true}).click();
  await page.getByRole('button',{name:'Tạo chính sách SLA',exact:true}).click();
  const create=page.getByRole('dialog',{name:'Tạo chính sách SLA',exact:true});
  await create.getByRole('button',{name:'Tạo chính sách',exact:true}).click();
  await expect(create.getByText('Tên chính sách không được để trống.')).toBeVisible();
  await create.getByLabel('Tên chính sách',{exact:true}).fill('SLA Trung bình v3');
  await create.getByLabel('Mức ưu tiên SLA').selectOption('2');
  await create.getByLabel('Thời gian phản hồi (phút)').fill('20');
  await create.getByLabel('Thời gian xử lý (phút)').fill('10');
  await expect(create.locator('#manager-sla-validation')).toContainText('lớn hơn hoặc bằng');
  await create.getByLabel('Thời gian xử lý (phút)').fill('50');
  await create.getByRole('button',{name:'Tạo chính sách',exact:true}).click();await expect(create).not.toBeVisible();
  await expect(page.getByText('SLA Trung bình v3',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Kích hoạt SLA Trung bình v2',exact:true}).click();
  const activate=page.getByRole('dialog',{name:'Kích hoạt chính sách SLA',exact:true});
  await expect(activate).toContainText('SLA Trung bình v1');
  expect(calls.filter(c=>c.path.endsWith('/state')&&c.method==='POST')).toHaveLength(0);
  await activate.getByRole('button',{name:'Xác nhận kích hoạt'}).click();await expect(activate).not.toBeVisible();
  expect(calls.filter(c=>c.path.endsWith('/state')&&c.method==='POST')).toHaveLength(1);
  await page.getByRole('button',{name:'Khóa SLA Trung bình v2',exact:true}).click();
  const lock=page.getByRole('dialog',{name:'Khóa chính sách SLA',exact:true});
  await expect(lock).toContainText('Không khóa đơn lẻ');await page.keyboard.press('Escape');await expect(lock).not.toBeVisible();
  await page.getByRole('button',{name:'Chỉnh sửa SLA Trung bình v1',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'Chỉnh sửa chính sách SLA',exact:true});
  await expect(edit.getByLabel('Thời gian xử lý (phút)')).toHaveAttribute('readonly','');
  await expect(edit.getByRole('button',{name:'Lưu chính sách'})).toBeDisabled();
  await edit.getByRole('button',{name:'Hủy',exact:true}).click();
  await page.getByRole('button',{name:'Chỉnh sửa SLA Trung bình v3',exact:true}).click();
  await edit.getByLabel('Thời gian xử lý (phút)').fill('75');
  await edit.getByRole('button',{name:'Lưu chính sách'}).click();await expect(edit).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/sla-versions-${info.project.name}-${theme}.png`,fullPage:true});
});

for(const theme of ['light','dark']) test(`staff SLA preview · ${theme}`,async({page},info)=>{
  await page.addInitScript(t=>localStorage.setItem('helpdesk-theme',t),theme);
  const calls:any[]=[];
  const ticket={id:'901',title:'Sofa cần bảo hành',description:'Chân sofa hỏng',type_id:'6',type_name:'Bảo hành sản phẩm',status:'MOI',status_label:'Mới',
    assigned_id:null,assignment_id:null,customer:{name:'Khách fixture'},attachments:[],created_at:'2026-11-19T01:00:00Z',updated_at:'2026-11-19T01:00:00Z',sla_id:'1',sla_phase:'provisional'};
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname.replace('/api/v1','');let result:unknown={};
    if(path==='/auth/me')result={user:{id:'77',name:'Nhân viên SLA fixture',role:'staff',email:'fixture@example.invalid',role_label:'Nhân viên hỗ trợ'}};
    else if(path==='/auth/csrf')result={csrf_token:'fixture-csrf'};
    else if(path==='/staff/tickets/901')result=ticket;
    else if(path==='/staff/ticket-types')result=[{id:'6',name:'Bảo hành sản phẩm'}];
    else if(path==='/staff/priorities')result=[{id:'1',name:'Thấp'},{id:'2',name:'Trung bình'},{id:'3',name:'Cao'}];
    else if(path==='/staff/sla-preview'){
      const priority=url.searchParams.get('priority_id');if(priority==='2')await new Promise(r=>setTimeout(r,150));
      result={policy:priority==='1'?null:{id:priority,name:priority==='3'?'SLA Cao hiệu lực':'SLA Trung bình hiệu lực',response_minutes:priority==='3'?7:15,resolution_minutes:priority==='3'?35:60}};
    }else if(path==='/staff/tickets/901/approve'){
      calls.push(req.postDataJSON());await route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({detail:'SLA vừa thay đổi. Hãy kiểm tra xem trước.'})});return;
    }else throw Error(path);
    await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('/staff/requests/901');
  await page.getByRole('button',{name:'Dùng thông tin khách gửi'}).click();
  const priority=page.getByRole('combobox',{name:'Mức độ ưu tiên',exact:true});
  await priority.selectOption('2');await priority.selectOption('3');
  await expect(page.getByText('SLA Cao hiệu lực · #3')).toBeVisible();
  await expect(page.getByText('Phản hồi: 7 phút · Xử lý: 35 phút.')).toBeVisible();
  await page.getByRole('button',{name:'Lập phiếu hỗ trợ',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('SLA vừa thay đổi');
  expect(calls[0].priority_id).toBe('3');
  await expect(page.getByLabel('Tiêu đề phiếu hỗ trợ')).toHaveValue('Sofa cần bảo hành');
  await priority.selectOption('1');
  await expect(page.getByText(/Chưa có SLA đang áp dụng cho mức ưu tiên này/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Lập phiếu hỗ trợ',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/sla-preview-${info.project.name}-${theme}.png`,fullPage:true});
});
