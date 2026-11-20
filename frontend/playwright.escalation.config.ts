import {defineConfig} from '@playwright/test';
import base from './playwright.catalog.config';
export default defineConfig({...base,testMatch:'escalation.spec.ts'});
