#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import {
  DATA_ROOT,
  downloadImageAsWebp,
  ensureDir,
  normalizeAlibabaUrl,
  productIdFromAnyUrl,
  saveJson,
  saveText,
  slugify,
} from './lib/alibaba-common.mjs';

const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9224';
const cliArgs = process.argv.slice(2);
const mode = cliArgs.includes('--list') ? 'list' : 'capture';
const explicitMatch = cliArgs.find((arg) => !arg.startsWith('--') && arg !== 'list') || '';

function isAlibabaUrl(url) {
  return /(^|\.)alibaba\.com|(^|\.)alicdn\.com/i.test(url || '');
}

function sanitizeTitle(title, url) {
  const productId = productIdFromAnyUrl(url);
  const cleanTitle = String(title || '')
    .replace(/\s+-\s+Buy.*$/i, '')
    .replace(/\s+on Alibaba\.com.*$/i, '')
    .trim();
  return slugify(`${cleanTitle || new URL(url).hostname}${productId ? `-${productId}` : ''}`, 'manual-capture');
}

async function getPages(browser) {
  const pages = [];
  for (const context of browser.contexts()) {
    pages.push(...context.pages());
  }
  return pages;
}

async function extractPageData(page) {
  return await page.evaluate(() => {
    const detailData = window.detailData || null;
    const product = detailData?.globalData?.product || {};
    const seller = detailData?.globalData?.seller || {};
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((script) => {
        try {
          return JSON.parse(script.textContent || 'null');
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const images = Array.from(document.images).map((image) => ({
      src: image.currentSrc || image.src || image.getAttribute('data-src') || '',
      alt: image.alt || '',
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0,
    }));
    const links = Array.from(document.querySelectorAll('a[href]')).map((anchor) => {
      const image = anchor.querySelector('img') || anchor.closest('div,li,article')?.querySelector('img');
      return {
        href: anchor.href,
        text: anchor.textContent?.replace(/\s+/g, ' ').trim() || '',
        title: anchor.getAttribute('title') || '',
        image: image?.currentSrc || image?.src || image?.getAttribute('data-src') || '',
      };
    });
    const videos = Array.from(document.querySelectorAll('video')).map((video) => ({
      src: video.currentSrc || video.src || '',
      poster: video.poster || '',
    }));
    const iframes = Array.from(document.querySelectorAll('iframe')).map((iframe) => ({
      src: iframe.src || '',
      title: iframe.title || '',
    }));
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const text = document.body?.innerText?.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || '';
    return {
      url: location.href,
      title: document.title,
      product,
      seller,
      jsonLd,
      images,
      links,
      videos,
      iframes,
      headings,
      textSample: text.slice(0, 30000),
      textLength: text.length,
    };
  });
}

function collectLikelyAssetUrls(data) {
  const urls = new Set();

  for (const item of data.product?.mediaItems || []) {
    const imageUrl = item?.imageUrl?.big || item?.imageUrl?.origin || item?.imageUrl?.normal || '';
    if (imageUrl) urls.add(normalizeAlibabaUrl(imageUrl));
  }
  if (data.product?.video?.cover) urls.add(normalizeAlibabaUrl(data.product.video.cover));

  for (const image of data.images || []) {
    const url = normalizeAlibabaUrl(image.src);
    if (!url) continue;
    const isAlibabaImage = /alicdn\.com\/(kf|imgextra)|sc0\d\.alicdn\.com\/kf/i.test(url);
    const largeEnough = Number(image.width || 0) >= 260 && Number(image.height || 0) >= 120;
    if (isAlibabaImage && largeEnough) urls.add(url);
  }

  return [...urls].filter(Boolean);
}

function collectImageUrlsFromHtml(html) {
  const urls = new Set();
  const patterns = [
    /<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi,
    /background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = normalizeAlibabaUrl(match[1]);
      if (url && /alicdn\.com/i.test(url)) urls.add(url);
    }
  }

  return [...urls];
}

const browser = await chromium.connectOverCDP(endpoint);

try {
  const pages = await getPages(browser);
  const pageRecords = await Promise.all(
    pages.map(async (page, index) => ({
      index,
      title: await page.title().catch(() => ''),
      url: page.url(),
    })),
  );

  if (mode === 'list') {
    console.log(JSON.stringify(pageRecords, null, 2));
    process.exit(0);
  }

  const selected =
    pages.find((page) => explicitMatch && page.url().includes(explicitMatch)) ||
    pages.find((page) => isAlibabaUrl(page.url()) && !/error404|about:blank/i.test(page.url())) ||
    pages[0];

  if (!selected) {
    throw new Error('No open browser pages found.');
  }

  await selected.bringToFront().catch(() => {});
  await selected.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});

  const data = await extractPageData(selected);
  const slug = sanitizeTitle(data.product?.subject || data.title, data.url);
  const captureRoot = path.join(DATA_ROOT, 'manual-captures', slug);
  const assetRoot = path.join(captureRoot, 'assets');
  await ensureDir(assetRoot);

  await saveText(path.join(captureRoot, 'page.html'), await selected.content());
  await saveJson(path.join(captureRoot, 'page-data.json'), data);
  await selected.screenshot({ path: path.join(captureRoot, 'screenshot.png'), fullPage: true }).catch(() => {});

  const frameRecords = [];
  const frameAssetUrls = new Set();
  for (const frame of selected.frames()) {
    if (frame === selected.mainFrame()) continue;
    const frameUrl = frame.url();
    if (!frameUrl || frameUrl === 'about:blank') continue;
    const body = await frame.content().catch(() => '');
    if (!body) continue;
    collectImageUrlsFromHtml(body).forEach((url) => frameAssetUrls.add(url));
    const frameFile = path.join(captureRoot, 'frames', `${slugify(frameUrl).slice(0, 90)}.html`);
    await saveText(frameFile, body);
    frameRecords.push({ url: frameUrl, file: path.relative(captureRoot, frameFile), bytes: Buffer.byteLength(body) });
  }

  const downloadedAssets = [];
  const assetUrls = [...new Set([...collectLikelyAssetUrls(data), ...frameAssetUrls])];
  for (let index = 0; index < assetUrls.length; index += 1) {
    const url = assetUrls[index];
    const outputFile = path.join(assetRoot, `${slug}-asset-${String(index + 1).padStart(2, '0')}.webp`);
    try {
      const record = await downloadImageAsWebp(selected.context().request, url, outputFile);
      downloadedAssets.push({
        sourceUrl: url,
        file: path.relative(captureRoot, record.file),
        sourceWidth: record.width,
        sourceHeight: record.height,
      });
    } catch (error) {
      downloadedAssets.push({
        sourceUrl: url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const productLinks = data.links
    .map((link) => ({
      url: normalizeAlibabaUrl(link.href),
      title: link.title || link.text,
      image: normalizeAlibabaUrl(link.image),
      productId: productIdFromAnyUrl(link.href),
    }))
    .filter((link) => link.url.includes('/product-detail/') && link.productId);

  const seen = new Set();
  const uniqueProductLinks = productLinks.filter((link) => {
    const key = link.productId || link.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = {
    capturedAt: new Date().toISOString(),
    endpoint,
    url: data.url,
    title: data.title,
    slug,
    productId: productIdFromAnyUrl(data.url),
    textLength: data.textLength,
    headings: data.headings,
    productSubject: data.product?.subject || '',
    propertyCount: data.product?.productBasicProperties?.length || 0,
    imageCount: data.images.length,
    downloadedAssetCount: downloadedAssets.filter((item) => !item.error).length,
    downloadedAssets,
    videos: data.videos,
    productVideo: data.product?.video || null,
    iframes: data.iframes,
    savedFrames: frameRecords,
    productLinks: uniqueProductLinks,
    files: {
      html: 'page.html',
      data: 'page-data.json',
      screenshot: 'screenshot.png',
      summary: 'capture-summary.json',
    },
  };

  await saveJson(path.join(captureRoot, 'capture-summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await browser.close().catch(() => {});
}
