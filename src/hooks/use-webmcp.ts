'use client';

import { useEffect, useRef } from 'react';
import { field } from '@/shared/values';
import { objectInput, memberActionInput } from '@/shared/validation';
import { domainError } from '@/shared/errors';
import { leaderboard } from '@/shared/domain';
import type { ExternalValue, Ledger, Member } from '@/shared/types';

interface Tool { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute(input: ExternalValue): Promise<object>; }
interface ModelContext { registerTool(tool: Tool, options: { signal: AbortSignal }): Promise<void> | void; }
function isModelContext(value: ExternalValue): value is ModelContext { return typeof field(value, 'registerTool') === 'function'; }
type RecordMember = (id: string, action: string, quantity: number) => Promise<Member>;
export function useWebMcp(ledger: Ledger | null, record: RecordMember, report: (message: string) => void): void {
  const latest = useRef({ ledger, record });
  useEffect(() => { latest.current = { ledger, record }; }, [ledger, record]);
  useEffect(() => {
    const value = field(document, 'modelContext');
    if (!isModelContext(value)) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await value.registerTool({ name: 'read_current_drinking_session', title: '读取本局记账', description: 'Read the current session and leaderboard without changing data.', inputSchema: { type: 'object', properties: {}, additionalProperties: true }, annotations: { readOnlyHint: true, untrustedContentHint: true }, async execute(input) {
        objectInput(input, 'read_current_drinking_session');
        const current = latest.current.ledger;
        if (!current) throw domainError('记录尚未加载', 'WebMCP');
        const session = current.session;
        return { title: session.title, round: session.round, demo: session.demo, cupSize: session.cupSize, members: structuredClone(session.members), leaderboard: leaderboard(session) };
      } }, { signal: lifecycle.signal });
      if (lifecycle.signal.aborted) return;
      await value.registerTool({ name: 'record_member_drinking_action', title: '为成员记酒', description: 'Add or subtract pending units, or complete one cup. Uses the same saved ledger and undo history as the UI.', inputSchema: { type: 'object', properties: { memberId: { type: 'string' }, action: { type: 'string', enum: ['add', 'subtract', 'drink'] }, quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['memberId', 'action'], additionalProperties: true }, annotations: { readOnlyHint: false, untrustedContentHint: true }, async execute(input) {
        const current = latest.current.ledger;
        if (!current) throw domainError('记录尚未加载', 'WebMCP');
        const parsed = memberActionInput(input, current.step);
        return latest.current.record(parsed.memberId, parsed.action, parsed.quantity);
      } }, { signal: lifecycle.signal });
    };
    void register().catch(caught => { if (!lifecycle.signal.aborted) report(`自动操作功能注册失败：${caught instanceof Error ? caught.message : String(caught)}`); });
    const stop = () => lifecycle.abort();
    window.addEventListener('pagehide', stop, { once: true });
    return () => { lifecycle.abort(); window.removeEventListener('pagehide', stop); };
  }, [report]);
}
