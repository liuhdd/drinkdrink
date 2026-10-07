import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TestContext } from 'node:test';
import type { FetchAdapter } from '../src/shared/types.ts';

interface Exchange { method: string; requestId: string | null; body: string; }
async function proxyServer(t: TestContext, handle: (incoming: IncomingMessage, outgoing: ServerResponse, exchange: Exchange) => Promise<void>) {
  const exchanges: Exchange[] = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const exchange = { method: incoming.method ?? 'GET', requestId: incoming.headers['x-request-id']?.toString() ?? null, body: Buffer.concat(chunks).toString('utf8') };
      exchanges.push(exchange);
      await handle(incoming, outgoing, exchange);
    } catch (error) { outgoing.destroy(error instanceof Error ? error : new Error(String(error), { cause: error })); throw error; }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new TypeError('故障代理没有 TCP 地址');
  const origin = `http://127.0.0.1:${address.port}`;
  const request: FetchAdapter = (path, options) => fetch(origin + path, options);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return { request, exchanges };
}

// 故障代理真正断开 TCP 连接，不伪造应用响应。 Fault proxies close actual TCP connections without fabricating application responses.
export function disconnectingProxy(t: TestContext) {
  return proxyServer(t, async incoming => { incoming.socket.destroy(); });
}
export function lostSaveResponseProxy(t: TestContext, upstream: string) {
  let lost = false;
  return proxyServer(t, async (incoming, outgoing, exchange) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined && !['host', 'connection', 'content-length'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    if (exchange.method === 'PUT') headers.set('Origin', upstream);
    const response = await fetch(upstream + incoming.url, { method: exchange.method, headers, ...(exchange.body ? { body: exchange.body } : {}) });
    const body = Buffer.from(await response.arrayBuffer());
    if (exchange.method === 'PUT' && response.ok && !lost) { lost = true; incoming.socket.destroy(); return; }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(body);
  });
}

export function unavailableUpstreamProxy(t: TestContext, upstream: string) {
  return proxyServer(t, async (incoming, outgoing) => {
    try {
      const response = await fetch(upstream + incoming.url);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      outgoing.writeHead(503, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: error.message, cause: error.cause instanceof Error ? error.cause.message : null }));
    }
  });
}
