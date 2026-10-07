import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { buildClient } from './client.ts';

// TypeScript 源码分别生成浏览器和 Worker 的 ESM 输出。 Build separate browser and Worker ESM outputs from TypeScript sources.
await rm('dist', { recursive: true, force: true });
await buildClient();
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await build({ entryPoints: ['src/server/worker.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js' });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await writeFile('dist/server/wrangler.json', JSON.stringify({
  name: 'cheers-ledger', main: './index.js', compatibility_date: '2026-10-04',
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true },
  triggers: { crons: ['0 * * * *'] },
}, null, 2) + '\n');
console.log({ event: 'build_complete', outputs: ['client', 'worker', 'migrations'] });
