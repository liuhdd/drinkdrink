import { memberAction, leaderboard, addMembers, validInteger, MAX_COUNT } from './domain.mjs?v=20261007-summary';
import { emptyLedger, restoreLedger, rememberMembers, availableMembers, startNextSession, finishSession } from './persistence.mjs?v=20261007-summary';
import { createDeviceClient, SYNC_KEY } from './server-storage.mjs?v=20261006-server';
import { createSummaryImage } from './summary.mjs?v=20261007-summary';

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
const icon = name => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const colors = [
  { bg: '#f3e1d6', fg: '#8d533b', name: '陶土' },
  { bg: '#ebe5f0', fg: '#6f607d', name: '雾紫' },
  { bg: '#e3e9de', fg: '#586247', name: '鼠尾草' },
  { bg: '#e0e7ea', fg: '#4d6472', name: '灰蓝' },
  { bg: '#eee7d6', fg: '#786b48', name: '沙金' },
  { bg: '#efdde1', fg: '#885966', name: '烟粉' },
];
const colorStyle = color => `--avatar-bg:${colors[color]?.bg || colors[0].bg};--avatar-fg:${colors[color]?.fg || colors[0].fg}`;
const avatar = (member, extra = '') => `<span class="avatar ${extra}" style="${colorStyle(member.color)}">${escapeHTML([...member.name][0] || '友')}</span>`;
const number = value => Number(value).toLocaleString('zh-CN');
let ledger = emptyLedger();
let session = ledger.session;
let step = 1;
let revision = 0;
let generation = null;
let deviceClient;
let ledgerEpoch = 0;
let syncSequence = 0;
let ready = false;
let saving = false;
let view = 'ledger';
let selectedMemberId = null;
let snapshots = [];
let editId = null;
let selectedColor = 0;
let draftMemberIndex = 0;
let toastTimer;
let summaryTarget;
let summaryImage;
let summarySequence = 0;

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
}

function saveStatus(text, error = false) {
  $('#save-status').innerHTML = `${icon(error ? 'info' : 'cloud-check')}<span>${escapeHTML(text)}</span>`;
}

function applyLedger(value, nextRevision, nextGeneration) {
  ledgerEpoch++;
  ledger = restoreLedger(value);
  session = ledger.session;
  step = ledger.step;
  revision = nextRevision;
  generation = nextGeneration;
}

async function saveToServer(value, expectedRevision) {
  try {
    return await deviceClient.save(value, expectedRevision, generation);
  } catch (error) {
    if (error.data) {
      applyLedger(error.data.ledger ?? emptyLedger(), error.data.revision, error.data.generation);
      snapshots = [];
      render();
      if ($('#add-members-dialog').open) updateMemberDrafts();
      throw error;
    }
    throw error;
  }
}

async function commit(nextSession, message, undoable = true, changes = {}) {
  if (!ready || saving) {
    toast(saving ? '正在保存，请稍等' : '请先重新加载记录', { error: true });
    return false;
  }
  if (session.endedAt !== undefined && nextSession.startedAt === session.startedAt && nextSession.round === session.round) {
    toast('本局已结束，请新开一局', { error: true });
    return false;
  }
  const next = {
    ...ledger, ...changes, session: nextSession,
    knownMembers: rememberMembers(changes.knownMembers ?? ledger.knownMembers, nextSession.demo ? [] : nextSession.members),
  };
  saving = true;
  saveStatus('正在保存…');
  try {
    const data = await saveToServer(next, revision);
    if (undoable) snapshots = [...snapshots, structuredClone(session)].slice(-30);
    applyLedger(data.ledger, data.revision, data.generation);
  } catch (error) {
    saveStatus('未保存 · 请重试', true);
    const formError = [...document.querySelectorAll('dialog[open]')].at(-1)?.querySelector('.form-error');
    if (formError) formError.textContent = error.message || '保存失败，请重试';
    toast(error.message || '保存失败，请重试', { error: true });
    return false;
  } finally { saving = false; }
  saveStatus('服务端已自动保存');
  render();
  if (message) toast(message, { undo: undoable });
  return true;
}

function toast(message, { undo = false, error = false } = {}) {
  clearTimeout(toastTimer);
  const element = $('#toast');
  element.className = `toast visible${error ? ' error' : ''}`;
  element.innerHTML = `<span>${escapeHTML(message)}</span>${undo && snapshots.length ? '<button type="button" data-undo>撤销</button>' : ''}`;
  toastTimer = setTimeout(() => { element.classList.remove('visible'); }, 4200);
}

