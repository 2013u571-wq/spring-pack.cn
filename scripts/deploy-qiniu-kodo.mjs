import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qiniu from 'qiniu';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const requiredEnv = ['QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY', 'QINIU_BUCKET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const zoneId = process.env.QINIU_ZONE || 'z0';
const concurrency = Math.max(1, Number.parseInt(process.env.QINIU_UPLOAD_CONCURRENCY || '6', 10));
const zoneMap = {
  z0: qiniu.zone.Zone_z0,
  z1: qiniu.zone.Zone_z1,
  z2: qiniu.zone.Zone_z2,
  na0: qiniu.zone.Zone_na0,
  as0: qiniu.zone.Zone_as0,
  'cn-east-2': qiniu.zone.Zone_cn_east_2,
};

if (!zoneMap[zoneId]) {
  console.error(`Unsupported QINIU_ZONE "${zoneId}". Use z0, z1, z2, na0, as0, or cn-east-2.`);
  process.exit(1);
}

const mac = new qiniu.auth.digest.Mac(
  process.env.QINIU_ACCESS_KEY,
  process.env.QINIU_SECRET_KEY,
);
const config = new qiniu.conf.Config({ useHttpsDomain: true });
config.zone = zoneMap[zoneId];
const uploader = new qiniu.form_up.FormUploader(config);

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolutePath));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

function objectKey(filePath) {
  return path.relative(distDir, filePath).split(path.sep).join('/');
}

async function upload(filePath) {
  const key = objectKey(filePath);
  const policy = new qiniu.rs.PutPolicy({ scope: `${process.env.QINIU_BUCKET}:${key}` });
  const uploadToken = policy.uploadToken(mac);
  await uploader.putFile(uploadToken, key, filePath, new qiniu.form_up.PutExtra());
  return key;
}

async function runPool(items, worker, limit) {
  const running = new Set();
  for (const item of items) {
    const task = Promise.resolve().then(() => worker(item));
    running.add(task);
    task.then(() => running.delete(task), () => running.delete(task));
    if (running.size >= limit) await Promise.race(running);
  }
  await Promise.all(running);
}

function parseList(value) {
  return (value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

async function refreshCdn() {
  const urls = parseList(process.env.QINIU_CDN_REFRESH_URLS);
  const dirs = parseList(process.env.QINIU_CDN_REFRESH_DIRS);
  if (urls.length === 0 && dirs.length === 0) {
    console.log('CDN refresh skipped: no refresh URLs or directories configured.');
    return;
  }

  const manager = new qiniu.cdn.CdnManager(mac);
  await new Promise((resolve, reject) => {
    manager.refreshUrlsAndDirs(urls.length ? urls : null, dirs.length ? dirs : null, (error, body, info) => {
      if (error) return reject(error);
      if (info?.statusCode >= 400) {
        return reject(new Error(`CDN refresh failed with ${info.statusCode}: ${JSON.stringify(body)}`));
      }
      console.log(`CDN refresh requested: ${urls.length} URL(s), ${dirs.length} directory URL(s).`);
      resolve();
    });
  });
}

try {
  const files = await walkFiles(distDir);
  if (files.length === 0) throw new Error('dist is empty. Run npm run build first.');

  // Publish hashed assets before HTML so pages never reference assets that have not uploaded yet.
  files.sort((a, b) => Number(a.endsWith('.html')) - Number(b.endsWith('.html')));
  console.log(`Uploading ${files.length} files to qiniu://${process.env.QINIU_BUCKET} (${zoneId})...`);

  let uploaded = 0;
  await runPool(files, async (file) => {
    const key = await upload(file);
    uploaded += 1;
    if (uploaded % 50 === 0 || uploaded === files.length) {
      console.log(`Uploaded ${uploaded}/${files.length}: ${key}`);
    }
  }, concurrency);

  await refreshCdn();
  console.log(`Qiniu Kodo deployment complete: ${uploaded} files uploaded.`);
} catch (error) {
  console.error(error);
  process.exit(1);
}
