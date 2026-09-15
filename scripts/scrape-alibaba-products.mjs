#!/usr/bin/env node
import path from 'node:path';
import {
  autoScroll,
  DATA_ROOT,
  DEFAULT_GROUP_URL,
  ensureDir,
  extractProductLinksFromAnchors,
  gotoAndSettle,
  launchAlibabaContext,
  normalizeAlibabaUrl,
  parseArgs,
  productIdFromUrl,
  saveJson,
  saveText,
  slugify,
} from './lib/alibaba-common.mjs';
import { scrapeAlibabaProduct } from './lib/scrape-alibaba-product.mjs';

const args = parseArgs(process.argv.slice(2));
const startUrls = args.urls.length ? args.urls : [DEFAULT_GROUP_URL];

await ensureDir(DATA_ROOT);

console.log('Alibaba product scraper');
console.log(`Start pages: ${startUrls.join(', ')}`);
console.log(`Mode: ${args.listOnly ? 'list only' : 'list + product details'}`);
if (args.limit) console.log(`Limit: ${args.limit} product(s)`);
console.log('');

const context = await launchAlibabaContext({ headless: args.headless });
const catalog = {
  generatedAt: new Date().toISOString(),
  startUrls,
  groupPages: [],
  products: [],
};

try {
  for (const startUrl of startUrls) {
    const normalizedStartUrl = normalizeAlibabaUrl(startUrl);
    const page = await context.newPage();
    try {
      console.log(`Scanning product list: ${normalizedStartUrl}`);
      await gotoAndSettle(page, normalizedStartUrl);
      await autoScroll(page, { maxRounds: 28, pauseMs: 900 });

      const anchors = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map((anchor) => {
          const image = anchor.querySelector('img') || anchor.closest('div,li,article')?.querySelector('img');
          const title =
            anchor.getAttribute('title') ||
            anchor.textContent ||
            image?.getAttribute('alt') ||
            anchor.closest('div,li,article')?.textContent ||
            '';
          return {
            href: anchor.href,
            title,
            image: image?.currentSrc || image?.src || image?.getAttribute('data-src') || '',
          };
        });
      });

      const links = extractProductLinksFromAnchors(anchors);
      const pageSlug = slugify(new URL(normalizedStartUrl).pathname, 'catalog-page');
      const catalogPageDir = path.join(DATA_ROOT, 'catalog-pages');
      await ensureDir(catalogPageDir);
      await saveText(path.join(catalogPageDir, `${pageSlug}.html`), await page.content());
      await page.screenshot({ path: path.join(catalogPageDir, `${pageSlug}.png`), fullPage: true }).catch(() => {});

      catalog.groupPages.push({
        url: normalizedStartUrl,
        title: await page.title().catch(() => ''),
        productCount: links.length,
        products: links,
        savedHtml: `catalog-pages/${pageSlug}.html`,
        savedScreenshot: `catalog-pages/${pageSlug}.png`,
      });

      console.log(`Found ${links.length} product link(s).`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  const seen = new Set();
  const productQueue = catalog.groupPages
    .flatMap((group) => group.products)
    .filter((item) => {
      const key = productIdFromUrl(item.url) || item.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const selectedProducts = args.limit ? productQueue.slice(0, args.limit) : productQueue;
  catalog.products = selectedProducts;
  await saveJson(path.join(DATA_ROOT, 'catalog.json'), catalog);

  if (args.listOnly) {
    console.log(`Saved catalog: ${path.join(DATA_ROOT, 'catalog.json')}`);
    process.exit(0);
  }

  const records = [];
  for (let index = 0; index < selectedProducts.length; index += 1) {
    const item = selectedProducts[index];
    console.log(`\n[${index + 1}/${selectedProducts.length}] ${item.title || item.url}`);
    const record = await scrapeAlibabaProduct(context, item.url, {
      maxScrollRounds: 36,
    });
    records.push({
      ...item,
      rawSlug: record.slug,
      recordFile: `raw/${record.slug}/product-record.json`,
    });
    await saveJson(path.join(DATA_ROOT, 'product-index.json'), {
      generatedAt: new Date().toISOString(),
      count: records.length,
      products: records,
    });
  }

  console.log('');
  console.log(`Saved catalog: ${path.join(DATA_ROOT, 'catalog.json')}`);
  console.log(`Saved product index: ${path.join(DATA_ROOT, 'product-index.json')}`);
} finally {
  await context.close().catch(() => {});
}