async function undo() {
  if (!snapshots.length || saving) return;
  const previous = snapshots.at(-1);
  if (await commit(previous, '已撤销上一步', false)) {
    snapshots.pop();
    render();
  }
}

function render() {
  $('#session-title').textContent = session.title;
  $('#session-round').textContent = `第 ${String(session.round).padStart(2, '0')} 局`;
  $('#ranking-round').textContent = `第 ${String(session.round).padStart(2, '0')} 局`;
  $('#session-date').textContent = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }).format(session.startedAt);
  $('#demo-badge').hidden = !session.demo;
  const finished = session.endedAt !== undefined;
  $('.page-heading').classList.toggle('session-complete', finished);
  $('#ranking-live-label').textContent = finished ? '最终结果' : '实时更新';
  $('#end-session-button').hidden = session.demo || finished;
  $('#finished-session').hidden = !finished;
  if (finished) $('#finished-session-message').textContent = `${dateTime(session.endedAt)} 结束 · 最终记录已保存，可生成分享图或新开一局。`;
  document.querySelectorAll('[data-open="add-member"]').forEach(button => { button.hidden = finished; });
  $('#settings-form').querySelectorAll('input, button[type="submit"]').forEach(control => { control.disabled = finished; });
  $('#settings-finished-hint').hidden = !finished;
  $('#member-count').textContent = String(session.members.length).padStart(2, '0');
  if (!session.members.some(member => member.id === selectedMemberId)) selectedMemberId = null;
  $('#members-grid').innerHTML = session.members.length ? session.members.map(member => {
    const name = escapeHTML(member.name);
    const id = escapeHTML(member.id);
    const selected = member.id === selectedMemberId;
    return `<button type="button" class="member-row${selected ? ' selected' : ''}" data-select-member="${id}" aria-pressed="${selected}" aria-label="选择${name}，待喝${member.pending}个" style="${colorStyle(member.color)}"><span class="member-row-identity">${avatar(member)}<span class="member-row-name">${name}</span>${selected ? `<span class="member-selected-mark">${icon('check')}</span>` : ''}</span><span class="member-row-count"><strong>${number(member.pending)}</strong><span>个</span></span></button>`;
  }).join('') : finished ? '<div class="empty-members"><h3>本局已结束</h3><p>这一局没有添加成员，可以新开一局继续记录。</p></div>' : `<div class="empty-members"><span data-icon="users"></span><h3>酒友到齐，就开局</h3><p>添加第一位成员，开始记录今晚的每一杯。</p><button class="button primary" data-open="add-member">${icon('plus')}添加成员</button></div>`;
  renderMemberControls();
  const ranked = leaderboard(session);
  const max = ranked[0]?.consumed || 1;
  $('#leaderboard').innerHTML = ranked.length ? ranked.map(member => `<div class="leader-row ${member.rank === 1 && member.consumed > 0 ? 'first' : ''}"><span class="rank-number">${member.rank === 1 && member.consumed > 0 ? icon('trophy') : String(member.rank).padStart(2, '0')}</span>${avatar(member)}<div class="leader-info"><div class="leader-name">${escapeHTML(member.name)}${member.rank === 1 && member.consumed > 0 ? '<span class="top-tag">本局领先</span>' : ''}</div><div class="leader-detail">${number(member.cups)} 杯 · 还待喝 ${number(member.pending)} 个</div><div class="leader-bar" aria-hidden="true"><span style="width:${member.consumed / max * 100}%"></span></div></div><div class="leader-score">${number(member.consumed)}<span>个</span></div></div>`).join('') : `<div class="ranking-empty">${icon('trophy')}<p>添加酒友后，排行从这里开始。</p></div>`;
  $('#activity-list').innerHTML = session.events.length ? session.events.slice(0, 5).map(event => {
    const text = event.action === 'drink' ? `喝完一杯 <em>扣减 ${event.amount} 个</em>` : event.action === 'add' ? `加了 <em>+${event.amount} 个</em>` : event.action === 'subtract' ? `减去 <em>−${event.amount} 个</em>` : `待喝调整为 <em>${event.amount} 个</em>`;
    return `<div class="activity-row">${avatar(event, 'activity-avatar')}<div class="activity-message"><strong>${escapeHTML(event.name)}</strong>${text}</div><time class="activity-time" datetime="${new Date(event.at).toISOString()}">${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(event.at)}</time></div>`;
  }).join('') : `<div class="activity-empty">${icon('history')}每次加减、喝完都会记在这里</div>`;
  $('#undo-button').disabled = finished || !snapshots.length;
  hydrateIcons($('#members-grid'));
  renderHistory();
}

