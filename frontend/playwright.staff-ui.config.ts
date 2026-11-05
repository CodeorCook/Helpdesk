import { defineConfig,devices } from '@playwright/test';
export default defineConfig({
 testDir:'./staff-ui-tests',outputDir:'./test-results/staff-ui',workers:1,retries:0,timeout:45000,
 use:{baseURL:'http://localhost:5175',actionTimeout:10000,trace:'off',video:'off'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
 webServer:{command:'npm run dev -- --port 5175',url:'http://localhost:5175',reuseExistingServer:false,timeout:30000},
});
