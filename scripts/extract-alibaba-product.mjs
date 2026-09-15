#!/usr/bin/env node
import { launchAlibabaContext, parseArgs } from './lib/alibaba-common.mjs';
import { scrapeAlibabaProduct } from './lib/scrape-alibaba-product.mjs';

const args = parseArgs(process.argv.slice(2));
const productUrl = args.urls[0];

if (!productUrl) {
  console.error('Usage: node scripts/extract-alibaba-product.mjs <product-detail-url> [--headless]');
  process.exit(1);
}

const context = await launchAlibabaContext({ headless: args.headless });

try {
  const record = await scrapeAlibabaProduct(context, productUrl);
  console.log(`Saved: data/alibaba/raw/${record.slug}/product-record.json`);
} finally {
  await context.close().catch(() => {});
}
