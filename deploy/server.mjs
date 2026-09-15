import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = process.cwd();
const staticRoots = [path.join(root, 'deploy', 'static'), path.join(root, 'public')];
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const maxBodySize = 10 * 1024 * 1024;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.webp', '.zip']);
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'],
  ['.avif', 'image/avif'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.ico', 'image/x-icon'], ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
]);

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function env(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function appendField(form, fieldName, value) {
  if (fieldName && value !== undefined && value !== '') form.append(fieldName, value);
}

async function handleContact(request, response) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxBodySize) return json(response, 413, { ok: false, error: 'Attachment or request is too large.' });

  let input;
  let attachment;
  try {
    const webRequest = new Request(`http://localhost${request.url}`, {
      method: 'POST', headers: request.headers, body: request, duplex: 'half',
    });
    if ((request.headers['content-type'] || '').includes('multipart/form-data')) {
      const form = await webRequest.formData();
      const file = form.get('attachment');
      attachment = file instanceof File && file.size > 0 ? file : undefined;
      input = Object.fromEntries(['name', 'email', 'whatsapp', 'country', 'message', 'product', 'sourcePage', 'sourceTitle', 'source', 'referrer'].map((key) => [key, form.get(key)?.toString()]));
    } else {
      input = await webRequest.json();
    }
  } catch {
    return json(response, 400, { ok: false, error: 'Invalid request body.' });
  }

  const lead = {
    name: clean(input.name, 120), email: clean(input.email, 160).toLowerCase(),
    whatsapp: clean(input.whatsapp, 80), country: clean(input.country, 120),
    message: clean(input.message, 3000), product: clean(input.product, 180) || '常规咨询',
    sourcePage: clean(input.sourcePage, 500), sourceTitle: clean(input.sourceTitle, 180),
    source: clean(input.source, 180), referrer: clean(input.referrer, 500),
  };
  const invalid = [];
  if (!lead.name) invalid.push('name');
  if (!lead.email || !emailPattern.test(lead.email)) invalid.push('email');
  if (!lead.whatsapp) invalid.push('whatsapp');
  if (!lead.message) invalid.push('message');
  if (attachment && (attachment.size > 8 * 1024 * 1024 || !allowedExtensions.has(path.extname(attachment.name).toLowerCase()))) invalid.push('attachment');
  if (invalid.length) return json(response, 422, { ok: false, error: `Missing or invalid fields: ${invalid.join(', ')}` });

  const apiKey = env('WUFOO_API_KEY');
  if (!apiKey) return json(response, 503, { ok: false, error: '询盘服务暂未配置，请通过电话、微信或邮件联系我们。' });

  const form = new FormData();
  appendField(form, env('WUFOO_FIELD_NAME', 'Field1'), lead.name);
  appendField(form, env('WUFOO_FIELD_EMAIL', 'Field2'), lead.email);
  appendField(form, env('WUFOO_FIELD_WHATSAPP', 'Field3'), lead.whatsapp);
  appendField(form, env('WUFOO_FIELD_COUNTRY'), lead.country);
  appendField(form, env('WUFOO_FIELD_MESSAGE', 'Field4'), lead.message);
  appendField(form, env('WUFOO_FIELD_PRODUCT', 'Field14'), lead.product);
  appendField(form, env('WUFOO_FIELD_SOURCE_PAGE', 'Field8'), lead.sourcePage);
  appendField(form, env('WUFOO_FIELD_SOURCE_TITLE'), lead.sourceTitle);
  appendField(form, env('WUFOO_FIELD_SOURCE'), lead.source);
  appendField(form, env('WUFOO_FIELD_REFERRER'), lead.referrer);
  appendField(form, env('WUFOO_FIELD_ATTACHMENT', 'Field12'), attachment);

  try {
    const upstream = await fetch(`https://${encodeURIComponent(env('WUFOO_SUBDOMAIN', 'hongdao'))}.wufoo.com/api/v3/forms/${encodeURIComponent(env('WUFOO_FORM_HASH', 'm1afeevd0fti8na'))}/entries.json`, {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:integration`).toString('base64')}` }, body: form,
    });
    if (!upstream.ok) return json(response, 502, { ok: false, error: '询盘暂时无法发送，请稍后重试或通过电话、微信联系我们。' });
  } catch {
    return json(response, 502, { ok: false, error: '询盘暂时无法发送，请稍后重试或通过电话、微信联系我们。' });
  }
  return json(response, 200, { ok: true, success: true });
}

async function findStaticFile(pathname) {
  const candidates = pathname.endsWith('/') ? [`${pathname}index.html`] : [pathname, `${pathname}/index.html`];
  for (const base of staticRoots) {
    for (const candidate of candidates) {
      const resolved = path.resolve(base, `.${candidate}`);
      if (!resolved.startsWith(`${base}${path.sep}`)) continue;
      try {
        const details = await stat(resolved);
        if (details.isFile()) return { resolved, details };
      } catch {}
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (request.method === 'POST' && (url.pathname === '/api/contact' || url.pathname === '/api/submit-lead')) return handleContact(request, response);
  if (url.pathname === '/2000bph-water-filling-machine' || url.pathname === '/2000bph-water-filling-machine/') {
    response.writeHead(301, { location: '/products/filling-machine/water-filling-machine/2000bph-water-filling-machine/' });
    return response.end();
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { ok: false, error: 'Method not allowed.' });

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end('Bad request');
  }
  const file = await findStaticFile(pathname);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return response.end('Not found');
  }
  const extension = path.extname(file.resolved).toLowerCase();
  response.writeHead(200, {
    'content-type': mimeTypes.get(extension) || 'application/octet-stream',
    'content-length': file.details.size,
    'cache-control': url.pathname.startsWith('/assets/') || url.pathname.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') return response.end();
  createReadStream(file.resolved).pipe(response);
});

server.requestTimeout = 30_000;
server.listen(port, host, () => console.log(`Spring Pack deploy server listening on http://${host}:${port}`));
