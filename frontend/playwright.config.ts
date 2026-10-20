import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', outputDir:'./test-results/public', fullyParallel:true, workers:2, retries:0,
  use:{baseURL:'http://localhost:5173',trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
  webServer:{command:'npm run dev',url:'http://localhost:5173',reuseExistingServer:true,timeout:30000}
});
