import { domainError, problem, context, isProblem, type Problem } from '../shared/errors.ts';
import { errorSnapshot } from '../shared/protocol.ts';
import { objectInput, memberActionInput } from '../shared/validation.ts';
import { draftIdentity } from './actions.ts';
import { recordAction as memberAction } from './actions.ts';
import type { Session, Profile, Ledger, DeviceClient, SummaryImage, ExternalValue, LedgerEvent } from '../shared/types.ts';
import { at, field, requireLedger } from '../shared/values.ts';
import { element, target, closest } from './elements.ts';
import { leaderboard, addMembers, validInteger, MAX_COUNT } from '../shared/domain.ts';
import { emptyLedger, restoreLedger, rememberMembers, availableMembers, startNextSession, finishSession, withLedgerSession } from '../shared/persistence.ts';
import { createDeviceClient, SYNC_KEY } from './server-storage.ts';
import { createSummaryImage } from './summary.ts';

interface BrowserState {
  localError: Problem | null;
  ledger: Ledger;
  session: Session;
  step: number;
  revision: number;
  generation: string | null;
  deviceClient: DeviceClient | undefined;
  ledgerEpoch: number;
  syncSequence: number;
  ready: boolean;
  saving: boolean;
  view: string;
  selectedMemberId: string | null;
  snapshots: Session[];
  editId: string | null;
  selectedColor: number;
  draftMemberIndex: number;
  toastTimer: ReturnType<typeof setTimeout> | undefined;
  summaryTarget: { session: Session; endedAt: number } | null | undefined;
  summaryImage: (SummaryImage & { url: string; file?: File }) | null | undefined;
  summarySequence: number;
}

