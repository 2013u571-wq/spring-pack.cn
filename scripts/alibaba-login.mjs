#!/usr/bin/env node
import { DEFAULT_GROUP_URL, launchAlibabaContext, promptEnter, SESSION_DIR } from './lib/alibaba-common.mjs';

const targetUrl = process.argv[2] || DEFAULT_GROUP_URL;

console.log(`Opening Alibaba login session in Chrome...`);
console.log(`Session directory: ${SESSION_DIR}`);
console.log(`Target URL: ${targetUrl}`);
console.log('');
console.log('Use the browser window to log in manually. Do not paste the password into this terminal.');

const context = await launchAlibabaContext({ headless: false });
const page = context.pages()[0] || await context.newPage();
await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

await promptEnter('\nAfter the page is logged in and usable, press Enter here to save the session and close Chrome...');

await context.storageState({ path: `${SESSION_DIR}/storage-state.json` }).catch(() => {});
await context.close();

console.log('Alibaba session saved.');
