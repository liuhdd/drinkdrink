import { decodeCharadesSnapshot, type CharadesNextRequest, type CharadesSnapshot } from '../shared/charades.ts';
import { context, isProblemCode, parseJson, problem } from '../shared/errors.ts';
import { retryableHttpError, retryOperation } from '../shared/retry.ts';
import { field } from '../shared/values.ts';
import { uuidInput } from '../shared/validation.ts';
import type { DeviceOptions, ExternalValue } from '../shared/types.ts';
import { DEVICE_KEY } from './server-storage.ts';
import { browserStorage } from './storage.ts';

export interface CharadesClient {
  load(): Promise<CharadesSnapshot>;
  next(current: CharadesSnapshot): Promise<CharadesSnapshot>;
}

export function createCharadesClient({ storage: suppliedStorage, fetch: request, randomUUID }: DeviceOptions): CharadesClient {
  const storage = browserStorage(suppliedStorage);
  const identify = (): string => {
    const stored = storage.getItem(DEVICE_KEY);
    const device = uuidInput(stored ?? randomUUID(), DEVICE_KEY);
    if (stored === null) storage.setItem(DEVICE_KEY, device);
    return device;
  };
  const call = async (path: string, method: string, body: CharadesNextRequest | null): Promise<CharadesSnapshot> => {
    const deviceId = identify();
    const requestId = body === null ? null : uuidInput(randomUUID(), 'X-Request-ID');
    const serialized = body === null ? null : JSON.stringify(body);
    const details = { ...context('charades API', null), request: { method, url: path, body: serialized, deviceId, requestId } };
    // 重试复用同一请求标识，响应丢失不会额外跳题。 Reuse the request identity so a lost response cannot skip a prompt.
    return retryOperation('charades API', async () => {
      let response: Response;
      try {
        response = await request(path, { method, cache: 'no-store', credentials: 'same-origin', headers: { 'X-Device-ID': deviceId, ...(requestId === null ? {} : { 'X-Request-ID': requestId, 'Content-Type': 'application/json' }) }, ...(serialized === null ? {} : { body: serialized }), signal: AbortSignal.timeout(15000) });
      } catch (caught) {
        const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
        throw problem('NETWORK', `无法连接题目服务（${method} ${path}）：${cause.message}。请检查网络后重新连接`, details, cause);
      }
      let text: string;
      try { text = await response.text(); }
      catch (caught) {
        const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
        throw problem('NETWORK', `读取题目服务响应失败（HTTP ${response.status}）：${cause.message}`, { ...details, status: response.status }, cause);
      }
      const responseDetails = { ...details, status: response.status, responseBody: text };
      let data: ExternalValue;
      try { data = parseJson(text, 'decode charades response'); }
      catch (caught) {
        if (!(caught instanceof Error)) throw caught;
        throw problem(response.ok ? 'RESPONSE' : 'HTTP', `题目服务响应格式无效（HTTP ${response.status}）：${caught.message}`, responseDetails, caught);
      }
      if (!response.ok) {
        const message = field(data, 'error'), code = field(data, 'code');
        if (typeof message !== 'string' || !message || !isProblemCode(code)) throw problem('RESPONSE', `题目服务错误响应缺少原因或有效错误码（HTTP ${response.status}）`, responseDetails, undefined);
        const path = field(field(data, 'details'), 'path');
        throw problem(code, `${method} ${details.request.url} 失败（HTTP ${response.status}）：${message}`, { ...responseDetails, path: typeof path === 'string' ? path : null }, undefined);
      }
      try { return decodeCharadesSnapshot(data); }
      catch (caught) {
        if (!(caught instanceof Error)) throw caught;
        throw problem('RESPONSE', `题目服务返回无效题目（HTTP ${response.status}）：${caught.message}`, responseDetails, caught);
      }
    }, retryableHttpError);
  };
  return {
    load: () => call('/api/charades', 'GET', null),
    next: current => call('/api/charades/next', 'POST', { revision: current.revision, generation: current.generation }),
  };
}
