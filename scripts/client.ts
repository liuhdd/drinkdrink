import { cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Next.js 导出静态客户端，部署仍使用原 Worker 与 D1。 Next.js exports the client; deployment keeps the existing Worker and D1.
export async function buildClient(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Next.js 构建失败，退出码 ${code}`)));
  });
  await rm('dist/client', { recursive: true, force: true });
  await mkdir('dist/client', { recursive: true });
  await cp('out', 'dist/client', { recursive: true });
}
