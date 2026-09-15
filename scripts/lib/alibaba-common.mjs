import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import sharp from 'sharp';
import { chromium } from 'playwright-core';

export const PROJECT_ROOT = process.cwd();
export const SESSION_DIR = path.join(PROJECT_ROOT, '.cache', 'alibaba-session');
export const DATA_ROOT = path.join(PROJECT_ROOT, 'data', 'alibaba');
export const RAW_ROOT = path.join(DATA_ROOT, 'raw');
export const DEFAULT_GROUP_URL =
  'https://zhongkemeili.en.alibaba.com/productgrouplist-964637074/Water_Filling_Mahcine_100ml_10L_.html';

const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function normalizeAlibabaUrl(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (raw.startsWith('//')) return `https:${raw}`;
  try {
    return new URL(raw, 'https://www.alibaba.com').href;
  } catch {
    return '';
  }
}

export function productIdFromUrl(url) {
  return String(url || '').match(/_(\d+)\.html/)?.[1] || String(url || '').match(/-(\d+)\.html/)?.[1] || '';
}

export function productIdFromAnyUrl(url) {
  return (
    String(url || '').match(/(?:_|-)(\d{10,})\.html/)?.[1] ||
    String(url || '').match(/[?&](?:productId|id)=(\d{10,})/)?.[1] ||
    ''
  );
}

export async function promptEnter(message) {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

export async function launchAlibabaContext({ headless = false } = {}) {
  await ensureDir(SESSION_DIR);
  const executablePath = process.env.CHROME_EXECUTABLE || DEFAULT_CHROME_PATH;
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    executablePath,
    headless,
    viewport: { width: 1440, height: 950 },
    acceptDownloads: true,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  context.setDefaultTimeout(45000);
  context.setDefaultNavigationTimeout(90000);
  return context;
}

export function parseLoginMarkdown(content) {
  const result = {
    loginUrl: '',
    account: '',
    password: '',
    notes: '',
  };

  const lines = String(content || '').split(/\r?\n/);
  let currentKey = '';

  for (const line of lines) {
    const match = line.match(/^\s*(Login URL|Account|Password|Notes)\s*:\s*(.*)\s*$/i);
    if (match) {
      currentKey = match[1].toLowerCase().replace(/\s+/g, '');
      const value = match[2].trim();
      if (currentKey === 'loginurl') result.loginUrl = value;
      else result[currentKey] = value;
      continue;
    }

    if (!currentKey || !line.trim()) continue;
    if (currentKey === 'loginurl' && !result.loginUrl) result.loginUrl = line.trim();
    else if (currentKey === 'account' && !result.account) result.account = line.trim();
    else if (currentKey === 'password' && !result.password) result.password = line.trim();
    else if (currentKey === 'notes') result.notes += `${result.notes ? '\n' : ''}${line.trim()}`;
  }

  return result;
}

export async function gotoAndSettle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

export async function autoScroll(page, { maxRounds = 24, pauseMs = 900 } = {}) {
  let lastHeight = 0;
  let stableRounds = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const height = await page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.82));
      return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(pauseMs);

    if (height === lastHeight) stableRounds += 1;
    else stableRounds = 0;
    lastHeight = height;

    if (stableRounds >= 3) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(400);
}

export async function saveText(file, content) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, content, 'utf8');
}

export async function saveJson(file, data) {
  await saveText(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function extractProductLinksFromAnchors(anchors) {
  const seen = new Set();
  return anchors
    .map((item) => ({
      url: normalizeAlibabaUrl(item.href),
      title: String(item.title || '').replace(/\s+/g, ' ').trim(),
      image: normalizeAlibabaUrl(item.image),
    }))
    .filter((item) => item.url.includes('/product-detail/') && item.url.includes('.html'))
    .filter((item) => {
      const key = productIdFromUrl(item.url) || item.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function downloadImageAsWebp(request, url, outputFile, { quality = 86 } = {}) {
  await ensureDir(path.dirname(outputFile));
  const response = await request.get(url, {
    headers: {
      referer: 'https://www.alibaba.com/',
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    timeout: 45000,
  });
  if (!response.ok()) throw new Error(`Image download failed ${response.status()} ${url}`);
  const buffer = await response.body();
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Not a readable image: ${url}`);
  await sharp(buffer)
    .rotate()
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 6 })
    .toFile(outputFile);
  return {
    sourceUrl: url,
    file: outputFile,
    width: metadata.width,
    height: metadata.height,
  };
}

export function parseArgs(argv) {
  const args = {
    urls: [],
    limit: 0,
    headless: false,
    listOnly: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--headless') args.headless = true;
    else if (value === '--list-only') args.listOnly = true;
    else if (value === '--limit') args.limit = Number(argv[++i] || 0);
    else if (value.startsWith('--limit=')) args.limit = Number(value.split('=')[1] || 0);
    else args.urls.push(value);
  }

  return args;
}