const dateTime = value => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);

function renderHistory() {
  $('#history-count').textContent = ledger.history.length;
  $('#history-list').innerHTML = ledger.history.length ? ledger.history.map(entry => {
    const total = entry.session.members.reduce((sum, member) => sum + member.consumed, 0);
    return `<button type="button" class="history-row" data-history="${escapeHTML(entry.id)}"><span class="history-info"><strong>${escapeHTML(entry.session.title)}</strong><span>${escapeHTML(dateTime(entry.session.startedAt))} · 第 ${entry.session.round} 局</span><span>${entry.session.members.length} 位酒友 · 已喝 ${number(total)} 个</span></span><span class="history-open">查看${icon('chevron')}</span></button>`;
  }).join('') : '<div class="empty-members"><h3>还没有历史酒局</h3><p>新开一局时，上一局会自动保存到这里。</p><button class="button secondary" data-open="new-session">新开一局</button></div>';
}

function openHistory(id) {
  const entry = ledger.history.find(item => item.id === id);
  if (!entry) return;
  $('#history-detail-title').textContent = entry.session.title;
  $('#history-detail-meta').textContent = `${dateTime(entry.session.startedAt)} — ${dateTime(entry.endedAt)} · 第 ${entry.session.round} 局 · 1 杯 = ${entry.session.cupSize} 个`;
  $('#history-detail-members').innerHTML = leaderboard(entry.session).map(member => `<div class="history-member">${avatar(member)}<div><strong>${escapeHTML(member.name)}</strong><span>第 ${member.rank} 名 · ${number(member.cups)} 杯 · 待喝 ${number(member.pending)} 个</span></div><strong>${number(member.consumed)}<small> 个已喝</small></strong></div>`).join('') || '<p class="form-hint">这局没有成员。</p>';
  $('#history-detail-events').innerHTML = entry.session.events.map(event => {
    const text = { add: '加酒', subtract: '减酒', drink: '喝完一杯，扣减', set: '待喝调整为' }[event.action];
    return `<div class="activity-row"><div class="activity-message"><strong>${escapeHTML(event.name)}</strong>${text} ${event.amount} 个</div><time class="activity-time">${escapeHTML(dateTime(event.at))}</time></div>`;
  }).join('') || '<p class="form-hint">这局没有操作记录。</p>';
  $('#history-detail-dialog').showModal();
  $('#history-summary-button').dataset.summaryHistory = entry.id;
}

function clearSummaryImage() {
  if (summaryImage) URL.revokeObjectURL(summaryImage.url);
  summaryImage = null;
  $('#summary-preview').removeAttribute('src');
  $('#summary-preview').hidden = true;
  $('#summary-download').removeAttribute('href');
  $('#summary-download').hidden = true;
  $('#summary-share').hidden = true;
}

async function openSummary(source, endedAt) {
  summaryTarget = { session: structuredClone(source), endedAt };
  const sequence = ++summarySequence;
  clearSummaryImage();
  $('#summary-status').textContent = '正在生成图片…';
  $('#summary-error').textContent = '';
  $('#summary-retry').hidden = true;
  if (!$('#summary-dialog').open) $('#summary-dialog').showModal();
  try {
    const result = await createSummaryImage(summaryTarget.session, endedAt);
    if (sequence !== summarySequence || !$('#summary-dialog').open) return;
    const url = URL.createObjectURL(result.blob);
    summaryImage = { ...result, url };
    $('#summary-preview').src = url;
    $('#summary-preview').hidden = false;
    $('#summary-download').href = url;
    $('#summary-download').download = result.filename;
    $('#summary-download').hidden = false;
    try {
      summaryImage.file = new File([result.blob], result.filename, { type: 'image/png' });
      $('#summary-share').hidden = !navigator.share || !navigator.canShare?.({ files: [summaryImage.file] });
    } catch { /* Download and long-press saving remain available. */ }
    $('#summary-status').textContent = '图片已生成，可下载或长按保存。';
  } catch (error) {
    if (sequence !== summarySequence || !$('#summary-dialog').open) return;
    $('#summary-status').textContent = '图片暂未生成';
    $('#summary-error').textContent = error.message || '图片生成失败，请重试';
    $('#summary-retry').hidden = false;
  }
}

