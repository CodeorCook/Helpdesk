import { expect, test } from '@playwright/test';

test('home, navigation, FAQ and responsive layout',async({page},testInfo)=>{
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'Mọi yêu cầu, đều được lắng nghe.'})).toBeVisible();
  await expect(page.getByText('Giao diện và dữ liệu minh họa',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  if(testInfo.project.name==='mobile') await page.getByRole('button',{name:'Mở điều hướng'}).click();
  await page.getByRole('navigation').getByRole('link',{name:'Tính năng',exact:true}).click();
  await expect(page).toHaveURL(/#features$/);
  await page.locator('summary').filter({hasText:'Tôi có thể tra cứu phiếu ở đâu?'}).click();
  await expect(page.getByText('Chọn “Tra cứu phiếu”. Sau đăng nhập', {exact:false})).toBeVisible();
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.screenshot({path:`test-results/home-${testInfo.project.name}.png`,fullPage:true});
  expect(errors).toEqual([]);
});

test('CTAs and all protected routes require login; login layout and 404',async({page},testInfo)=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.getByRole('link',{name:'Gửi yêu cầu hỗ trợ',exact:true}).first().click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading',{name:'Chào mừng trở lại!'})).toBeVisible();
  await expect(page.getByLabel('Ghi nhớ đăng nhập')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByLabel('Mật khẩu',{exact:true}).fill('temporary-browser-check');
  await page.getByRole('button',{name:'Hiện mật khẩu',exact:true}).click();
  await expect(page.getByLabel('Mật khẩu',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Ẩn mật khẩu',exact:true}).click();
  await page.getByLabel('Mật khẩu',{exact:true}).clear();
  await page.screenshot({path:`test-results/login-${testInfo.project.name}.png`,fullPage:true});
  for(const path of ['/customer','/customer/tickets','/customer/tickets/new','/customer/profile','/staff','/manager','/support/new','/support/lookup']){
    await page.goto(path,{waitUntil:'domcontentloaded'});await expect(page).toHaveURL('/login');
  }
  await page.goto('/not-a-real-route',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'404 · Không tìm thấy trang'})).toBeVisible();
});

test('login uses the real API and does not invent a successful session',async({page})=>{
  await page.goto('/login',{waitUntil:'domcontentloaded'});
  await page.getByLabel('Email',{exact:true}).fill(`browser-${Date.now()}@example.invalid`);
  await page.getByLabel('Mật khẩu',{exact:true}).fill('invalid-browser-test-password');
  const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  const response=await responsePromise;
  expect(response.status()).toBe(401);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL('/login');
  expect(await page.evaluate(()=>localStorage.length)).toEqual(0);
});
