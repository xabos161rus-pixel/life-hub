import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Временный конфиг: локально нет chromium под ревизию playwright, гоняем на
// системном Chrome. Удаляется после проверки.
export default defineConfig({ ...base, use: { ...base.use, channel: 'chrome' } });
