import {test,expect} from '@playwright/test';

for(const theme of ['light','dark']) test(`group/type catalog · ${theme}`,async({page},info)=>{
  await page.addInitScript(value=>localStorage.setItem('helpdesk-theme',value),theme);
  let groupTypes=['1'];
  let rows=Array.from({length:6},(_,i)=>({id:String(i+1),name:`Loại nội thất ${i+1}`,description:'Mô tả loại hỗ trợ',active:true,tickets:i===0?2:0,waiting:0,
    groups:i<2?[{id:'2',name:'Nhóm thứ hai',is_default:true},...(i===0?[{id:'1',name:'Nhóm hiện tại',is_default:false}]:[])]:[]}));
  const group=()=>({id:'1',name:'Nhóm hiện tại',description:null,active:true,members:0,pending:0,type_count:groupTypes.length});
  const calls:{method:string;path:string;body:any}[]=[];
  await page.route('**/api/v1/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname.replace('/api/v1',''),method=request.method();
    const body=request.postData()?request.postDataJSON():undefined;calls.push({method,path,body});
    let result:unknown={},status=200;
    if(path==='/auth/me')result={user:{id:'77',name:'Quản lý fixture',email:'fixture@example.invalid',role:'manager',role_label:'Quản lý'},csrf_token:null};
    else if(path==='/auth/csrf')result={csrf_token:'fixture-csrf'};
    else if(path==='/manager/groups')result={items:[group(),{...group(),id:'2',name:'Nhóm thứ hai',type_count:2}],total:2,page:1,page_size:20};
    else if(path==='/manager/groups/1')result={...group(),people:[],types:rows.filter(t=>groupTypes.includes(t.id)),stats:{total:0,waiting:0,processing:0,paused:0,resolved:0,closed:0,overdue:0}};
    else if(path==='/manager/groups/1/support-types')result={available:true,items:rows};
    else if(path==='/manager/groups/1/support-types/2'&&method==='POST'){
      groupTypes.push('2');rows=rows.map(t=>t.id==='2'?{...t,groups:[...t.groups,{id:'1',name:'Nhóm hiện tại',is_default:false}]}:t);result={message:'Đã thêm loại hỗ trợ cùng phụ trách.'};
    }
    else if(path==='/manager/groups/1/support-types/2'&&method==='DELETE'){
      groupTypes=groupTypes.filter(id=>id!=='2');rows=rows.map(t=>t.id==='2'?{...t,groups:t.groups.filter(g=>g.id!=='1')}:t);result={message:'Đã bỏ quan hệ phụ trách.'};
    }
    else if(path==='/manager/support-types'&&method==='POST'){
      const row={id:'7',...body,groups:[],tickets:0,waiting:0};rows.push(row);status=201;result=row;
    }
    else if(path.startsWith('/manager/support-types/')&&method==='PATCH'){
      const id=path.split('/').at(-1);rows=rows.map(t=>t.id===id?{...t,...body}:t);result=rows.find(t=>t.id===id);
    }
    else if(path==='/manager/support-types'){
      const p=Number(url.searchParams.get('page')),size=Number(url.searchParams.get('page_size'));
      const found=rows.filter(t=>t.name.includes(url.searchParams.get('search')||'')).filter(t=>!url.searchParams.has('active')||String(t.active)===url.searchParams.get('active'));
      result={items:found.slice((p-1)*size,p*size),total:found.length,page:p,page_size:size};
    }
    else throw Error(`Unexpected API ${method} ${path}`);
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto('/manager/groups');
  await expect(page.getByRole('link',{name:'Nhóm và loại hỗ trợ'})).toBeVisible();
  await page.getByRole('button',{name:'Chỉnh sửa nhóm Nhóm hiện tại',exact:true}).click();
  await page.getByRole('button',{name:'Cập nhật loại hỗ trợ',exact:true}).click();
  const types=page.getByRole('dialog',{name:'Cập nhật loại hỗ trợ',exact:true});
  await expect(types.getByText('1/2 loại hỗ trợ',{exact:true})).toBeVisible();
  // A type already mapped to another group remains selectable.
  await types.locator('select[name=type_id]').selectOption('2');
  await types.getByRole('button',{name:'Thêm loại hỗ trợ',exact:true}).click();
  await expect(types.getByText('2/2 loại hỗ trợ',{exact:true})).toBeVisible();
  await expect(types.getByRole('button',{name:'Thêm loại hỗ trợ',exact:true})).toBeDisabled();
  await types.getByRole('button',{name:'Bỏ quan hệ phụ trách Loại nội thất 2',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Xác nhận bỏ quan hệ phụ trách',exact:true});
  await expect(confirm).toBeVisible();
  expect(calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  await confirm.getByRole('button',{name:'Xác nhận',exact:true}).click();
  await expect(types.getByText('1/2 loại hỗ trợ',{exact:true})).toBeVisible();
  await page.screenshot({path:`test-results/group-expertise-${info.project.name}-${theme}.png`,fullPage:true});
  await page.keyboard.press('Escape');await expect(types).not.toBeVisible();
  await expect(page.getByRole('dialog',{name:/Chỉnh sửa nhóm ·/})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Loại hỗ trợ',exact:true}).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByText('Hiển thị 1–5 trên tổng 6 loại hỗ trợ')).toBeVisible();
  await page.getByRole('button',{name:'Sau',exact:true}).click();
  await expect(page.getByText('Hiển thị 6–6 trên tổng 6 loại hỗ trợ')).toBeVisible();
  await page.getByRole('button',{name:'Thêm loại hỗ trợ',exact:true}).click();
  const create=page.getByRole('dialog',{name:'Thêm loại hỗ trợ',exact:true});
  await create.getByLabel('Tên loại hỗ trợ').fill('Loại mới fixture');
  await create.getByLabel('Mô tả',{exact:true}).fill('Mô tả mới');
  await create.getByRole('button',{name:'Lưu loại hỗ trợ'}).click();
  await expect(create).not.toBeVisible();await expect(page.getByText('Loại mới fixture',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Chỉnh sửa Loại mới fixture',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'Chỉnh sửa loại hỗ trợ',exact:true});
  await edit.getByLabel('Tên loại hỗ trợ').fill('Loại đã sửa');
  await edit.getByRole('button',{name:'Lưu loại hỗ trợ'}).click();
  await expect(page.getByText('Loại đã sửa',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Ngừng Loại đã sửa',exact:true}).click();
  await page.getByRole('dialog',{name:'Xác nhận ngừng hoạt động'}).getByRole('button',{name:'Xác nhận',exact:true}).click();
  await expect(page.getByRole('region',{name:'Danh sách loại hỗ trợ'}).getByText('Ngừng hoạt động',{exact:true})).toBeVisible();
  expect(calls.find(c=>c.path==='/manager/support-types'&&c.method==='GET')?.path).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.screenshot({path:`test-results/group-types-${info.project.name}-${theme}.png`,fullPage:true});
});