$('#summary-dialog').addEventListener('close', () => { summarySequence++; clearSummaryImage(); summaryTarget = null; });
$('#summary-retry').addEventListener('click', () => { if (summaryTarget) openSummary(summaryTarget.session, summaryTarget.endedAt); });
$('#summary-share').addEventListener('click', async () => {
  if (!summaryImage?.file) return;
  const button = $('#summary-share');
  button.disabled = true;
  try { await navigator.share({ files: [summaryImage.file], title: `${summaryImage.summary.title} · 酒局总结` }); }
  catch (error) { if (error.name !== 'AbortError') $('#summary-error').textContent = '暂时无法直接分享，请下载或长按保存图片后分享。'; }
  finally { button.disabled = false; }
});

function renderMemberControls() {
  const member = session.members.find(item => item.id === selectedMemberId);
  $('#member-controls').hidden = !member;
  if (!member) {
    $('#member-controls').innerHTML = '';
    return;
  }
  const name = escapeHTML(member.name);
  const id = escapeHTML(member.id);
  if (session.endedAt !== undefined) {
    $('#member-controls').innerHTML = `<div class="selected-member-heading"><h3 class="selected-member-name">${name}</h3><span class="selected-cup-setting">本局已结束</span></div><p class="form-hint">已喝 ${number(member.consumed)} 个 · ${number(member.cups)} 杯 · 剩余待喝 ${number(member.pending)} 个</p>`;
    return;
  }
  const cupSize = session.cupSize;
  const insufficient = member.pending < cupSize;
  const limitReached = member.consumed + cupSize > MAX_COUNT;
  const drinkTitle = insufficient ? `待喝不足一杯（${cupSize} 个）` : limitReached ? '已喝数量已达到上限' : `喝完一杯，扣减 ${cupSize} 个`;
  $('#member-controls').innerHTML = `<div class="selected-member-heading"><h3 class="selected-member-name">${name}</h3><span class="selected-cup-setting">1 杯 = ${cupSize} 个</span><button class="icon-button" data-edit="${id}" aria-label="编辑${name}">${icon('edit')}</button></div><div class="member-operation-buttons"><button class="button member-subtract" data-action="subtract" data-id="${id}" aria-label="给${name}减${step}个酒" ${member.pending < step ? 'disabled' : ''}>−${step}</button><button class="button member-add" data-action="add" data-id="${id}" aria-label="给${name}加${step}个酒" ${member.pending + step > MAX_COUNT ? 'disabled' : ''}>+${step}</button><button class="button member-drink" data-action="drink" data-id="${id}" title="${drinkTitle}" aria-label="${name}喝完一杯，扣减${cupSize}个" ${insufficient || limitReached ? 'disabled' : ''}>${icon('wine')}<span>−${cupSize}</span></button></div>`;
}

function switchView(nextView) {
  if (!['ledger', 'ranking', 'history'].includes(nextView)) return;
  view = nextView;
  $('#ledger-panel').hidden = view !== 'ledger';
  $('#workspace').classList.toggle('ranking-only', view === 'ranking');
  $('#workspace').hidden = !ready || view === 'history';
  $('#history-panel').hidden = !ready || view !== 'history';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}

function renderColors() {
  $('#color-picker').innerHTML = colors.map((color, index) => `<button type="button" class="color-choice" role="radio" aria-checked="${selectedColor === index}" aria-label="${color.name}" data-color="${index}" tabindex="${selectedColor === index ? 0 : -1}" style="${colorStyle(index)}">${selectedColor === index ? icon('check') : ''}</button>`).join('');
}

function updateMemberDrafts() {
  const rows = $('#draft-members').querySelectorAll('.member-draft-row');
  $('#append-member').disabled = session.members.length + rows.length >= 30;
  $('#add-members-submit').textContent = `添加 ${rows.length} 位`;
  rows.forEach(row => { row.querySelector('[data-remove-draft]').disabled = rows.length === 1; });
  renderKnownMembers();
}

function renderKnownMembers() {
  const rows = [...$('#draft-members').children];
  const available = availableMembers(ledger.knownMembers, session);
  for (const row of rows) {
    const otherRows = rows.filter(item => item !== row);
    const ids = new Set(otherRows.map(item => item.dataset.knownMemberId).filter(Boolean));
    const names = new Set(otherRows.map(item => item.querySelector('.draft-name').value.trim().toLowerCase()).filter(Boolean));
    const choices = available.filter(member => !ids.has(member.id) && !names.has(member.name.toLowerCase()));
    row.querySelector('.draft-options').innerHTML = choices.map(member => `<button type="button" class="draft-option" role="option" data-pick-member="${escapeHTML(member.id)}" aria-selected="${row.dataset.knownMemberId === member.id}"><span aria-hidden="true">${avatar(member)}</span><span>${escapeHTML(member.name)}</span></button>`).join('');
    row.querySelector('[data-toggle-members]').disabled = !choices.length;
    if (!choices.length) closeMemberOptions(row);
  }
}

