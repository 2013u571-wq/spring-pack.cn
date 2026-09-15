import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'dist', 'client');
const targetRoot = path.join(projectRoot, 'deploy', 'static');
const excludedTopLevel = new Set(['assets', 'robots.txt', 'sitemap.xml']);

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
  if (excludedTopLevel.has(entry.name)) continue;
  await cp(path.join(sourceRoot, entry.name), path.join(targetRoot, entry.name), {
    recursive: entry.isDirectory(),
  });
}

console.log('Prepared deploy/static from dist/client; public assets remain served from public/.');
