import { expect, test } from '@playwright/test';

// Only supplied by the opt-in rollback integration script, never production code.
const fixtures=JSON.parse(process.env.HELPDESK_DB_TEST_USERS??'[]') as {email:string;role:string}[];
const password=process.env.HELPDESK_DB_TEST_PASSWORD;
if(!password||fixtures.length!==3) throw new Error('Chạy qua scripts/test_auth_database.py --execute --browser; không dùng tài khoản mặc định.');

for(const account of fixtures){
  test(`real PostgreSQL login, dashboard, forbidden route and logout: ${account.role}`,async({page},testInfo)=>{
    await page.goto('/login');
    await page.getByLabel('Email',{exact:true}).fill(account.email);
    await page.getByLabel('Mật khẩu',{exact:true}).fill(password!);
    await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await expect(page).toHaveURL(`/${account.role}`);
    await expect(page.getByRole('heading',{name:'Thông tin tài khoản',exact:true})).toBeVisible();
    await expect(page.getByText(account.email,{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(await page.evaluate(()=>localStorage.length)).toEqual(0);
    // No password/session snapshots: only the rendered dashboard after sign-in.
    await page.screenshot({path:`test-results/dashboard-${account.role}-${testInfo.project.name}.png`,fullPage:true});
    const forbidden=account.role==='manager'?'staff':'manager';
    expect((await page.request.get(`/api/v1/${forbidden}/dashboard`)).status()).toBe(403);
    await page.goto(`/${forbidden}`);
    await expect(page.getByRole('heading',{name:'Không đủ quyền truy cập'})).toBeVisible();
    await page.getByRole('link',{name:'Đến không gian của bạn'}).click();
    await expect(page.getByRole('heading',{name:'Thông tin tài khoản',exact:true})).toBeVisible();
    if(account.role==='customer'){
      await page.getByRole('navigation',{name:'Không gian Khách hàng'}).getByRole('link',{name:'Tạo phiếu hỗ trợ',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Tạo phiếu hỗ trợ',exact:true})).toBeVisible();
      await page.getByRole('navigation',{name:'Không gian Khách hàng'}).getByRole('link',{name:'Tổng quan',exact:true}).click();
    }else{
      await page.goto('/support/new');
      await expect(page.getByRole('heading',{name:'Không đủ quyền truy cập'})).toBeVisible();
      await page.getByRole('link',{name:'Đến không gian của bạn'}).click();
    }
    await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();
    await expect(page).toHaveURL('/login');
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  });
}
