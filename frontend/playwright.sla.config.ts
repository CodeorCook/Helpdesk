import {defineConfig} from '@playwright/test';
import base from './playwright.catalog.config';
export default defineConfig({...base,testMatch:'sla-versions.spec.ts'});
