import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
 testDir:'./phase2-tests',outputDir:'./test-results/phase2',workers:1,retries:0,timeout:60000,
 use:{baseURL:'http://localhost:5174',trace:'off',video:'off'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
 webServer:{command:'npm run dev -- --mode database-test',url:'http://localhost:5174',reuseExistingServer:false,timeout:30000}
});
