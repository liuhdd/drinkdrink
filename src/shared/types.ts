export type ExternalValue = object | string | number | boolean | bigint | symbol | null | undefined;
export type Action = 'add' | 'subtract' | 'drink' | 'set';
export interface Profile { id: string; name: string; color: number; }
export interface Member extends Profile { cupSize: number; pending: number; consumed: number; cups: number; }
export interface LedgerEvent extends Profile { memberId: string; action: Action; amount: number; at: number; }
export interface Session { version: 1; title: string; cupSize: number; round: number; startedAt: number; demo: boolean; members: Member[]; events: LedgerEvent[]; endedAt?: number; }
export interface Archive { id: string; endedAt: number; session: Session; }
export interface Ledger { version: 2; session: Session; step: number; history: Archive[]; knownMembers: Profile[]; }
export interface SessionOptions { title: string; cupSize: number; members: readonly Profile[]; round: number; }
export interface Draft { name?: string | undefined; pending?: number | string; knownMemberId?: string | undefined; }
export interface NextOptions { title: string; cupSize: number; members: readonly Profile[]; }
export interface RankedMember extends Member { rank: number; }
export interface Snapshot { ledger: Ledger | null; revision: number; generation: string | null; }
export interface DeviceLedger { ledger: Ledger; revision: number; }
export interface SaveRequest { ledger: Ledger; revision: number; generation: string | null; }
export interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
export type LegacyStorage = Pick<StorageAdapter, 'getItem' | 'setItem'>;
export type FetchAdapter = (path: string, options: RequestInit) => Promise<Response>;
export interface DeviceOptions { storage: StorageAdapter; fetch: FetchAdapter; randomUUID: () => string; }
export interface DeviceClient { load(): Promise<Snapshot>; save(ledger: Ledger, revision: number, generation: string | null): Promise<Snapshot>; initialize(): Promise<Snapshot>; }
export interface MemberSeen { [memberId: string]: number; }
export interface StoredLedger { ledger: Ledger; memberSeen: MemberSeen; }
export interface RetainedLedger extends StoredLedger { cleanupAt: number; }
export interface DatabaseRow { device_id: string; data: string; revision: number; generation: string; updated_at: number; cleanup_at: number; }
export type SqlParameter = string | number | null;
export interface DatabaseStatement { bind(...params: SqlParameter[]): DatabaseStatement; first(): Promise<ExternalValue>; all(): Promise<{ results: ExternalValue[] }>; run(): Promise<{ meta: { changes: number } }>; }
export interface LedgerDatabase { prepare(sql: string): DatabaseStatement; }
export interface WorkerEnv { DB: LedgerDatabase; ASSETS: { fetch(request: Request): Promise<Response> | Response }; }
export interface Summary { title: string; round: number; cupSize: number; startedAt: number; endedAt: number; durationMs: number; totals: { members: number; consumed: number; cups: number; pending: number }; members: RankedMember[]; }
export interface SummaryImage { blob: Blob; filename: string; summary: Summary; }
export interface EventIdentity { id: string; at: number; }
export interface DraftIdentity { memberIds: readonly string[]; eventIds: readonly string[]; at: number; }
