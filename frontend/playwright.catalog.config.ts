import {defineConfig} from '@playwright/test';
import base from './playwright.staff-ui.config';
// Use the installed Chrome; no browser download is required for these UI fixtures.
export default defineConfig({...base, testMatch:'support-types.spec.ts',
  use:{...base.use, channel:'chrome'},
});
