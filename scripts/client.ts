import { cp, mkdir } from 'node:fs/promises';
import { build, type BuildOptions } from 'esbuild';

export function clientBuildOptions(): BuildOptions {
  return { entryPoints: ['src/client/app.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/client/app.mjs', sourcemap: true };
}
export async function buildClient(): Promise<void> {
  await mkdir('dist/client', { recursive: true });
  for (const file of ['index.html', 'style.css']) await cp(`src/client/${file}`, `dist/client/${file}`);
  await build(clientBuildOptions());
}
