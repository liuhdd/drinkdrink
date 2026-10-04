import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

// The original buildless files remain the editable frontend sources.
await mkdir('dist/client', { recursive: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
for (const file of ['index.html', 'app.mjs', 'domain.mjs', 'persistence.mjs', 'style.css']) {
  await cp(`dist/${file}`, `dist/client/${file}`);
}
const worker = (await readFile('server/worker.mjs', 'utf8')).replace("'../dist/persistence.mjs'", "'../client/persistence.mjs'");
await writeFile('dist/server/index.js', worker);
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
await writeFile('dist/server/wrangler.json', JSON.stringify({
  name: 'cheers-ledger', main: './index.js', compatibility_date: '2026-10-04',
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true },
}, null, 2) + '\n');
console.log('Worker、前端和迁移构建完成');
