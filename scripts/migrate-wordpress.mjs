import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ORIGIN = 'https://www.first-machinery.com';
const PUBLIC_ASSET_DIR = 'public/assets/first-machinery';
const PUBLIC_ASSET_URL = '/assets/first-machinery';

const routesToExcludeFromDynamic = new Set(['']);

async function getJson(path) {
  const res = await fetch(`${ORIGIN}${path}`);
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status}: ${path}`);
  }
  return res.json();
}

async function getText(path) {
  const res = await fetch(`${ORIGIN}${path}`);
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status}: ${path}`);
  }
  return res.text();
}

function decodeEntities(value = '') {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&#038;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#8211;', '-')
    .replaceAll('&#8217;', "'")
    .replaceAll('&#8243;', '"');
}

function stripTags(value = '') {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSlug(link) {
  const url = new URL(link);
  return url.pathname.replace(/^\/|\/$/g, '');
}

function collectUploadUrls(text = '') {
  const decoded = text.replaceAll('\\/', '/');
  const urls = new Set();
  const patterns = [
    /https:\/\/www\.first-machinery\.com\/wp-content\/uploads\/[^"'()<>\s]+/g,
    /url\(['"]?(https:\/\/www\.first-machinery\.com\/wp-content\/uploads\/[^'")]+)['"]?\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      urls.add((match[1] || match[0]).split('?')[0]);
    }
  }
  return [...urls];
}

function localPathForUrl(url) {
  const remote = new URL(url);
  const marker = '/wp-content/uploads/';
  const relative = remote.pathname.slice(remote.pathname.indexOf(marker) + marker.length);
  return {
    filePath: join(PUBLIC_ASSET_DIR, relative),
    publicUrl: `${PUBLIC_ASSET_URL}/${relative}`,
  };
}

function localizeHtml(html, assetMap) {
  let output = html.replaceAll('\\/', '/');
  for (const [remote, local] of assetMap.entries()) {
    output = output.replaceAll(remote, local);
  }
  output = output.replaceAll(`${ORIGIN}/`, '/');
  output = output.replaceAll('/manus-storage/solution-bottled-water-line_bfa500ce.png', `${PUBLIC_ASSET_URL}/2026/05/solution-bottled-water-line.webp`);

  // Replace third-party Wufoo embed blocks with a contact page link.
  output = output.replace(
    /<div id="wufoo-[\s\S]*?static\.wufoo\.com[\s\S]*?<\/script>/gi,
    `<div class="wufoo-placeholder"><h3>获取报价</h3><p>请通过联系我们页面发送您的项目需求。</p><a class="green-btn" href="/contact/?source=legacy-quote">联系我们</a></div>`,
  );

  return output;
}

async function localizeDownloadedFiles(dir, assetMap) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await localizeDownloadedFiles(path, assetMap);
      continue;
    }
    if (!/\.(css|js|html)$/i.test(entry.name)) continue;

    let content = await readFile(path, 'utf8');
    let changed = false;
    for (const [remote, local] of assetMap.entries()) {
      if (content.includes(remote)) {
        content = content.replaceAll(remote, local);
        changed = true;
      }
    }
    if (changed) await writeFile(path, content);
  }
}

