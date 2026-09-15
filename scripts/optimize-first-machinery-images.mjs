import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const projectRoot = process.cwd();
const assetRoot = path.join(projectRoot, 'public/assets/first-machinery');
const backupRoot = path.join('/private/tmp', `first-machinery-image-backup-${Date.now()}`);
const targetBytes = 300 * 1024;
const imagePattern = /\.(png|jpe?g|webp|avif)$/i;
const textPattern = /\.(astro|css|js|jsx|ts|tsx|json|md|html|mjs|cjs)$/i;

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, predicate = () => true, output = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (file.includes('/node_modules/') || file.includes('/dist/') || file.includes('/.astro/')) continue;
      await walk(file, predicate, output);
    } else if (predicate(file)) {
      output.push(file);
    }
  }
  return output;
}

async function backup(file) {
  const relative = path.relative(projectRoot, file);
  const target = path.join(backupRoot, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(file, target);
}

async function imageInfo(file) {
  const [stat, metadata] = await Promise.all([fs.stat(file), sharp(file).metadata()]);
  return { size: stat.size, width: metadata.width ?? 0, height: metadata.height ?? 0 };
}

function encoder(pipeline, ext, quality) {
  if (ext === '.jpg' || ext === '.jpeg') return pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
  if (ext === '.webp') return pipeline.webp({ quality, effort: 5 });
  if (ext === '.avif') return pipeline.avif({ quality: Math.max(42, quality - 18), effort: 5 });
  return pipeline.webp({ quality, effort: 5 });
}

async function renderOptimized(input, output, ext, maxEdge, quality) {
  const metadata = await sharp(input).metadata();
  let pipeline = sharp(input).rotate();
  if ((metadata.width ?? 0) > maxEdge || (metadata.height ?? 0) > maxEdge) {
    pipeline = pipeline.resize({
      width: maxEdge,
      height: maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  await encoder(pipeline, ext, quality).toFile(output);
}

async function optimizeExisting(file) {
  const ext = path.extname(file).toLowerCase();
  const before = await imageInfo(file);
  const tooLarge = before.size > targetBytes;
  const tooManyPixels = before.width > 2200 || before.height > 2200 || before.width * before.height > 3_000_000;
  if (!tooLarge && !tooManyPixels) return { changed: false, before, after: before };

  await backup(file);

  const temp = `${file}.optimized`;
  const attempts = [
    { maxEdge: 1600, quality: 78 },
    { maxEdge: 1440, quality: 66 },
    { maxEdge: 1280, quality: 60 },
  ];

  let best = null;
  for (const attempt of attempts) {
    await renderOptimized(file, temp, ext, attempt.maxEdge, attempt.quality);
    const info = await imageInfo(temp);
    if (!best || info.size < best.info.size) {
      if (best) await fs.unlink(best.file).catch(() => {});
      best = { file: `${temp}.${attempt.maxEdge}.${attempt.quality}`, info };
      await fs.rename(temp, best.file);
    } else {
      await fs.unlink(temp).catch(() => {});
    }
    if (info.size <= targetBytes) break;
  }

  await fs.rename(best.file, file);
  const after = await imageInfo(file);
  return { changed: true, before, after };
}

async function updateTextReferences(pngFiles) {
  const basenames = [...new Set(pngFiles.map((file) => path.basename(file, path.extname(file))))];
  const textFiles = await walk(projectRoot, (file) => textPattern.test(file));
  let changedFiles = 0;

  for (const file of textFiles) {
    let source = await fs.readFile(file, 'utf8');
    let next = source;
    for (const base of basenames) {
      next = next.replaceAll(`${base}.png`, `${base}.webp`);
    }
    if (next !== source) {
      await fs.writeFile(file, next);
      changedFiles += 1;
    }
  }

  return changedFiles;
}

const imageFiles = await walk(assetRoot, (file) => imagePattern.test(file));
const pngFiles = imageFiles.filter((file) => file.toLowerCase().endsWith('.png'));

let convertedPngs = 0;
let reusedWebps = 0;
for (const png of pngFiles) {
  const webp = png.replace(/\.png$/i, '.webp');
  await backup(png);
  if (await exists(webp)) {
    reusedWebps += 1;
  } else {
    await renderOptimized(png, webp, '.webp', 1800, 82);
    convertedPngs += 1;
  }
  await fs.unlink(png);
}

const changedReferenceFiles = await updateTextReferences(pngFiles);
const refreshedFiles = await walk(assetRoot, (file) => imagePattern.test(file));

let optimized = 0;
let totalBefore = 0;
let totalAfter = 0;
const stillLarge = [];

for (const file of refreshedFiles) {
  const before = await imageInfo(file);
  const result = await optimizeExisting(file);
  if (result.changed) optimized += 1;
  totalBefore += before.size;
  totalAfter += result.after.size;
  if (result.after.size > targetBytes) {
    stillLarge.push({
      file: path.relative(assetRoot, file),
      kb: Math.round(result.after.size / 1024),
      width: result.after.width,
      height: result.after.height,
    });
  }
}

stillLarge.sort((a, b) => b.kb - a.kb);

console.log(JSON.stringify({
  backupRoot,
  pngFiles: pngFiles.length,
  convertedPngs,
  reusedWebps,
  changedReferenceFiles,
  optimized,
  totalSavedKb: Math.round((totalBefore - totalAfter) / 1024),
  stillOver300Kb: stillLarge.length,
  largestRemaining: stillLarge.slice(0, 20),
}, null, 2));