// 每个浏览器连接持有独立的界面状态和外部操作。 Each browser connection owns its UI state and external effects.
export async function connectBrowser(): Promise<void> {
  const initialLedger = emptyLedger(Date.now());
  const state: BrowserState = {
    localError: null,
    ledger: initialLedger,
    session: initialLedger.session,
    step: 1,
    revision: 0,
    generation: null,
    deviceClient: undefined,
    ledgerEpoch: 0,
    syncSequence: 0,
    ready: false,
    saving: false,
    view: 'ledger',
    selectedMemberId: null,
    snapshots: [],
    editId: null,
    selectedColor: 0,
    draftMemberIndex: 0,
    toastTimer: undefined,
    summaryTarget: undefined,
    summaryImage: undefined,
    summarySequence: 0,
  };
  const paths = {
    wine: '<path d="M8 3h8l1 6a5 5 0 0 1-10 0l1-6ZM12 14v7m-4 0h8M7.5 8h9"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0V3Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v5m-4 2h8m-6-2h4"/>',
    settings: '<path d="m9 3 1-1h4l1 1 .5 2 2 1 2-.5 2 3-.5 2-1.5 1v2l1.5 1 .5 2-2 3-2-.5-2 1-.5 2-1 1h-4l-1-1-.5-2-2-1-2 .5-2-3 .5-2 1.5-1v-2L3 11l-.5-2 2-3 2 .5 2-1L9 3Z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 11.5-2l3 4M4 15l3 4a7 7 0 0 0 11.5-2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    cheers: '<path d="m4 3 6 2-2 6a3 3 0 0 1-6-2l2-6Zm2 10-2 6m-3-1 6 2M14 5l6-2 2 6a3 3 0 0 1-6 2l-2-6Zm4 8 2 6m-3 1 6-2M10 1l2 2 2-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5Z"/>',
    history: '<path d="M3 4v5h5M3 9a9 9 0 1 1 1 9m8-12v6l4 2"/>',
    undo: '<path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    'cloud-check': '<path d="M19 16a4 4 0 0 0 0-8 7 7 0 0 0-13-1 5 5 0 0 0 0 10m3-1 3 3 6-6"/>',
    x: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  };
  const icon = (name: string | undefined): string => {
    const path = Object.entries(paths).find(([key]) => key === name);
    if (!path) throw domainError(`图标名称无效：${name}`, 'render icon');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path[1]}</svg>`;
  };
  const elements = {
    '#integration-error': element(document, '#integration-error', HTMLElement),
    '#retry-local-storage': element(document, '#retry-local-storage', HTMLButtonElement),
    '#activity-list': element(document, '#activity-list', HTMLElement),
    '#add-members-dialog': element(document, '#add-members-dialog', HTMLDialogElement),
    '#add-members-error': element(document, '#add-members-error', HTMLElement),
    '#add-members-form': element(document, '#add-members-form', HTMLFormElement),
    '#add-members-submit': element(document, '#add-members-submit', HTMLButtonElement),
    '#append-member': element(document, '#append-member', HTMLButtonElement),
    '#color-picker': element(document, '#color-picker', HTMLElement),
    '#delete-member': element(document, '#delete-member', HTMLButtonElement),
    '#demo-badge': element(document, '#demo-badge', HTMLElement),
    '#draft-members': element(document, '#draft-members', HTMLElement),
    '#end-session-button': element(document, '#end-session-button', HTMLButtonElement),
    '#end-session-dialog': element(document, '#end-session-dialog', HTMLDialogElement),
    '#end-session-error': element(document, '#end-session-error', HTMLElement),
    '#end-session-form': element(document, '#end-session-form', HTMLFormElement),
    '#end-session-form button[type="submit"]': element(document, '#end-session-form button[type="submit"]', HTMLButtonElement),
    '#end-session-message': element(document, '#end-session-message', HTMLElement),
    '#finished-session': element(document, '#finished-session', HTMLElement),
    '#finished-session-message': element(document, '#finished-session-message', HTMLElement),
    '#history-count': element(document, '#history-count', HTMLElement),
    '#history-detail-dialog': element(document, '#history-detail-dialog', HTMLDialogElement),
    '#history-detail-events': element(document, '#history-detail-events', HTMLElement),
    '#history-detail-members': element(document, '#history-detail-members', HTMLElement),
    '#history-detail-meta': element(document, '#history-detail-meta', HTMLElement),
    '#history-detail-title': element(document, '#history-detail-title', HTMLElement),
    '#history-list': element(document, '#history-list', HTMLElement),
    '#history-panel': element(document, '#history-panel', HTMLElement),
    '#history-summary-button': element(document, '#history-summary-button', HTMLButtonElement),
    '#keep-members': element(document, '#keep-members', HTMLInputElement),
    '#leaderboard': element(document, '#leaderboard', HTMLElement),
    '#ledger-panel': element(document, '#ledger-panel', HTMLElement),
    '#load-message': element(document, '#load-message', HTMLElement),
    '#load-notice': element(document, '#load-notice', HTMLElement),
    '#member-controls': element(document, '#member-controls', HTMLElement),
    '#member-count': element(document, '#member-count', HTMLElement),
    '#member-dialog': element(document, '#member-dialog', HTMLDialogElement),
    '#member-error': element(document, '#member-error', HTMLElement),
    '#member-form': element(document, '#member-form', HTMLFormElement),
    '#member-name': element(document, '#member-name', HTMLInputElement),
    '#member-pending': element(document, '#member-pending', HTMLInputElement),
    '#members-grid': element(document, '#members-grid', HTMLElement),
    '#new-session-cup': element(document, '#new-session-cup', HTMLInputElement),
    '#new-session-name': element(document, '#new-session-name', HTMLInputElement),
    '#new-session-notice': element(document, '#new-session-notice', HTMLElement),
    '#ranking-live-label': element(document, '#ranking-live-label', HTMLElement),
    '#ranking-round': element(document, '#ranking-round', HTMLElement),
    '#remove-dialog': element(document, '#remove-dialog', HTMLDialogElement),
    '#remove-form': element(document, '#remove-form', HTMLFormElement),
    '#remove-message': element(document, '#remove-message', HTMLElement),
    '#retry-storage': element(document, '#retry-storage', HTMLButtonElement),
    '#save-status': element(document, '#save-status', HTMLElement),
    '#session-date': element(document, '#session-date', HTMLElement),
    '#session-dialog': element(document, '#session-dialog', HTMLDialogElement),
    '#session-error': element(document, '#session-error', HTMLElement),
    '#session-form': element(document, '#session-form', HTMLFormElement),
    '#session-round': element(document, '#session-round', HTMLElement),
    '#session-title': element(document, '#session-title', HTMLElement),
    '#settings-dialog': element(document, '#settings-dialog', HTMLDialogElement),
    '#settings-error': element(document, '#settings-error', HTMLElement),
    '#settings-finished-hint': element(document, '#settings-finished-hint', HTMLElement),
    '#settings-form': element(document, '#settings-form', HTMLFormElement),
    '#settings-name': element(document, '#settings-name', HTMLInputElement),
    '#settings-step': element(document, '#settings-step', HTMLInputElement),
    '#summary-dialog': element(document, '#summary-dialog', HTMLDialogElement),
    '#summary-download': element(document, '#summary-download', HTMLAnchorElement),
    '#summary-error': element(document, '#summary-error', HTMLElement),
    '#summary-preview': element(document, '#summary-preview', HTMLImageElement),
    '#summary-retry': element(document, '#summary-retry', HTMLButtonElement),
    '#summary-share': element(document, '#summary-share', HTMLButtonElement),
    '#summary-status': element(document, '#summary-status', HTMLElement),
    '#toast': element(document, '#toast', HTMLElement),
    '#undo-button': element(document, '#undo-button', HTMLButtonElement),
    '#workspace': element(document, '#workspace', HTMLElement),
    '.brand': element(document, '.brand', HTMLAnchorElement),
    '.page-heading': element(document, '.page-heading', HTMLElement),
  };
  const $ = <S extends keyof typeof elements>(selector: S): typeof elements[S] => elements[selector];
  const escapeHTML = (value: ExternalValue): string => String(value).replace(/[&<>"']/g, char => Object.entries({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }).find(([key]) => key === char)?.[1] ?? char);
  const colors = [
    { bg: '#f3e1d6', fg: '#8d533b', name: '陶土' },
    { bg: '#ebe5f0', fg: '#6f607d', name: '雾紫' },
    { bg: '#e3e9de', fg: '#586247', name: '鼠尾草' },
    { bg: '#e0e7ea', fg: '#4d6472', name: '灰蓝' },
    { bg: '#eee7d6', fg: '#786b48', name: '沙金' },
    { bg: '#efdde1', fg: '#885966', name: '烟粉' },
  ];
  const colorStyle = (color: number): string => `--avatar-bg:${at(colors, color).bg};--avatar-fg:${at(colors, color).fg}`;
  const avatar = (member: Pick<Profile, 'name' | 'color'>, extra: string): string => `<span class="avatar ${extra}" style="${colorStyle(member.color)}">${escapeHTML(at([...member.name], 0))}</span>`;
  const number = (value: number): string => Number(value).toLocaleString('zh-CN');

  function hydrateIcons(root: ParentNode) {
    root.querySelectorAll<HTMLElement>('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
  }

  function saveStatus(text: string, iconName: string) {
    $('#save-status').innerHTML = `${icon(iconName)}<span>${escapeHTML(text)}</span>`;
  }

  function reportBrowserError(error: Error): void {
    $('#integration-error').hidden = false;
    $('#integration-error').textContent = error.message;
    console.error(error);
  }
  window.addEventListener('error', event => { const cause = event.error instanceof Error ? event.error : new Error(event.message, { cause: event.error }); reportBrowserError(cause); });
  window.addEventListener('unhandledrejection', event => { const cause = event.reason instanceof Error ? event.reason : new Error(String(event.reason), { cause: event.reason }); reportBrowserError(cause); });
  $('#retry-local-storage').addEventListener('click', async () => {
    if (!state.ready || state.saving) { toast('请等待当前保存或加载完成后重试本地维护', { className: 'toast visible error', action: '' }); return; }
    state.saving = true;
    const button = $('#retry-local-storage');
    button.disabled = true;
    try {
      if (!state.deviceClient) throw domainError('记录客户端尚未初始化', 'repair local storage');
      const data = await state.deviceClient.repairLocalStorage();
      if (data.revision !== state.revision || data.generation !== state.generation) state.snapshots = [];
      applyLedger(requireLedger(data), data.revision, data.generation);
      state.localError = null;
      button.hidden = true;
      render();
      saveStatus('服务端记录与本地标记均已保存', 'cloud-check');
    } catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      saveStatus(`本地维护失败：${cause.message}`, 'info');
      toast(cause.message, { className: 'toast visible error', action: '' });
    } finally { state.saving = false; button.disabled = false; }
  });

  function applyLedger(value: Ledger, nextRevision: number, nextGeneration: string | null) {
    state.ledgerEpoch++;
    state.ledger = restoreLedger(value);
    state.session = state.ledger.session;
    state.step = state.ledger.step;
    state.revision = nextRevision;
    state.generation = nextGeneration;
  }

  async function saveToServer(value: Ledger, expectedRevision: number) {
    try {
      if (!state.deviceClient) throw domainError('记录客户端尚未初始化', 'app');
      return await state.deviceClient.save(value, expectedRevision, state.generation);
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      const conflict = error instanceof Error ? errorSnapshot(error) : null;
      if (conflict) {
        applyLedger(conflict.ledger ?? emptyLedger(Date.now()), conflict.revision, conflict.generation);
        state.snapshots = [];
        render();
        if ($('#add-members-dialog').open) updateMemberDrafts();
        throw error;
      }
      throw error;
    }
  }

  async function commitLedger(nextSession: Session, message: string, changes: Partial<Ledger>): Promise<boolean> {
    if (!state.ready || state.saving) {
      toast(state.saving ? '正在保存，请稍等' : '请先重新加载记录', { className: 'toast visible error', action: '' });
      return false;
    }
    if (state.session.endedAt !== undefined && nextSession.startedAt === state.session.startedAt && nextSession.round === state.session.round) {
      toast('本局已结束，请新开一局', { className: 'toast visible error', action: '' });
      return false;
    }
    const next = withLedgerSession(state.ledger, nextSession, changes);
    state.saving = true;
    saveStatus('正在保存…', 'cloud-check');
    try {
      const result = await saveToServer(next, state.revision);
      const data = result.snapshot;
      applyLedger(requireLedger(data), data.revision, data.generation);
      state.localError = result.localError;
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      saveStatus('未保存 · 请重试', 'info');
      const formError = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)?.querySelector('.form-error');
      if (formError) formError.textContent = error.message;
      toast(error.message, { className: 'toast visible error', action: '' });
      return false;
    } finally { state.saving = false; }
    $('#retry-local-storage').hidden = state.localError === null;
    saveStatus(state.localError?.message ?? '服务端已自动保存', state.localError ? 'info' : 'cloud-check');
    render();
    if (state.localError) toast(state.localError.message, { className: 'toast visible error', action: '' });
    else if (message) toast(message, { className: 'toast visible', action: '' });
    return true;
  }

  async function commitMember(nextSession: Session, message: string, changes: Partial<Ledger>): Promise<boolean> {
    const previous = state.session;
    if (!await commitLedger(nextSession, '', changes)) return false;
    state.snapshots = [...state.snapshots, structuredClone(previous)].slice(-30);
    render();
    toast(state.localError?.message ?? message, { className: state.localError ? 'toast visible error' : 'toast visible', action: '<button type="button" data-undo>撤销</button>' });
    return true;
  }

  function toast(message: string, { className, action }: { className: string; action: string }) {
    clearTimeout(state.toastTimer);
    const element = $('#toast');
    element.className = className;
    element.innerHTML = `<span>${escapeHTML(message)}</span>${action}`;
    state.toastTimer = setTimeout(() => { element.classList.remove('visible'); }, 4200);
  }

  async function undo() {
    if (!state.snapshots.length || state.saving) return;
    const previous = at(state.snapshots, state.snapshots.length - 1);
    if (await commitLedger(previous, '已撤销上一步', {})) {
      state.snapshots = state.snapshots.slice(0, -1);
      render();
    }
  }

  function render() {
    $('#session-title').textContent = state.session.title;
    $('#session-round').textContent = `第 ${String(state.session.round).padStart(2, '0')} 局`;
    $('#ranking-round').textContent = `第 ${String(state.session.round).padStart(2, '0')} 局`;
    $('#session-date').textContent = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }).format(state.session.startedAt);
    $('#demo-badge').hidden = !state.session.demo;
    const finished = state.session.endedAt !== undefined;
    $('.page-heading').classList.toggle('session-complete', finished);
    $('#ranking-live-label').textContent = finished ? '最终结果' : '实时更新';
    $('#end-session-button').hidden = state.session.demo || finished;
    $('#finished-session').hidden = !finished;
    if (finished) $('#finished-session-message').textContent = `${dateTime(state.session.endedAt ?? state.session.startedAt)} 结束 · 最终记录已保存，可生成分享图或新开一局。`;
    document.querySelectorAll<HTMLButtonElement>('[data-open="add-member"]').forEach(button => { button.hidden = finished; });
    $('#settings-form').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button[type="submit"]').forEach(control => { control.disabled = finished; });
    $('#settings-finished-hint').hidden = !finished;
    $('#member-count').textContent = String(state.session.members.length).padStart(2, '0');
    if (!state.session.members.some(member => member.id === state.selectedMemberId)) state.selectedMemberId = null;
    $('#members-grid').innerHTML = state.session.members.length ? state.session.members.map(member => {
      const name = escapeHTML(member.name);
      const id = escapeHTML(member.id);
      const selected = member.id === state.selectedMemberId;
      return `<button type="button" class="member-row${selected ? ' selected' : ''}" data-select-member="${id}" aria-pressed="${selected}" aria-label="选择${name}，待喝${member.pending}个" style="${colorStyle(member.color)}"><span class="member-row-identity">${avatar(member, '')}<span class="member-row-name">${name}</span>${selected ? `<span class="member-selected-mark">${icon('check')}</span>` : ''}</span><span class="member-row-count"><strong>${number(member.pending)}</strong><span>个</span></span></button>`;
    }).join('') : finished ? '<div class="empty-members"><h3>本局已结束</h3><p>这一局没有添加成员，可以新开一局继续记录。</p></div>' : `<div class="empty-members"><span data-icon="users"></span><h3>酒友到齐，就开局</h3><p>添加第一位成员，开始记录今晚的每一杯。</p><button class="button primary" data-open="add-member">${icon('plus')}添加成员</button></div>`;
    renderMemberControls();
    const ranked = leaderboard(state.session);
    const max = ranked[0]?.consumed || 1;
    $('#leaderboard').innerHTML = ranked.length ? ranked.map(member => `<div class="leader-row ${member.rank === 1 && member.consumed > 0 ? 'first' : ''}"><span class="rank-number">${member.rank === 1 && member.consumed > 0 ? icon('trophy') : String(member.rank).padStart(2, '0')}</span>${avatar(member, '')}<div class="leader-info"><div class="leader-name">${escapeHTML(member.name)}${member.rank === 1 && member.consumed > 0 ? '<span class="top-tag">本局领先</span>' : ''}</div><div class="leader-detail">${number(member.cups)} 杯 · 还待喝 ${number(member.pending)} 个</div><div class="leader-bar" aria-hidden="true"><span style="width:${member.consumed / max * 100}%"></span></div></div><div class="leader-score">${number(member.consumed)}<span>个</span></div></div>`).join('') : `<div class="ranking-empty">${icon('trophy')}<p>添加酒友后，排行从这里开始。</p></div>`;
    $('#activity-list').innerHTML = state.session.events.length ? state.session.events.slice(0, 5).map(event => {
      const text = event.action === 'drink' ? `喝完一杯 <em>扣减 ${event.amount} 个</em>` : event.action === 'add' ? `加了 <em>+${event.amount} 个</em>` : event.action === 'subtract' ? `减去 <em>−${event.amount} 个</em>` : `待喝调整为 <em>${event.amount} 个</em>`;
      return `<div class="activity-row">${avatar(event, 'activity-avatar')}<div class="activity-message"><strong>${escapeHTML(event.name)}</strong>${text}</div><time class="activity-time" datetime="${new Date(event.at).toISOString()}">${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(event.at)}</time></div>`;
    }).join('') : `<div class="activity-empty">${icon('history')}每次加减、喝完都会记在这里</div>`;
    $('#undo-button').disabled = finished || !state.snapshots.length;
    hydrateIcons($('#members-grid'));
    renderHistory();
  }

  const dateTime = (value: number): string => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);

  function renderHistory() {
    $('#history-count').textContent = String(state.ledger.history.length);
    $('#history-list').innerHTML = state.ledger.history.length ? state.ledger.history.map(entry => {
      const total = entry.session.members.reduce((sum, member) => sum + member.consumed, 0);
      return `<button type="button" class="history-row" data-history="${escapeHTML(entry.id)}"><span class="history-info"><strong>${escapeHTML(entry.session.title)}</strong><span>${escapeHTML(dateTime(entry.session.startedAt))} · 第 ${entry.session.round} 局</span><span>${entry.session.members.length} 位酒友 · 已喝 ${number(total)} 个</span></span><span class="history-open">查看${icon('chevron')}</span></button>`;
    }).join('') : '<div class="empty-members"><h3>还没有历史酒局</h3><p>新开一局时，上一局会自动保存到这里。</p><button class="button secondary" data-open="new-session">新开一局</button></div>';
  }

  function openHistory(id: string) {
    const entry = state.ledger.history.find(item => item.id === id);
    if (!entry) return;
    $('#history-detail-title').textContent = entry.session.title;
    $('#history-detail-meta').textContent = `${dateTime(entry.session.startedAt)} — ${dateTime(entry.endedAt)} · 第 ${entry.session.round} 局 · 1 杯 = ${entry.session.cupSize} 个`;
    $('#history-detail-members').innerHTML = leaderboard(entry.session).map(member => `<div class="history-member">${avatar(member, '')}<div><strong>${escapeHTML(member.name)}</strong><span>第 ${member.rank} 名 · ${number(member.cups)} 杯 · 待喝 ${number(member.pending)} 个</span></div><strong>${number(member.consumed)}<small> 个已喝</small></strong></div>`).join('') || '<p class="form-hint">这局没有成员。</p>';
    $('#history-detail-events').innerHTML = entry.session.events.map(event => {
      const text = { add: '加酒', subtract: '减酒', drink: '喝完一杯，扣减', set: '待喝调整为' }[event.action];
      return `<div class="activity-row"><div class="activity-message"><strong>${escapeHTML(event.name)}</strong>${text} ${event.amount} 个</div><time class="activity-time">${escapeHTML(dateTime(event.at))}</time></div>`;
    }).join('') || '<p class="form-hint">这局没有操作记录。</p>';
    $('#history-detail-dialog').showModal();
    $('#history-summary-button').dataset.summaryHistory = entry.id;
  }

  function clearSummaryImage() {
    if (state.summaryImage) URL.revokeObjectURL(state.summaryImage.url);
    state.summaryImage = null;
    $('#summary-preview').removeAttribute('src');
    $('#summary-preview').hidden = true;
    $('#summary-download').removeAttribute('href');
    $('#summary-download').hidden = true;
    $('#summary-share').hidden = true;
  }

  async function openSummary(source: Session, endedAt: number) {
    state.summaryTarget = { session: structuredClone(source), endedAt };
    const sequence = ++state.summarySequence;
    clearSummaryImage();
    $('#summary-status').textContent = '正在生成图片…';
    $('#summary-error').textContent = '';
    $('#summary-retry').hidden = true;
    if (!$('#summary-dialog').open) $('#summary-dialog').showModal();
    try {
      const result = await createSummaryImage(state.summaryTarget.session, endedAt);
      if (sequence !== state.summarySequence || !$('#summary-dialog').open) return;
      const url = URL.createObjectURL(result.blob);
      state.summaryImage = { ...result, url };
      $('#summary-preview').src = url;
      $('#summary-preview').hidden = false;
      $('#summary-download').href = url;
      $('#summary-download').download = result.filename;
      $('#summary-download').hidden = false;
      try {
        state.summaryImage.file = new File([result.blob], result.filename, { type: 'image/png' });
        $('#summary-share').hidden = !navigator.share || !navigator.canShare?.({ files: [state.summaryImage.file] });
      } catch (caught) {
        const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
        $('#summary-error').textContent = `图片已生成，但分享能力检查失败：${cause.message}`;
        console.error(problem('BROWSER', cause.message, context('prepare image sharing', null), cause));
      }
      $('#summary-status').textContent = '图片已生成，可下载或长按保存。';
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      console.error(problem('BROWSER', error.message, context('generate summary image', null), error));
      if (sequence !== state.summarySequence || !$('#summary-dialog').open) return;
      $('#summary-status').textContent = '图片暂未生成';
      $('#summary-error').textContent = error.message;
      $('#summary-retry').hidden = false;
    }
  }

  $('#summary-dialog').addEventListener('close', () => { state.summarySequence++; clearSummaryImage(); state.summaryTarget = null; });
  $('#summary-retry').addEventListener('click', () => { if (state.summaryTarget) openSummary(state.summaryTarget.session, state.summaryTarget.endedAt); });
  $('#summary-share').addEventListener('click', async () => {
    if (!state.summaryImage?.file) return;
    const button = $('#summary-share');
    button.disabled = true;
    try { await navigator.share({ files: [state.summaryImage.file], title: `${state.summaryImage.summary.title} · 酒局总结` }); }
    catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught }); $('#summary-error').textContent = `分享未完成（${error.name}）：${error.message}`; console.error(problem('BROWSER', error.message, context('share image', null), error)); }
    finally { button.disabled = false; }
  });

  function renderMemberControls() {
    const member = state.session.members.find(item => item.id === state.selectedMemberId);
    $('#member-controls').hidden = !member;
    if (!member) {
      $('#member-controls').innerHTML = '';
      return;
    }
    const name = escapeHTML(member.name);
    const id = escapeHTML(member.id);
    if (state.session.endedAt !== undefined) {
      $('#member-controls').innerHTML = `<div class="selected-member-heading"><h3 class="selected-member-name">${name}</h3><span class="selected-cup-setting">本局已结束</span></div><p class="form-hint">已喝 ${number(member.consumed)} 个 · ${number(member.cups)} 杯 · 剩余待喝 ${number(member.pending)} 个</p>`;
      return;
    }
    const cupSize = state.session.cupSize;
    const insufficient = member.pending < cupSize;
    const limitReached = member.consumed + cupSize > MAX_COUNT;
    const drinkTitle = insufficient ? `待喝不足一杯（${cupSize} 个）` : limitReached ? '已喝数量已达到上限' : `喝完一杯，扣减 ${cupSize} 个`;
    $('#member-controls').innerHTML = `<div class="selected-member-heading"><h3 class="selected-member-name">${name}</h3><span class="selected-cup-setting">1 杯 = ${cupSize} 个</span><button class="icon-button" data-edit="${id}" aria-label="编辑${name}">${icon('edit')}</button></div><div class="member-operation-buttons"><button class="button member-subtract" data-action="subtract" data-id="${id}" aria-label="给${name}减${state.step}个酒" ${member.pending < state.step ? 'disabled' : ''}>−${state.step}</button><button class="button member-add" data-action="add" data-id="${id}" aria-label="给${name}加${state.step}个酒" ${member.pending + state.step > MAX_COUNT ? 'disabled' : ''}>+${state.step}</button><button class="button member-drink" data-action="drink" data-id="${id}" title="${drinkTitle}" aria-label="${name}喝完一杯，扣减${cupSize}个" ${insufficient || limitReached ? 'disabled' : ''}>${icon('wine')}<span>−${cupSize}</span></button></div>`;
  }

  function switchView(nextView: string) {
    if (!['ledger', 'ranking', 'history'].includes(nextView)) return;
    state.view = nextView;
    $('#ledger-panel').hidden = state.view !== 'ledger';
    $('#workspace').classList.toggle('ranking-only', state.view === 'ranking');
    $('#workspace').hidden = !state.ready || state.view === 'history';
    $('#history-panel').hidden = !state.ready || state.view !== 'history';
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
  }

  function renderColors() {
    $('#color-picker').innerHTML = colors.map((color, index) => `<button type="button" class="color-choice" role="radio" aria-checked="${state.selectedColor === index}" aria-label="${color.name}" data-color="${index}" tabindex="${state.selectedColor === index ? 0 : -1}" style="${colorStyle(index)}">${state.selectedColor === index ? icon('check') : ''}</button>`).join('');
  }

  function updateMemberDrafts() {
    const rows = $('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row');
    $('#append-member').disabled = state.session.members.length + rows.length >= 30;
    $('#add-members-submit').textContent = `添加 ${rows.length} 位`;
    rows.forEach(row => { element(row, '[data-remove-draft]', HTMLButtonElement).disabled = rows.length === 1; });
    renderKnownMembers();
  }

  function renderKnownMembers() {
    const rows = [...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')];
    const available = availableMembers(state.ledger.knownMembers, state.session);
    for (const row of rows) {
      const otherRows = rows.filter(item => item !== row);
      const ids = new Set(otherRows.map(item => item.dataset.knownMemberId).filter(Boolean));
      const names = new Set(otherRows.map(item => element(item, '.draft-name', HTMLInputElement).value.trim().toLowerCase()).filter(Boolean));
      const choices = available.filter(member => !ids.has(member.id) && !names.has(member.name.toLowerCase()));
      element(row, '.draft-options', HTMLElement).innerHTML = choices.map(member => `<button type="button" class="draft-option" role="option" data-pick-member="${escapeHTML(member.id)}" aria-selected="${row.dataset.knownMemberId === member.id}"><span aria-hidden="true">${avatar(member, '')}</span><span>${escapeHTML(member.name)}</span></button>`).join('');
      element(row, '[data-toggle-members]', HTMLButtonElement).disabled = !choices.length;
      if (!choices.length) closeMemberOptions([row]);
    }
  }

  function closeMemberOptions(rows: readonly HTMLElement[]) {
    for (const row of rows) {
      element(row, '.draft-options', HTMLElement).hidden = true;
      element(row, '.draft-name', HTMLInputElement).setAttribute('aria-expanded', 'false');
    }
  }

  function openMemberOptions(row: HTMLElement) {
    closeMemberOptions([...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')]);
    const list = element(row, '.draft-options', HTMLElement);
    if (!list.children.length) return;
    const field = element(row, '.member-name-field', HTMLElement).getBoundingClientRect();
    const dialog = $('#add-members-dialog').getBoundingClientRect();
    const below = dialog.bottom - field.bottom - 16;
    const above = field.top - dialog.top - 16;
    const upwards = below < 88 && above > below;
    list.dataset.placement = upwards ? 'above' : 'below';
    list.style.maxHeight = `${Math.max(44, Math.min(180, upwards ? above : below))}px`;
    list.hidden = false;
    element(row, '.draft-name', HTMLInputElement).setAttribute('aria-expanded', 'true');
  }

  function appendMemberDraft() {
    if (state.session.members.length + $('#draft-members').children.length >= 30) return;
    const index = ++state.draftMemberIndex;
    const row = document.createElement('div');
    row.className = 'member-draft-row';
    row.innerHTML = `<label>昵称<span class="member-name-field"><input class="draft-name" id="draft-name-${index}" aria-label="成员${index}昵称" role="combobox" aria-autocomplete="none" aria-expanded="false" aria-controls="draft-options-${index}" maxlength="12" placeholder="输入或选择" required autocomplete="off" /><button type="button" class="draft-dropdown-toggle" data-toggle-members aria-label="选择成员${index}以前的酒友">${icon('chevron')}</button><span class="draft-options" id="draft-options-${index}" role="listbox" aria-label="成员${index}可选酒友" hidden></span></span></label><label>待喝（个）<input class="draft-pending" id="draft-pending-${index}" aria-label="成员${index}待喝数量" type="number" min="0" max="9999" step="1" value="0" required /></label><button type="button" class="icon-button remove-draft" data-remove-draft aria-label="移除成员${index}输入">${icon('x')}</button>`;
    $('#draft-members').append(row);
    updateMemberDrafts();
    return row;
  }

  function openAddMembers() {
    if (state.session.members.length >= 30) { toast('一局最多添加 30 位成员', { className: 'toast visible error', action: '' }); return; }
    $('#draft-members').innerHTML = '';
    $('#add-members-error').textContent = '';
    state.draftMemberIndex = 0;
    appendMemberDraft();
    $('#add-members-dialog').showModal();
  }

  function openMember(id: string) {
    const member = state.session.members.find(item => item.id === id);
    if (!member) return;
    state.editId = id;
    state.selectedColor = member.color;
    $('#member-name').value = member.name;
    $('#member-pending').value = String(member.pending);
    $('#member-error').textContent = '';
    renderColors();
    $('#member-dialog').showModal();
  }

  function openDialog(name: string) {
    if (!state.ready) { toast('请先重新加载记录', { className: 'toast visible error', action: '' }); return; }
    if (state.session.endedAt !== undefined && ['add-member', 'end-session'].includes(name)) { toast('本局已结束，请新开一局', { className: 'toast visible error', action: '' }); return; }
    if (name === 'add-member') return openAddMembers();
    if (name === 'settings') {
      $('#settings-name').value = state.session.title;
      $('#settings-step').value = String(state.step);
      $('#settings-error').textContent = '';
      $('#settings-dialog').showModal();
    } else if (name === 'end-session') {
      if (state.session.demo) { toast('请先新开一局，开始自己的记录', { className: 'toast visible', action: '' }); return; }
      const pending = state.session.members.reduce((total, member) => total + member.pending, 0);
      $('#end-session-message').textContent = `确认结束「${state.session.title}」？本局共 ${state.session.members.length} 位酒友，剩余待喝 ${number(pending)} 个。`;
      $('#end-session-error').textContent = '';
      $('#end-session-dialog').showModal();
    } else if (name === 'new-session') {
      $('#new-session-name').value = '今晚的酒局';
      $('#new-session-cup').value = String(state.session.cupSize);
      $('#keep-members').checked = !state.session.demo;
      $('#session-error').textContent = '';
      $('#new-session-notice').textContent = state.session.endedAt !== undefined ? '本局已保存到历史，不会重复归档。新局重新计数，添加过的酒友仍可快捷选择。' : '当前酒局会自动保存到「历史酒局」（体验酒局除外）。新局重新计数，添加过的酒友仍可快捷选择。';
      $('#session-dialog').showModal();
    }
  }

  document.addEventListener('click', async event => {
    if (!target(event).closest('.member-name-field')) closeMemberOptions([...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')]);
    const button = target(event).closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.view) switchView(button.dataset.view);
    if (button.dataset.history) openHistory(button.dataset.history);
    if (button.hasAttribute('data-summary-current') && state.session.endedAt !== undefined) openSummary(state.session, state.session.endedAt);
    if (button.dataset.summaryHistory) {
      const entry = state.ledger.history.find(item => item.id === button.dataset.summaryHistory);
      if (entry) openSummary(entry.session, entry.endedAt);
    }
    if (button.hasAttribute('data-retry-storage')) await initialize();
    if (button.hasAttribute('data-toggle-members')) {
      const row = closest(button, '.member-draft-row', HTMLElement);
      if (element(row, '.draft-options', HTMLElement).hidden) openMemberOptions(row); else closeMemberOptions([...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')]);
    }
    if (button.dataset.pickMember) {
      const row = closest(button, '.member-draft-row', HTMLElement);
      const profile = availableMembers(state.ledger.knownMembers, state.session).find(member => member.id === button.dataset.pickMember);
      if (!profile) return;
      row.dataset.knownMemberId = profile.id;
      element(row, '.draft-name', HTMLInputElement).value = profile.name;
      element(row, '.draft-name', HTMLInputElement).focus();
      closeMemberOptions([...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')]);
      updateMemberDrafts();
      $('#add-members-error').textContent = '';
    }
    if (button.dataset.open) openDialog(button.dataset.open);
    if (button.hasAttribute('data-close')) closest(button, 'dialog', HTMLDialogElement).close();
    if (button.hasAttribute('data-undo')) undo();
    if (button.dataset.selectMember) {
      state.selectedMemberId = button.dataset.selectMember;
      render();
      $('#members-grid').querySelector<HTMLButtonElement>(`[data-select-member="${CSS.escape(state.selectedMemberId)}"]`)?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 720px)').matches) {
        $('#member-controls').scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }
    }
    if (button.dataset.edit) openMember(button.dataset.edit);
    if (button.hasAttribute('data-add-draft')) (() => { const row = appendMemberDraft(); if (row) element(row, '.draft-name', HTMLInputElement).focus(); })();
    if (button.hasAttribute('data-remove-draft')) {
      const row = closest(button, '.member-draft-row', HTMLElement);
      const adjacent = row.nextElementSibling ?? row.previousElementSibling;
      row.remove();
      updateMemberDrafts();
      $('#add-members-error').textContent = '';
      if (adjacent) element(adjacent, '.draft-name', HTMLInputElement).focus(); else $('#append-member').focus();
    }
    if (button.dataset.color) { state.selectedColor = Number(button.dataset.color); renderColors(); $('#color-picker').querySelector<HTMLButtonElement>(`[data-color="${state.selectedColor}"]`)?.focus(); }
    if (button.dataset.action) {
      try {
        const id = button.dataset.id;
        if (!id) throw new TypeError('成员按钮缺少 ID');
        const member = state.session.members.find(item => item.id === id);
        if (!member) throw domainError('没有找到这位成员', 'app');
        const next = memberAction(state.session, id, button.dataset.action, state.step, { id: crypto.randomUUID(), at: Date.now() });
        const message = button.dataset.action === 'drink' ? `${member.name}喝完一杯，扣减 ${state.session.cupSize} 个` : `${member.name}待喝${button.dataset.action === 'add' ? '加' : '减'} ${state.step} 个`;
        await commitMember(next, message, {});
        $('#member-controls').querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(id)}"][data-action="${button.dataset.action}"]`)?.focus({ preventScroll: true });
      } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught }); toast(error.message, { className: 'toast visible error', action: '' }); }
    }
  });

  $('#draft-members').addEventListener('input', event => {
    if (!target(event).matches('.draft-name')) return;
    const row = target(event).closest('.member-draft-row');
    if (!(row instanceof HTMLElement)) return;
    delete row.dataset.knownMemberId;
    const profile = availableMembers(state.ledger.knownMembers, state.session).find(member => member.name.toLowerCase() === element(row, '.draft-name', HTMLInputElement).value.trim().toLowerCase());
    if (profile) row.dataset.knownMemberId = profile.id;
    renderKnownMembers();
    $('#add-members-error').textContent = '';
  });
  $('#draft-members').addEventListener('focusin', event => {
    if (target(event).matches('.draft-name')) openMemberOptions(closest(target(event), '.member-draft-row', HTMLElement));
    else if (!target(event).closest('.member-name-field')) closeMemberOptions([...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')]);
  });
  $('#draft-members').addEventListener('keydown', event => {
    const row = target(event).closest('.member-draft-row');
    if (!(row instanceof HTMLElement)) return;
    if (!row || !target(event).closest('.member-name-field')) return;
    if (event.key === 'Escape' && !element(row, '.draft-options', HTMLElement).hidden) {
      event.preventDefault();
      event.stopPropagation();
      element(row, '.draft-name', HTMLInputElement).focus();
      closeMemberOptions([...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')]);
    } else if (event.key === 'Tab') closeMemberOptions([...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')]);
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const list = element(row, '.draft-options', HTMLElement);
      if (list.hidden) openMemberOptions(row);
      const options = [...list.querySelectorAll<HTMLButtonElement>('button')];
      const current = options.findIndex(option => option === target(event));
      const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      options[next]?.focus();
    }
  });

  $('.brand').addEventListener('click', event => { event.preventDefault(); switchView('ledger'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#undo-button').addEventListener('click', undo);
  $('#color-picker').addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    state.selectedColor = (state.selectedColor + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : colors.length - 1)) % colors.length;
    renderColors();
    $('#color-picker').querySelector<HTMLButtonElement>(`[data-color="${state.selectedColor}"]`)?.focus();
  });

  $('#add-members-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const drafts = [...$('#draft-members').querySelectorAll<HTMLElement>('.member-draft-row')].map(row => ({ name: element(row, '.draft-name', HTMLInputElement).value, pending: element(row, '.draft-pending', HTMLInputElement).value, knownMemberId: row.dataset.knownMemberId }));
      const next = addMembers(state.session, drafts, state.ledger.knownMembers, draftIdentity(drafts.length));
      const added = next.members.slice(state.session.members.length);
      if (!await commitMember(next, `已添加 ${drafts.length} 位酒友`, { knownMembers: rememberMembers(state.ledger.knownMembers, added) })) return;
      state.selectedMemberId = at(added, 0).id;
      render();
      $('#add-members-dialog').close();
      switchView('ledger');
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught }); $('#add-members-error').textContent = error.message; }
  });

  $('#member-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const name = $('#member-name').value.trim();
      if (!name) throw domainError('请输入成员昵称', 'app');
      if (state.session.members.some(member => member.id !== state.editId && member.name.toLowerCase() === name.toLowerCase())) throw domainError('已有同名成员，请使用不同昵称', 'app');
      if (state.ledger.knownMembers.some(member => member.id !== state.editId && member.name.toLowerCase() === name.toLowerCase())) throw domainError('以前的酒友中已有此昵称，请使用不同昵称', 'app');
      const pending = validInteger($('#member-pending').value, '待喝数量', 0, 9999);
      const old = state.session.members.find(member => member.id === state.editId);
      if (!old) throw domainError('没有找到这位成员', 'app');
      const member = { ...old, name, color: state.selectedColor, pending, cupSize: state.session.cupSize };
      const next = { ...state.session, members: state.session.members.map(item => item.id === state.editId ? member : item) };
      state.selectedMemberId = member.id;
      if (pending !== old.pending) { const editedEvent: LedgerEvent = { id: crypto.randomUUID(), memberId: member.id, name, color: state.selectedColor, action: 'set', amount: pending, at: Date.now() }; next.events = [editedEvent, ...state.session.events].slice(0, 80); }
      if (!await commitMember(next, `已更新${name}`, { knownMembers: rememberMembers(state.ledger.knownMembers, [member]) })) return;
      $('#member-dialog').close();
      switchView('ledger');
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught }); $('#member-error').textContent = error.message; }
  });

  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const title = $('#settings-name').value.trim();
      if (!title) throw domainError('请输入酒局名称', 'app');
      const nextStep = validInteger($('#settings-step').value, '快捷加减数量', 1, 99);
      if (!await commitLedger({ ...state.session, title }, '酒局设置已保存', { step: nextStep })) return;
      state.snapshots = state.snapshots.map(snapshot => ({ ...snapshot, title }));
      $('#settings-dialog').close();
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught }); $('#settings-error').textContent = error.message; }
  });

  $('#end-session-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.saving) return;
    const button = $('#end-session-form button[type="submit"]');
    button.disabled = true;
    try {
      const next = finishSession(state.ledger, Date.now(), crypto.randomUUID());
      if (!await commitLedger(next.session, '本局已结束，最终记录已保存', next)) return;
      state.snapshots = [];
      render();
      $('#end-session-dialog').close();
      if (state.session.endedAt === undefined) throw domainError('结束时间未保存', 'app');
      openSummary(state.session, state.session.endedAt);
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught }); $('#end-session-error').textContent = error.message; }
    finally { button.disabled = false; }
  });

  $('#session-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const title = $('#new-session-name').value.trim();
      if (!title) throw domainError('请输入酒局名称', 'app');
      const cupSize = validInteger($('#new-session-cup').value, '每杯数量', 1, 99);
      const next = startNextSession(state.ledger, { title, cupSize, members: ($('#keep-members').checked) ? state.ledger.session.members : [] }, Date.now(), crypto.randomUUID());
      if (!await commitLedger(next.session, state.session.endedAt !== undefined ? '新一局开始了' : '上一局已保存，新一局开始了', next)) return;
      state.snapshots = [];
      state.selectedMemberId = null;
      render();
      $('#settings-dialog').close();
      $('#session-dialog').close();
      switchView('ledger');
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught }); $('#session-error').textContent = error.message; }
  });

  $('#delete-member').addEventListener('click', () => {
    const member = state.session.members.find(item => item.id === state.editId);
    if (!member) return;
    $('#member-dialog').close();
    $('#remove-message').textContent = `确认移除「${member.name}」？这位成员将从本局排行榜移除，操作记录仍然保留。`;
    $('#remove-dialog').showModal();
  });
  $('#remove-form').addEventListener('submit', async event => {
    event.preventDefault();
    const member = state.session.members.find(item => item.id === state.editId);
    if (!member) return;
    if (!await commitMember({ ...state.session, members: state.session.members.filter(item => item.id !== state.editId) }, `已移除${member.name}`, {})) return;
    $('#remove-dialog').close();
  });

  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (target(event) !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });

  async function syncFromServer() {
    if (!state.ready || state.saving || document.querySelector('dialog[open]')) return;
    const sequence = ++state.syncSequence;
    const epoch = state.ledgerEpoch;
    try {
      if (!state.deviceClient) throw domainError('记录客户端尚未初始化', 'app');
      const data = await state.deviceClient.load();
      if (sequence !== state.syncSequence || epoch !== state.ledgerEpoch || state.saving || document.querySelector('dialog[open]')) return;
      if (data.revision === state.revision && data.generation === state.generation) { saveStatus(state.localError?.message ?? '服务端已自动保存', state.localError ? 'info' : 'cloud-check'); return; }
      if (data.generation === state.generation && data.revision < state.revision) return;
      applyLedger(data.ledger ?? emptyLedger(Date.now()), data.revision, data.generation);
      state.snapshots = [];
      render();
      saveStatus(state.localError?.message ?? (data.ledger ? '服务端已自动保存' : '旧数据已自动清理'), state.localError ? 'info' : 'cloud-check');
      toast(data.ledger ? '已同步服务端记录' : '超过 30 天的记录已自动清理', { className: 'toast visible', action: '' });
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      console.error(error);
      if (sequence === state.syncSequence && epoch === state.ledgerEpoch && !state.saving) saveStatus(`同步失败：${error.message}`, 'info');
    }
  }

  window.addEventListener('storage', event => {
    if (event.key === SYNC_KEY) syncFromServer();
  });
  window.addEventListener('focus', syncFromServer);
  window.addEventListener('online', syncFromServer);
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', syncFromServer));
  setInterval(() => { if (!document.hidden) syncFromServer(); }, 60_000);

  async function initialize() {
    if (state.saving) return;
    state.ready = false;
    $('#load-notice').hidden = false;
    $('#load-message').textContent = '正在加载已保存的酒局…';
    $('#retry-storage').hidden = true;
    $('#workspace').hidden = true;
    $('#history-panel').hidden = true;
    $('#finished-session').hidden = true;
    $('#end-session-button').hidden = true;
    saveStatus('正在加载…', 'cloud-check');
    try {
      state.deviceClient ??= createDeviceClient({ storage: localStorage, fetch: globalThis.fetch, randomUUID: () => crypto.randomUUID() });
      const client = state.deviceClient;
      const load = () => client.initialize();
      const result = navigator.locks?.request ? await navigator.locks.request('cheers-device-initialize', load) : await load();
      const data = result.snapshot;
      state.localError = result.localError;
      $('#retry-local-storage').hidden = state.localError === null;
      applyLedger(requireLedger(data), data.revision, data.generation);
      state.ready = true;
      state.snapshots = [];
      render();
      switchView(state.view);
      $('#load-notice').hidden = true;
      saveStatus(state.localError?.message ?? '服务端已自动保存', state.localError ? 'info' : 'cloud-check');
    } catch (caught) { const error = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      state.ready = false;
      $('#load-message').textContent = error.message;
      $('#retry-storage').hidden = false;
      saveStatus('记录未加载', 'info');
    }
  }

  hydrateIcons(document);
  await initialize();

  interface Tool { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute(input: ExternalValue): Promise<object>; }
  interface ModelContext { registerTool(tool: Tool, options: { signal: AbortSignal }): Promise<void> | void; }
  function isModelContext(value: ExternalValue): value is ModelContext { return typeof field(value, 'registerTool') === 'function'; }
  const modelContextValue = field(document, 'modelContext');
  const modelContext = isModelContext(modelContextValue) ? modelContextValue : null;
  // 按能力检测注册 WebMCP 工具，与页面共用记账操作。 Feature-detected WebMCP tools share the exact accounting actions used by the UI.
  if (modelContext?.registerTool) {
    const lifecycle = new AbortController();
    const register = async (tool: Tool): Promise<void> => {
      try { await modelContext.registerTool(tool, { signal: lifecycle.signal }); }
      catch (caught) {
        const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
        throw problem('BROWSER', `自动操作功能注册失败（${tool.name}）：${cause.message}`, context('register browser tool', tool.name), cause);
      }
    };
    await register({
      name: 'read_current_drinking_session', title: '读取本局记账',
      description: 'Read the current session, per-member pending counts, consumed counts, cup sizes and leaderboard. No state changes.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input: ExternalValue) {
        objectInput(input, 'read_current_drinking_session');
        if (!state.ready) throw domainError('记录尚未加载', 'app');
        return { title: state.session.title, round: state.session.round, demo: state.session.demo, cupSize: state.session.cupSize, members: structuredClone(state.session.members), leaderboard: leaderboard(state.session) };
      },
    });
    await register({
      name: 'record_member_drinking_action', title: '为成员记酒',
      description: 'Add or subtract pending drink units for one existing member, or complete one cup using the current round’s shared cup size. Changes the visible ledger and current-round leaderboard; supports UI undo.',
      inputSchema: { type: 'object', properties: { memberId: { type: 'string' }, action: { type: 'string', enum: ['add', 'subtract', 'drink'] }, quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['memberId', 'action'], additionalProperties: true },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input: ExternalValue) {
        const parsed = memberActionInput(input, state.step);
        const next = memberAction(state.session, parsed.memberId, parsed.action, parsed.quantity, { id: crypto.randomUUID(), at: Date.now() });
        state.selectedMemberId = parsed.memberId;
        if (!await commitMember(next, '已完成记账', {})) throw domainError('记账未完成，请检查保存状态后重试', 'app');
        const saved = state.session.members.find(member => member.id === parsed.memberId);
        if (!saved) throw domainError('没有找到这位成员', 'app');
        return structuredClone(saved);
      },
    });
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  }

}

await connectBrowser();
