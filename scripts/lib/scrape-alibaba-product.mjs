import fs from 'node:fs/promises';
import path from 'node:path';
import {
  autoScroll,
  downloadImageAsWebp,
  ensureDir,
  gotoAndSettle,
  normalizeAlibabaUrl,
  productIdFromUrl,
  RAW_ROOT,
  saveJson,
  saveText,
  slugify,
} from './alibaba-common.mjs';

function mediaUrlFromItem(item) {
  return (
    item?.imageUrl?.big ||
    item?.imageUrl?.origin ||
    item?.imageUrl?.large ||
    item?.imageUrl?.normal ||
    item?.url ||
    ''
  );
}

function collectProductImageUrls(extracted) {
  const urls = new Set();

  for (const item of extracted.product?.mediaItems || []) {
    const url = normalizeAlibabaUrl(mediaUrlFromItem(item));
    if (url) urls.add(url);
  }

  for (const url of extracted.jsonLdImages || []) {
    const normalized = normalizeAlibabaUrl(url);
    if (normalized) urls.add(normalized);
  }

  if (extracted.product?.video?.cover) {
    urls.add(normalizeAlibabaUrl(extracted.product.video.cover));
  }

  for (const image of extracted.pageImages || []) {
    const url = normalizeAlibabaUrl(image.src);
    const isLikelySupplierImage = /alicdn\.com\/kf\/|sc0\d\.alicdn\.com\/kf\//i.test(url);
    const isLargeEnough = Number(image.width || 0) >= 300 && Number(image.height || 0) >= 160;
    if (url && isLikelySupplierImage && isLargeEnough) urls.add(url);
  }

  return [...urls];
}

export async function scrapeAlibabaProduct(context, productUrl, options = {}) {
  const page = await context.newPage();
  const startedAt = new Date().toISOString();
  const url = normalizeAlibabaUrl(productUrl);

  try {
    console.log(`Scraping product: ${url}`);
    await gotoAndSettle(page, url);
    await autoScroll(page, { maxRounds: options.maxScrollRounds || 32, pauseMs: 950 });

    const extracted = await page.evaluate(() => {
      const detailData = window.detailData || null;
      const product = detailData?.globalData?.product || {};
      const seller = detailData?.globalData?.seller || {};
      const title =
        product.subject ||
        document.querySelector('h1')?.textContent?.trim() ||
        document.title.replace(/\s+-\s+Buy.*$/i, '').trim();

      const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .map((script) => {
          try {
            return JSON.parse(script.textContent || 'null');
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const jsonLdImages = jsonLd
        .flatMap((item) => (Array.isArray(item) ? item : [item]))
        .flatMap((item) => item?.image || item?.contentUrl || [])
        .filter(Boolean);

      const pageImages = Array.from(document.images).map((image) => ({
        src: image.currentSrc || image.src || image.getAttribute('data-src') || '',
        alt: image.alt || '',
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
      }));

      const videos = Array.from(document.querySelectorAll('video'))
        .map((video) => video.currentSrc || video.src || '')
        .filter(Boolean);

      const iframes = Array.from(document.querySelectorAll('iframe')).map((iframe) => ({
        src: iframe.src || '',
        title: iframe.title || '',
      }));

      const bodyText = document.body?.innerText?.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() || '';
      const descriptionText = Array.from(
        document.querySelectorAll('[class*="description"], [class*="Description"], [data-testid*="description"], [class*="detail"]'),
      )
        .map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 30);

      return {
        title,
        sourceUrl: location.href,
        product,
        seller,
        jsonLd,
        jsonLdImages,
        pageImages,
        videos,
        iframes,
        descriptionText,
        bodyTextSample: bodyText.slice(0, 12000),
        userAgent: navigator.userAgent,
      };
    });

    const productId = productIdFromUrl(url) || extracted.product?.productId || extracted.product?.id || '';
    const productSlug = slugify(`${extracted.title || 'alibaba-product'}-${productId || ''}`, `product-${Date.now()}`);
    const productDir = path.join(RAW_ROOT, productSlug);
    const assetDir = path.join(productDir, 'assets');
    await ensureDir(assetDir);

    const html = await page.content();
    await saveText(path.join(productDir, 'page.html'), html);
    await page.screenshot({ path: path.join(productDir, 'full-page.png'), fullPage: true }).catch(() => {});

    const frameRecords = [];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const frameUrl = frame.url();
      if (!frameUrl || frameUrl === 'about:blank') continue;
      const body = await frame.content().catch(() => '');
      if (!body) continue;
      const frameFile = path.join(productDir, 'frames', `${slugify(frameUrl).slice(0, 90)}.html`);
      await saveText(frameFile, body);
      frameRecords.push({ url: frameUrl, file: path.relative(productDir, frameFile), bytes: Buffer.byteLength(body) });
    }

    const imageUrls = collectProductImageUrls(extracted);
    const downloadedImages = [];
    for (let index = 0; index < imageUrls.length; index += 1) {
      const imageUrl = imageUrls[index];
      const outputFile = path.join(assetDir, `${productSlug}-image-${String(index + 1).padStart(2, '0')}.webp`);
      try {
        const record = await downloadImageAsWebp(context.request, imageUrl, outputFile);
        downloadedImages.push({
          sourceUrl: imageUrl,
          file: path.relative(productDir, record.file),
          sourceWidth: record.width,
          sourceHeight: record.height,
        });
      } catch (error) {
        downloadedImages.push({
          sourceUrl: imageUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const record = {
      scrapedAt: new Date().toISOString(),
      startedAt,
      sourceUrl: url,
      productId,
      slug: productSlug,
      title: extracted.title,
      supplier: {
        companyName: extracted.seller?.companyName || '',
        homeUrl: extracted.seller?.homeUrl || '',
        companyVideoUrl: extracted.seller?.companyVideoUrl || '',
      },
      price: extracted.product?.price || null,
      moq: extracted.product?.moq || null,
      properties: extracted.product?.productBasicProperties || [],
      mediaItems: extracted.product?.mediaItems || [],
      videos: {
        productVideo: extracted.product?.video || null,
        domVideoUrls: extracted.videos || [],
      },
      iframes: extracted.iframes || [],
      savedFrames: frameRecords,
      descriptionText: extracted.descriptionText || [],
      bodyTextSample: extracted.bodyTextSample,
      downloadedImages,
      rawFiles: {
        pageHtml: 'page.html',
        screenshot: 'full-page.png',
        extractedJson: 'extracted.json',
      },
    };

    await saveJson(path.join(productDir, 'extracted.json'), extracted);
    await saveJson(path.join(productDir, 'product-record.json'), record);

    return record;
  } finally {
    await page.close().catch(() => {});
  }
}
