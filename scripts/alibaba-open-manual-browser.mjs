#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { ensureDir, SESSION_DIR } from './lib/alibaba-common.mjs';

const targetUrl = process.argv[2] || 'https://zhongkemeili.en.alibaba.com/';
const chromePath = process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

await ensureDir(SESSION_DIR);

const args = [
  `--user-data-dir=${SESSION_DIR}`,
  '--remote-debugging-port=9224',
  '--no-first-run',
  '--no-default-browser-check',
  targetUrl,
];

console.log('Opening manual Alibaba browser...');
console.log(`URL: ${targetUrl}`);
console.log(`Profile: ${SESSION_DIR}`);
console.log('DevTools endpoint: http://127.0.0.1:9224');
console.log('');
console.log('Use this browser manually: log in if needed, open the exact page, scroll until all details load, then run capture.');

const child = spawn(chromePath, args, {
  detached: true,
  stdio: 'ignore',
});

child.unref();