function closeMemberOptions(onlyRow) {
  const rows = onlyRow ? [onlyRow] : [...$('#draft-members').children];
  for (const row of rows) {
    row.querySelector('.draft-options').hidden = true;
    row.querySelector('.draft-name').setAttribute('aria-expanded', 'false');
  }
}

function openMemberOptions(row) {
  closeMemberOptions();
  const list = row.querySelector('.draft-options');
  if (!list.children.length) return;
  const field = row.querySelector('.member-name-field').getBoundingClientRect();
  const dialog = $('#add-members-dialog').getBoundingClientRect();
  const below = dialog.bottom - field.bottom - 16;
  const above = field.top - dialog.top - 16;
  const upwards = below < 88 && above > below;
  list.dataset.placement = upwards ? 'above' : 'below';
  list.style.maxHeight = `${Math.max(44, Math.min(180, upwards ? above : below))}px`;
  list.hidden = false;
  row.querySelector('.draft-name').setAttribute('aria-expanded', 'true');
}

function appendMemberDraft() {
  if (session.members.length + $('#draft-members').children.length >= 30) return;
  const index = ++draftMemberIndex;
  const row = document.createElement('div');
  row.className = 'member-draft-row';
  row.innerHTML = `<label>昵称<span class="member-name-field"><input class="draft-name" id="draft-name-${index}" aria-label="成员${index}昵称" role="combobox" aria-autocomplete="none" aria-expanded="false" aria-controls="draft-options-${index}" maxlength="12" placeholder="输入或选择" required autocomplete="off" /><button type="button" class="draft-dropdown-toggle" data-toggle-members aria-label="选择成员${index}以前的酒友">${icon('chevron')}</button><span class="draft-options" id="draft-options-${index}" role="listbox" aria-label="成员${index}可选酒友" hidden></span></span></label><label>待喝（个）<input class="draft-pending" id="draft-pending-${index}" aria-label="成员${index}待喝数量" type="number" min="0" max="9999" step="1" value="0" required /></label><button type="button" class="icon-button remove-draft" data-remove-draft aria-label="移除成员${index}输入">${icon('x')}</button>`;
  $('#draft-members').append(row);
  updateMemberDrafts();
  return row;
}

function openAddMembers() {
  if (session.members.length >= 30) { toast('一局最多添加 30 位成员', { error: true }); return; }
  $('#draft-members').innerHTML = '';
  $('#add-members-error').textContent = '';
  draftMemberIndex = 0;
  appendMemberDraft();
  $('#add-members-dialog').showModal();
}

function openMember(id) {
  const member = session.members.find(item => item.id === id);
  if (!member) return;
  editId = id;
  selectedColor = member.color;
  $('#member-name').value = member.name;
  $('#member-pending').value = member.pending;
  $('#member-error').textContent = '';
  renderColors();
  $('#member-dialog').showModal();
}

function openDialog(name) {
  if (!ready) { toast('请先重新加载记录', { error: true }); return; }
  if (session.endedAt !== undefined && ['add-member', 'end-session'].includes(name)) { toast('本局已结束，请新开一局', { error: true }); return; }
  if (name === 'add-member') return openAddMembers();
  if (name === 'settings') {
    $('#settings-name').value = session.title;
    $('#settings-step').value = step;
    $('#settings-error').textContent = '';
    $('#settings-dialog').showModal();
  } else if (name === 'end-session') {
    if (session.demo) { toast('请先新开一局，开始自己的记录'); return; }
    const pending = session.members.reduce((total, member) => total + member.pending, 0);
    $('#end-session-message').textContent = `确认结束「${session.title}」？本局共 ${session.members.length} 位酒友，剩余待喝 ${number(pending)} 个。`;
    $('#end-session-error').textContent = '';
    $('#end-session-dialog').showModal();
  } else if (name === 'new-session') {
    $('#new-session-name').value = '今晚的酒局';
    $('#new-session-cup').value = session.cupSize;
    $('#keep-members').checked = !session.demo;
    $('#session-error').textContent = '';
    $('#new-session-notice').textContent = session.endedAt !== undefined ? '本局已保存到历史，不会重复归档。新局重新计数，添加过的酒友仍可快捷选择。' : '当前酒局会自动保存到「历史酒局」（体验酒局除外）。新局重新计数，添加过的酒友仍可快捷选择。';
    $('#session-dialog').showModal();
  }
}

