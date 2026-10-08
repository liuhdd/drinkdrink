import type { NextConfig } from 'next';

// 静态导出由现有 Worker 提供资源与 API。 The existing Worker serves the static export and API.
const config: NextConfig = { output: 'export', poweredByHeader: false, devIndicators: false, outputFileTracingRoot: process.cwd() };
export default config;
