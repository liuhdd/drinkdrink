import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

// The original buildless files remain the editable frontend sources.
await mkdir('dist/client', { recursive: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
for (const file of ['index.html', 'app.mjs', 'domain.mjs', 'persistence.mjs', 'device-storage.mjs', 'server-storage.mjs', 'style.css']) {
  await cp(`dist/${file}`, `dist/client/${file}`);
}
await build({ entryPoints: ['server/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js' });
await rm('dist/server/retention.mjs', { force: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await writeFile('dist/server/wrangler.json', JSON.stringify({
  name: 'cheers-ledger', main: './index.js', compatibility_date: '2026-10-04',
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true },
  triggers: { crons: ['0 * * * *'] },
}, null, 2) + '\n');
console.log('Worker、前端和迁移构建完成');