document.addEventListener('click', async event => {
  if (!event.target.closest('.member-name-field')) closeMemberOptions();
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.view) switchView(button.dataset.view);
  if (button.dataset.history) openHistory(button.dataset.history);
  if (button.hasAttribute('data-summary-current') && session.endedAt !== undefined) openSummary(session, session.endedAt);
  if (button.dataset.summaryHistory) {
    const entry = ledger.history.find(item => item.id === button.dataset.summaryHistory);
    if (entry) openSummary(entry.session, entry.endedAt);
  }
  if (button.hasAttribute('data-retry-storage')) await initialize();
  if (button.hasAttribute('data-toggle-members')) {
    const row = button.closest('.member-draft-row');
    if (row.querySelector('.draft-options').hidden) openMemberOptions(row); else closeMemberOptions();
  }
  if (button.dataset.pickMember) {
    const row = button.closest('.member-draft-row');
    const profile = availableMembers(ledger.knownMembers, session).find(member => member.id === button.dataset.pickMember);
    if (!profile) return;
    row.dataset.knownMemberId = profile.id;
    row.querySelector('.draft-name').value = profile.name;
    row.querySelector('.draft-name').focus();
    closeMemberOptions();
    updateMemberDrafts();
    $('#add-members-error').textContent = '';
  }
  if (button.dataset.open) openDialog(button.dataset.open);
  if (button.hasAttribute('data-close')) button.closest('dialog').close();
  if (button.hasAttribute('data-undo')) undo();
  if (button.dataset.selectMember) {
    selectedMemberId = button.dataset.selectMember;
    render();
    $('#members-grid').querySelector(`[data-select-member="${CSS.escape(selectedMemberId)}"]`)?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 720px)').matches) {
      $('#member-controls').scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }
  if (button.dataset.edit) openMember(button.dataset.edit);
  if (button.hasAttribute('data-add-draft')) appendMemberDraft()?.querySelector('.draft-name').focus();
  if (button.hasAttribute('data-remove-draft')) {
    const row = button.closest('.member-draft-row');
    const adjacent = row.nextElementSibling ?? row.previousElementSibling;
    row.remove();
    updateMemberDrafts();
    $('#add-members-error').textContent = '';
    (adjacent?.querySelector('.draft-name') ?? $('#append-member')).focus();
  }
  if (button.dataset.color) { selectedColor = Number(button.dataset.color); renderColors(); $('#color-picker').querySelector(`[data-color="${selectedColor}"]`).focus(); }
  if (button.dataset.action) {
    try {
      const member = session.members.find(item => item.id === button.dataset.id);
      const next = memberAction(session, button.dataset.id, button.dataset.action, step);
      const message = button.dataset.action === 'drink' ? `${member.name}喝完一杯，扣减 ${session.cupSize} 个` : `${member.name}待喝${button.dataset.action === 'add' ? '加' : '减'} ${step} 个`;
      await commit(next, message);
      $('#member-controls').querySelector(`[data-id="${CSS.escape(button.dataset.id)}"][data-action="${button.dataset.action}"]`)?.focus({ preventScroll: true });
    } catch (error) { toast(error.message, { error: true }); }
  }
});

$('#draft-members').addEventListener('input', event => {
  if (!event.target.matches('.draft-name')) return;
  const row = event.target.closest('.member-draft-row');
  delete row.dataset.knownMemberId;
  const profile = availableMembers(ledger.knownMembers, session).find(member => member.name.toLowerCase() === event.target.value.trim().toLowerCase());
  if (profile) row.dataset.knownMemberId = profile.id;
  renderKnownMembers();
  $('#add-members-error').textContent = '';
});
$('#draft-members').addEventListener('focusin', event => {
  if (event.target.matches('.draft-name')) openMemberOptions(event.target.closest('.member-draft-row'));
  else if (!event.target.closest('.member-name-field')) closeMemberOptions();
});
$('#draft-members').addEventListener('keydown', event => {
  const row = event.target.closest('.member-draft-row');
  if (!row || !event.target.closest('.member-name-field')) return;
  if (event.key === 'Escape' && !row.querySelector('.draft-options').hidden) {
    event.preventDefault();
    event.stopPropagation();
    row.querySelector('.draft-name').focus();
    closeMemberOptions();
  } else if (event.key === 'Tab') closeMemberOptions();
  else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const list = row.querySelector('.draft-options');
    if (list.hidden) openMemberOptions(row);
    const options = [...list.children];
    const current = options.indexOf(event.target);
    const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
    options[next]?.focus();
  }
});

