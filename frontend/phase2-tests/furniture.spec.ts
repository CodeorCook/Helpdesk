import { expect, test } from '@playwright/test';

const names=['Tư vấn sản phẩm nội thất','Hỗ trợ đơn hàng','Giao hàng và lắp đặt','Bảo hành sản phẩm','Sửa chữa và bảo trì','Đổi trả sản phẩm','Khiếu nại chất lượng','Thanh toán và hóa đơn'];
const fixtures=JSON.parse(process.env.HELPDESK_PHASE2_FIXTURES||'{}') as Record<string,{email:string}>;
const password=process.env.HELPDESK_PHASE2_PASSWORD!;

test('furniture home, FAQ and real ticket categories retain the responsive Helpdesk flow',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'Mọi yêu cầu, đều được lắng nghe.'})).toBeVisible();
 await expect(page.locator('.hero-copy')).toContainText('sản phẩm nội thất');
 await expect(page.getByText('Giao diện và dữ liệu minh họa',{exact:true})).toBeVisible();
 await page.getByText('Yêu cầu bảo hành hoặc đổi trả cần thông tin gì?',{exact:true}).click();
 await expect(page.getByText('gửi phiếu không đồng nghĩa yêu cầu đã được chấp thuận.',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:`test-results/furniture-home-${testInfo.project.name}.png`,fullPage:true});
 await page.goto('/login',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Email',{exact:true}).fill(fixtures[testInfo.project.name].email);
 await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 await expect(page).toHaveURL('/customer');
 await page.goto('/customer/tickets/new',{waitUntil:'domcontentloaded'});
 const types=page.getByRole('combobox',{name:'Loại hỗ trợ'});
 await expect(types.locator('option')).toHaveCount(9);
 expect((await types.locator('option').allTextContents()).slice(1).sort()).toEqual([...names].sort());
 await types.selectOption({label:'Giao hàng và lắp đặt'});
 await expect(page.getByLabel('Tiêu đề',{exact:true})).toHaveAttribute('placeholder','Ví dụ: Cần hỗ trợ lắp đặt bàn ăn đã giao');
 await expect(page.getByLabel('Mô tả chi tiết')).toHaveAttribute('placeholder',/mã đơn hàng\/hóa đơn nếu có/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:`test-results/furniture-new-ticket-${testInfo.project.name}.png`,fullPage:true});
 expect(errors).toEqual([]);
});
