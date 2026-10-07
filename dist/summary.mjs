import { leaderboard, validateSession } from './domain.mjs';

export function sessionSummary(session, endedAt = session.endedAt) {
  if (!validateSession(session) || !Number.isFinite(endedAt) || !Number.isFinite(new Date(endedAt).getTime()) || endedAt < session.startedAt) throw new Error('请先结束本局，再生成总结');
  return {
    title: session.title, round: session.round, cupSize: session.cupSize,
    startedAt: session.startedAt, endedAt, durationMs: endedAt - session.startedAt,
    totals: session.members.reduce((total, member) => ({
      members: total.members + 1, consumed: total.consumed + member.consumed,
      cups: total.cups + member.cups, pending: total.pending + member.pending,
    }), { members: 0, consumed: 0, cups: 0, pending: 0 }),
    members: leaderboard(session),
  };
}

// Draw locally using system fonts; no remote assets or uploads are needed.
export async function createSummaryImage(session, endedAt) {
  const summary = sessionSummary(session, endedAt);
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  const width = 1080;
  const height = 770 + Math.max(summary.members.length, 1) * 94;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成图片，请换一个浏览器重试');
  const font = '"PingFang SC", "Microsoft YaHei", sans-serif';
  const ink = '#33332e', muted = '#77746c', accent = '#ac573f';
  const text = (value, x, y, size = 26, color = ink, weight = 400, align = 'left') => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.fillText(String(value), x, y);
  };
  const line = y => {
    ctx.strokeStyle = '#dfdbd2'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(68, y); ctx.lineTo(1012, y); ctx.stroke();
  };
  const format = at => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  ctx.fillStyle = '#f7f6f2'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fffdfa'; ctx.fillRect(32, 32, width - 64, height - 64);
  ctx.fillStyle = '#ac573f'; ctx.fillRect(68, 72, 7, 36);
  text('微醺账本', 94, 100, 30, accent, 600);
  text('酒局总结', 1012, 100, 24, muted, 400, 'right');
  text('相聚有时，回忆有数。', 68, 168, 24, muted);
  ctx.font = `600 48px ${font}`;
  const titleLines = [''];
  for (const char of [...summary.title]) {
    const index = titleLines.length - 1;
    if (ctx.measureText(titleLines[index] + char).width > 944) titleLines.push(char);
    else titleLines[index] += char;
  }
  titleLines.forEach((title, i) => text(title, 68, 240 + i * 62, 48, ink, 600));
  text(`${format(summary.startedAt)} — ${format(summary.endedAt)}`, 68, 344, 23, muted);
  const minutes = Math.floor(summary.durationMs / 60_000);
  const duration = minutes === 0 ? '不足 1 分钟' : minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`;
  text(`第 ${summary.round} 局 · 相聚 ${duration} · 1 杯 = ${summary.cupSize} 个`, 68, 384, 23, muted);
  ctx.fillStyle = '#f2e5dc'; ctx.fillRect(68, 426, 944, 130);
  const stats = [['酒友', summary.totals.members, '位'], ['已喝', summary.totals.consumed, '个'], ['杯数', summary.totals.cups, '杯'], ['剩余待喝', summary.totals.pending, '个']];
  stats.forEach(([label, value, unit], i) => {
    const center = 186 + i * 236;
    text(label, center, 466, 22, muted, 400, 'center');
    text(`${value} ${unit}`, center, 522, 36, accent, 600, 'center');
  });
  text('本局酒友', 68, 614, 28, ink, 600);
  text('已喝 / 杯数', 808, 614, 22, muted, 400, 'right');
  text('待喝', 1012, 614, 22, muted, 400, 'right');
  line(640);
  const palette = ['#f3e1d6', '#ebe5f0', '#e3e9de', '#e0e7ea', '#eee7d6', '#efdde1'];
  summary.members.forEach((member, i) => {
    const top = 650 + i * 94;
    text(String(member.rank).padStart(2, '0'), 68, top + 54, 23, muted);
    ctx.fillStyle = palette[member.color];
    ctx.beginPath(); ctx.arc(156, top + 44, 26, 0, Math.PI * 2); ctx.fill();
    text([...member.name][0], 156, top + 54, 25, ink, 500, 'center');
    text(member.name, 202, top + 54, 27, ink, 500);
    text(`${member.consumed} 个 / ${member.cups} 杯`, 808, top + 54, 25, accent, 500, 'right');
    text(`${member.pending} 个`, 1012, top + 54, 25, muted, 400, 'right');
    line(top + 88);
  });
  if (!summary.members.length) text('这一局，留下一份相聚的纪念。', 68, 714, 26, muted);
  text('开心碰杯，量力而行。', 68, height - 64, 23, accent);
  text('CHEERS, KEEP TRACK.', 1012, height - 64, 20, muted, 400, 'right');
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片生成失败，请重试')), 'image/png'));
  const date = new Intl.DateTimeFormat('sv-SE').format(summary.endedAt);
  const title = summary.title.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim() || '酒局';
  return { blob, filename: `微醺账本-${title}-${date}.png`, summary };
}
