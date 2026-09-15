import type { APIRoute } from 'astro';

export const prerender = false;

type LeadPayload = {
  name?: string;
  email?: string;
  whatsapp?: string;
  country?: string;
  message?: string;
  product?: string;
  sourcePage?: string;
  sourceTitle?: string;
  source?: string;
  referrer?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxAttachmentSize = 8 * 1024 * 1024;
const allowedAttachmentExtensions = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.webp', '.zip']);

function clean(value: unknown, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function isAllowedAttachment(file: File) {
  const filename = file.name || '';
  const extension = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  return allowedAttachmentExtensions.has(extension);
}

function env(name: string, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function appendField(form: FormData, fieldName: string, value: string | File | undefined) {
  if (!fieldName || value === undefined || value === '') return;
  form.append(fieldName, value);
}

export const POST: APIRoute = async ({ request }) => {
  let input: LeadPayload;
  let attachment: File | undefined;

  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('attachment');
      attachment = file instanceof File && file.size > 0 ? file : undefined;
      input = {
        name: formData.get('name')?.toString(),
        email: formData.get('email')?.toString(),
        whatsapp: formData.get('whatsapp')?.toString(),
        country: formData.get('country')?.toString(),
        message: formData.get('message')?.toString(),
        product: formData.get('product')?.toString(),
        sourcePage: formData.get('sourcePage')?.toString(),
        sourceTitle: formData.get('sourceTitle')?.toString(),
        source: formData.get('source')?.toString(),
        referrer: formData.get('referrer')?.toString(),
      };
    } else {
      input = await request.json();
    }
  } catch (error) {
    console.error('[contact] invalid request body', error);
    return Response.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const lead = {
    name: clean(input.name, 120),
    email: clean(input.email, 160).toLowerCase(),
    whatsapp: clean(input.whatsapp, 80),
    country: clean(input.country, 120),
    message: clean(input.message, 3000),
    product: clean(input.product, 180) || '常规咨询',
    sourcePage: clean(input.sourcePage, 500),
    sourceTitle: clean(input.sourceTitle, 180),
    source: clean(input.source, 180),
    referrer: clean(input.referrer, 500),
  };

  const invalid = [];
  if (!lead.name) invalid.push('name');
  if (!lead.email || !emailPattern.test(lead.email)) invalid.push('email');
  if (!lead.whatsapp) invalid.push('whatsapp');
  if (!lead.message) invalid.push('message');
  if (attachment && (attachment.size > maxAttachmentSize || !isAllowedAttachment(attachment))) invalid.push('attachment');

  if (invalid.length > 0) {
    return Response.json({ ok: false, error: `Missing or invalid fields: ${invalid.join(', ')}` }, { status: 422 });
  }

  const wufooSubdomain = env('WUFOO_SUBDOMAIN', 'hongdao');
  const wufooFormHash = env('WUFOO_FORM_HASH', 'm1afeevd0fti8na');
  const wufooApiKey = env('WUFOO_API_KEY');

  if (!wufooApiKey) {
    console.error('[contact] WUFOO_API_KEY is not configured');
    return Response.json(
      { ok: false, error: '询盘服务暂未配置，请通过电话、微信或邮件联系我们。' },
      { status: 503 },
    );
  }

  const wufooForm = new FormData();
  appendField(wufooForm, env('WUFOO_FIELD_NAME', 'Field1'), lead.name);
  appendField(wufooForm, env('WUFOO_FIELD_EMAIL', 'Field2'), lead.email);
  appendField(wufooForm, env('WUFOO_FIELD_WHATSAPP', 'Field3'), lead.whatsapp);
  appendField(wufooForm, env('WUFOO_FIELD_COUNTRY'), lead.country);
  appendField(wufooForm, env('WUFOO_FIELD_MESSAGE', 'Field4'), lead.message);
  appendField(wufooForm, env('WUFOO_FIELD_PRODUCT', 'Field14'), lead.product);
  appendField(wufooForm, env('WUFOO_FIELD_SOURCE_PAGE', 'Field8'), lead.sourcePage);
  appendField(wufooForm, env('WUFOO_FIELD_SOURCE_TITLE'), lead.sourceTitle);
  appendField(wufooForm, env('WUFOO_FIELD_SOURCE'), lead.source);
  appendField(wufooForm, env('WUFOO_FIELD_REFERRER'), lead.referrer);
  appendField(wufooForm, env('WUFOO_FIELD_ATTACHMENT', 'Field12'), attachment);

  try {
    const response = await fetch(
      `https://${encodeURIComponent(wufooSubdomain)}.wufoo.com/api/v3/forms/${encodeURIComponent(wufooFormHash)}/entries.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${wufooApiKey}:integration`).toString('base64')}`,
        },
        body: wufooForm,
      },
    );

    if (!response.ok) {
      const upstreamMessage = (await response.text()).slice(0, 500);
      console.error('[contact] Wufoo submission failed', { status: response.status, upstreamMessage });
      return Response.json(
        { ok: false, error: '询盘暂时无法发送，请稍后重试或通过电话、微信联系我们。' },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error('[contact] Wufoo request failed', error instanceof Error ? error.message : 'Unknown error');
    return Response.json(
      { ok: false, error: '询盘暂时无法发送，请稍后重试或通过电话、微信联系我们。' },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, success: true });
};