$('.brand').addEventListener('click', event => { event.preventDefault(); switchView('ledger'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#undo-button').addEventListener('click', undo);
$('#color-picker').addEventListener('keydown', event => {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  selectedColor = (selectedColor + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : colors.length - 1)) % colors.length;
  renderColors();
  $('#color-picker').querySelector(`[data-color="${selectedColor}"]`).focus();
});

$('#add-members-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const drafts = [...$('#draft-members').querySelectorAll('.member-draft-row')].map(row => ({ name: row.querySelector('.draft-name').value, pending: row.querySelector('.draft-pending').value, knownMemberId: row.dataset.knownMemberId }));
    const next = addMembers(session, drafts, ledger.knownMembers);
    const added = next.members.slice(session.members.length);
    if (!await commit(next, `已添加 ${drafts.length} 位酒友`, true, { knownMembers: rememberMembers(ledger.knownMembers, added) })) return;
    selectedMemberId = added[0].id;
    render();
    $('#add-members-dialog').close();
    switchView('ledger');
  } catch (error) { $('#add-members-error').textContent = error.message; }
});

$('#member-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const name = $('#member-name').value.trim();
    if (!name) throw new Error('请输入成员昵称');
    if (session.members.some(member => member.id !== editId && member.name.toLowerCase() === name.toLowerCase())) throw new Error('已有同名成员，请使用不同昵称');
    if (ledger.knownMembers.some(member => member.id !== editId && member.name.toLowerCase() === name.toLowerCase())) throw new Error('以前的酒友中已有此昵称，请使用不同昵称');
    const pending = validInteger($('#member-pending').value, '待喝数量');
    const old = session.members.find(member => member.id === editId);
    if (!old) throw new Error('没有找到这位成员');
    const member = { ...old, name, color: selectedColor, pending, cupSize: session.cupSize };
    const next = { ...session, members: session.members.map(item => item.id === editId ? member : item) };
    selectedMemberId = member.id;
    if (pending !== old.pending) next.events = [{ id: crypto.randomUUID(), memberId: member.id, name, color: selectedColor, action: 'set', amount: pending, at: Date.now() }, ...session.events].slice(0, 80);
    if (!await commit(next, `已更新${name}`, true, { knownMembers: rememberMembers(ledger.knownMembers, [member]) })) return;
    $('#member-dialog').close();
    switchView('ledger');
  } catch (error) { $('#member-error').textContent = error.message; }
});

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const title = $('#settings-name').value.trim();
    if (!title) throw new Error('请输入酒局名称');
    const nextStep = validInteger($('#settings-step').value, '快捷加减数量', 1, 99);
    if (!await commit({ ...session, title }, '酒局设置已保存', false, { step: nextStep })) return;
    snapshots = snapshots.map(snapshot => ({ ...snapshot, title }));
    $('#settings-dialog').close();
  } catch (error) { $('#settings-error').textContent = error.message; }
});

$('#end-session-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  const button = $('#end-session-form button[type="submit"]');
  button.disabled = true;
  try {
    const next = finishSession(ledger);
    if (!await commit(next.session, '本局已结束，最终记录已保存', false, next)) return;
    snapshots = [];
    render();
    $('#end-session-dialog').close();
    openSummary(session, session.endedAt);
  } catch (error) { $('#end-session-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#session-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const title = $('#new-session-name').value.trim();
    if (!title) throw new Error('请输入酒局名称');
    const cupSize = validInteger($('#new-session-cup').value, '每杯数量', 1, 99);
    const next = startNextSession(ledger, { title, cupSize, keepMembers: $('#keep-members').checked });
    if (!await commit(next.session, session.endedAt !== undefined ? '新一局开始了' : '上一局已保存，新一局开始了', false, next)) return;
    snapshots = [];
    selectedMemberId = null;
    render();
    $('#settings-dialog').close();
    $('#session-dialog').close();
    switchView('ledger');
  } catch (error) { $('#session-error').textContent = error.message; }
});