async function downloadAsset(url) {
  const { filePath, publicUrl } = localPathForUrl(url);
  await mkdir(dirname(filePath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Asset download failed ${res.status}: ${url}`);
  }
  await pipeline(res.body, createWriteStream(filePath));
  return publicUrl;
}

function pageSummary(item) {
  return {
    id: item.id,
    title: stripTags(item.title?.rendered || ''),
    slug: normalizeSlug(item.link),
    parent: item.parent || 0,
    link: item.link,
    type: item.type,
    modified: item.modified,
    excerpt: stripTags(item.excerpt?.rendered || ''),
    rawContent: item.content?.rendered || '',
  };
}

function buildMenu() {
  return [
    { label: 'Home', href: '/' },
    {
      label: 'Products',
      href: '/products/',
      mega: {
        eyebrow: 'product overview',
        columns: [
          {
            title: 'Equipment',
            subtitle: '8 product lines',
            links: [
              ['Water Treatment System', '/products/water-treatment-system/', 'RO · Ultrafiltration · Ozone · Storage'],
              ['Bottle Blowing Machine', '/products/preform-and-bottle-blowing-machine/', 'Preform Injection · Semi-Auto · Full-Auto'],
              ['PET Filling Machine', '/products/filling-machine/', 'Water · Juice · CSD · Oil · Sauce'],
              ['Beverage Processing', '/products/beverage-processing-system/', 'Blending · Sterilization · Carbonation · CIP'],
              ['Labeling Machine', '/products/labeling-machine/', 'Sleeve · OPP · Adhesive · Cold Glue'],
              ['Packing Machine', '/products/packaging-machine/', 'Film Shrink Wrapping · Case Packing'],
              ['Palletizing System', '/products/production-material/', 'Automatic Palletizer · Robot Palletizer'],
              ['Auxiliary Equipment', '/products/auxiliary-equipment/', 'Conveyor · Air Dryer · Date Printer · Air Compressor'],
            ],
          },
          {
            title: 'Filling Machine',
            subtitle: 'capacity and liquid type',
            links: [
              ['Water Filling Machine', '/products/filling-machine/water-filling-machine/', '2,000 - 36,000+ BPH'],
              ['Juice & Tea Filling Machine', '/products/filling-machine/juice-tea-filling-machine/', 'Hot fill · Tea · Juice'],
              ['Carbonated Drink Filling Machine', '/products/filling-machine/carbonated-drink-filling-machine/', 'CSD · Soda · Sparkling water'],
              ['5 Gallon Water Line', '/products/filling-machine/5-gallon-water-line/', '3-5 gallon returnable bottle'],
              ['Edible Oil Filling Machine', '/products/filling-machine/edible-oil-filling-machine/', '1,000 - 12,000 BPH'],
              ['Sauce Filling Machine', '/products/filling-machine/sauce-filling-machine/', 'Viscous liquid and condiment'],
            ],
          },
          {
            title: 'Services',
            subtitle: 'End-to-end delivery',
            links: [
              ['01 Factory Layout Design', '/solutions/', 'Planning before equipment selection'],
              ['02 Complete Line Engineering', '/products/', 'Integrated process and packaging line'],
              ['03 Installation & Commissioning', '/projects/', 'On-site start-up and operator training'],
              ['04 After-sales Support', '/contact/', 'Parts, remote support and field service'],
            ],
          },
        ],
      },
    },
    {
      label: 'Solutions',
      href: '/solutions/',
      mega: {
        eyebrow: '6 industries + turnkey',
        columns: [
          {
            title: 'Industries',
            subtitle: 'complete beverage lines',
            links: [
              ['Bottled Water Line', '/products/filling-machine/water-filling-machine/', '2,000 - 36,000+ BPH'],
              ['Juice & Tea Filling Line', '/products/filling-machine/juice-tea-filling-machine/', '3,000 - 24,000 BPH'],
              ['Carbonated Drink Line (CSD)', '/products/filling-machine/carbonated-drink-filling-machine/', '6,000 - 42,000 BPH'],
              ['Edible Oil Filling Line', '/products/filling-machine/edible-oil-filling-machine/', '1,000 - 12,000 BPH'],
              ['Sauce & Condiment Line', '/products/filling-machine/sauce-filling-machine/', '500 - 8,000 BPH'],
              ['Turnkey Project Solution', '/solutions/', 'Full line engineering'],
            ],
          },
          {
            title: 'By Capacity',
            subtitle: 'quick range',
            links: [
              ['Small <6,000', '/products/', 'Compact production and lower capex'],
              ['Medium 6-18K', '/products/', 'Balanced automation and output'],
              ['High 18K+', '/products/', 'High-speed integrated line'],
            ],
          },
        ],
      },
    },
    { label: 'Factory', href: '/factory/' },
    { label: 'Projects', href: '/projects/' },
    { label: 'Contact', href: '/contact/' },
  ];
}

const [pages, posts, media, homeHtml] = await Promise.all([
  getJson('/wp-json/wp/v2/pages?per_page=100'),
  getJson('/wp-json/wp/v2/posts?per_page=100'),
  getJson('/wp-json/wp/v2/media?per_page=100'),
  getText('/'),
]);

const pageItems = pages.map(pageSummary);
const postItems = posts.map(pageSummary);
const frontHtmlEntries = await Promise.all(
  [...pageItems, ...postItems].map(async (item) => getText(`/${item.slug}/`).catch(() => '')),
);

const allContent = [...pageItems, ...postItems].map((item) => item.rawContent).join('\n') + homeHtml + frontHtmlEntries.join('\n');
const contentAssetUrls = collectUploadUrls(allContent);
const mediaAssetUrls = media.map((item) => item.source_url).filter(Boolean);
const allAssetUrls = [...new Set([...contentAssetUrls, ...mediaAssetUrls])];
const assetMap = new Map();

console.log(`Found ${pageItems.length} pages, ${postItems.length} posts, ${media.length} media items.`);
console.log(`Downloading ${allAssetUrls.length} unique assets...`);

for (const url of allAssetUrls) {
  const publicUrl = await downloadAsset(url);
  assetMap.set(url, publicUrl);
  process.stdout.write('.');
}
console.log('\nAssets downloaded.');
await localizeDownloadedFiles(PUBLIC_ASSET_DIR, assetMap);
console.log('Localized downloaded CSS/JS asset references.');

const mediaOutput = media.map((item) => ({
  id: item.id,
  title: stripTags(item.title?.rendered || ''),
  mimeType: item.mime_type,
  sourceUrl: item.source_url,
  localUrl: assetMap.get(item.source_url),
  filename: item.filename || item.source_url?.split('/').pop() || '',
  extension: extname(item.source_url || ''),
  filesize: item.filesize || item.media_details?.filesize || null,
}));

function finalizeItem(item) {
  const content = localizeHtml(item.rawContent, assetMap);
  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    parent: item.parent,
    link: item.link,
    type: item.type,
    modified: item.modified,
    excerpt: item.excerpt,
    content,
    textLength: stripTags(content).length,
    isHome: item.slug === '',
    isDynamic: !routesToExcludeFromDynamic.has(item.slug),
  };
}

const output = {
  origin: ORIGIN,
  generatedAt: new Date().toISOString(),
  menu: buildMenu(),
  pages: pageItems.map(finalizeItem),
  posts: postItems.map(finalizeItem),
  media: mediaOutput,
};

await mkdir('src/data', { recursive: true });
await writeFile('src/data/site.json', `${JSON.stringify(output, null, 2)}\n`);
console.log('Wrote src/data/site.json');
