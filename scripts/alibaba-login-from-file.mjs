#!/usr/bin/env node
import fs from 'node:fs/promises';
import {
  DEFAULT_GROUP_URL,
  launchAlibabaContext,
  parseLoginMarkdown,
  SESSION_DIR,
} from './lib/alibaba-common.mjs';

const credentialFile = process.argv[2] || '/Users/gaosong/Desktop/alibaba-login.md';
const content = await fs.readFile(credentialFile, 'utf8');
const credentials = parseLoginMarkdown(content);

if (!credentials.loginUrl || !credentials.account || !credentials.password) {
  console.error('Credential file must include Login URL, Account and Password fields.');
  process.exit(1);
}

const selectors = {
  account: [
    'input[name="loginId"]',
    'input[name="account"]',
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    '#fm-login-id',
    'input[placeholder*="Email" i]',
    'input[placeholder*="account" i]',
    'input[placeholder*="邮箱" i]',
    'input[placeholder*="账号" i]',
  ],
  password: [
    'input[name="password"]',
    'input[type="password"]',
    '#fm-login-password',
    'input[placeholder*="Password" i]',
    'input[placeholder*="密码" i]',
  ],
  submit: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("登录")',
    'button:has-text("Submit")',
    '.fm-button',
  ],
};

async function fillFirst(frame, selectorList, value) {
  for (const selector of selectorList) {
    const locator = frame.locator(selector).first();
    if ((await locator.count().catch(() => 0)) < 1) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.fill(value, { timeout: 5000 });
    return selector;
  }
  return '';
}

async function clickFirst(frame, selectorList) {
  for (const selector of selectorList) {
    const locator = frame.locator(selector).first();
    if ((await locator.count().catch(() => 0)) < 1) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click({ timeout: 5000 });
    return selector;
  }
  return '';
}

async function fillLogin(page) {
  for (const frame of page.frames()) {
    const accountSelector = await fillFirst(frame, selectors.account, credentials.account);
    const passwordSelector = await fillFirst(frame, selectors.password, credentials.password);
    if (!accountSelector && !passwordSelector) continue;

    console.log(`Filled login form${frame === page.mainFrame() ? '' : ' in iframe'}.`);
    await clickFirst(frame, selectors.submit);
    return true;
  }
  return false;
}

async function looksLoggedIn(page) {
  const url = page.url();
  if (/login|signin|passport/i.test(url)) return false;
  const hasPassword = await page
    .locator('input[type="password"]')
    .first()
    .isVisible({ timeout: 1500 })
    .catch(() => false);
  return !hasPassword;
}

console.log('Opening Alibaba with credential file.');
console.log(`Credential file: ${credentialFile}`);
console.log(`Session directory: ${SESSION_DIR}`);
console.log('Password will not be printed.');

const context = await launchAlibabaContext({ headless: false });
const page = context.pages()[0] || await context.newPage();

try {
  await page.goto(credentials.loginUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await fillLogin(page);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  if (!(await looksLoggedIn(page))) {
    console.log('');
    console.log('Manual verification may be required in the open Chrome window.');
    console.log('Please finish CAPTCHA/SMS/QR verification if shown. The script will wait up to 8 minutes.');
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      if (await looksLoggedIn(page)) break;
      await page.waitForTimeout(3000);
    }
  }

  await page.goto(DEFAULT_GROUP_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await context.storageState({ path: `${SESSION_DIR}/storage-state.json` }).catch(() => {});

  console.log(`Current page: ${page.url()}`);
  console.log('Alibaba session saved.');
} finally {
  await context.close().catch(() => {});
}