$('#delete-member').addEventListener('click', () => {
  const member = session.members.find(item => item.id === editId);
  if (!member) return;
  $('#member-dialog').close();
  $('#remove-message').textContent = `确认移除「${member.name}」？这位成员将从本局排行榜移除，操作记录仍然保留。`;
  $('#remove-dialog').showModal();
});
$('#remove-form').addEventListener('submit', async event => {
  event.preventDefault();
  const member = session.members.find(item => item.id === editId);
  if (!member) return;
  if (!await commit({ ...session, members: session.members.filter(item => item.id !== editId) }, `已移除${member.name}`)) return;
  $('#remove-dialog').close();
});

document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
});

async function syncFromServer() {
  if (!ready || saving || document.querySelector('dialog[open]')) return;
  const sequence = ++syncSequence;
  const epoch = ledgerEpoch;
  try {
    const data = await deviceClient.load();
    if (sequence !== syncSequence || epoch !== ledgerEpoch || saving || document.querySelector('dialog[open]')) return;
    if (data.revision === revision && data.generation === generation) { saveStatus('服务端已自动保存'); return; }
    if (data.generation === generation && data.revision < revision) return;
    applyLedger(data.ledger ?? emptyLedger(), data.revision, data.generation);
    snapshots = [];
    render();
    saveStatus(data.ledger ? '服务端已自动保存' : '旧数据已自动清理');
    toast(data.ledger ? '已同步服务端记录' : '超过 30 天的记录已自动清理');
  } catch { if (sequence === syncSequence && epoch === ledgerEpoch && !saving) saveStatus('服务端暂时无法连接', true); }
}

window.addEventListener('storage', event => {
  if (event.key === SYNC_KEY) syncFromServer();
});
window.addEventListener('focus', syncFromServer);
window.addEventListener('online', syncFromServer);
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', syncFromServer));
setInterval(() => { if (!document.hidden) syncFromServer(); }, 60_000);

async function initialize() {
  if (saving) return;
  ready = false;
  $('#load-notice').hidden = false;
  $('#load-message').textContent = '正在加载已保存的酒局…';
  $('#retry-storage').hidden = true;
  $('#workspace').hidden = true;
  $('#history-panel').hidden = true;
  $('#finished-session').hidden = true;
  $('#end-session-button').hidden = true;
  saveStatus('正在加载…');
  try {
    deviceClient ??= createDeviceClient({ storage: localStorage });
    const load = () => deviceClient.initialize();
    const data = navigator.locks?.request ? await navigator.locks.request('cheers-device-initialize', load) : await load();
    applyLedger(data.ledger, data.revision, data.generation);
    ready = true;
    snapshots = [];
    render();
    switchView(view);
    $('#load-notice').hidden = true;
    saveStatus('服务端已自动保存');
  } catch (error) {
    ready = false;
    $('#load-message').textContent = error.message || '记录无法加载，请检查网络和浏览器存储权限后重试';
    $('#retry-storage').hidden = false;
    saveStatus('记录未加载', true);
  }
}

hydrateIcons();
await initialize();

// Feature-detected WebMCP tools share the exact accounting actions used by the UI.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const register = tool => {
    try { Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); } catch { /* The UI remains available if the proposed API is unsupported. */ }
  };
  register({
    name: 'read_current_drinking_session', title: '读取本局记账',
    description: 'Read the current session, per-member pending counts, consumed counts, cup sizes and leaderboard. No state changes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('请输入空对象');
      if (!ready) throw new Error('记录尚未加载');
      return { title: session.title, round: session.round, demo: session.demo, cupSize: session.cupSize, members: structuredClone(session.members), leaderboard: leaderboard(session) };
    },
  });
  register({
    name: 'record_member_drinking_action', title: '为成员记酒',
    description: 'Add or subtract pending drink units for one existing member, or complete one cup using the current round’s shared cup size. Changes the visible ledger and current-round leaderboard; supports UI undo.',
    inputSchema: { type: 'object', properties: { memberId: { type: 'string' }, action: { type: 'string', enum: ['add', 'subtract', 'drink'] }, quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['memberId', 'action'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['memberId', 'action', 'quantity'].includes(key)) || typeof input.memberId !== 'string' || !['add', 'subtract', 'drink'].includes(input.action)) throw new Error('记账参数无效');
      if (input.quantity !== undefined) validInteger(input.quantity, '加减数量', 1, 99);
      const next = memberAction(session, input.memberId, input.action, input.quantity ?? step);
      selectedMemberId = input.memberId;
      if (!await commit(next, '已完成记账')) throw new Error('记账未完成，请检查保存状态后重试');
      return structuredClone(session.members.find(member => member.id === input.memberId));
    },
  });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
