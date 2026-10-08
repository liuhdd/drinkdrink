import { domainError } from '../shared/errors.ts';
import { sessionInput } from '../shared/validation.ts';
import type { Session, Summary, SummaryImage } from '../shared/types.ts';
import { at } from '../shared/values.ts';
import { leaderboard } from '../shared/domain.ts';

export function sessionSummary(session: Session, endedAt: number | undefined): Summary {
  sessionInput(session, 'summary.session');
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt) || !Number.isFinite(new Date(endedAt).getTime()) || endedAt < session.startedAt) throw domainError('请先结束本局，再生成总结', 'summary');
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

// 使用系统字体在本地绘图，无需远程资源或上传。 Draw locally using system fonts; no remote assets or uploads are needed.
export async function createSummaryImage(session: Session, endedAt: number): Promise<SummaryImage> {
  const summary = sessionSummary(session, endedAt);
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  const width = 1080;
  const height = 770 + Math.max(summary.members.length, 1) * 94;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw domainError('当前浏览器无法生成图片，请换一个浏览器重试', 'summary');
  const font = '"PingFang SC", "Microsoft YaHei", sans-serif';
  const ink = '#302840', muted = '#756a84', accent = '#7754d6';
  const text = (value: string | number, x: number, y: number, size: number, color: string, weight: number, align: CanvasTextAlign): void => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.fillText(String(value), x, y);
  };
  const line = (y: number): void => {
    ctx.strokeStyle = '#e9e3f3'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(68, y); ctx.lineTo(1012, y); ctx.stroke();
  };
  const format = (at: number): string => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  ctx.fillStyle = '#f6f4fc'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(32, 32, width - 64, height - 64);
  ctx.fillStyle = '#7754d6'; ctx.fillRect(68, 72, 7, 36);
  text('微醺账本', 94, 100, 30, accent, 600, 'left');
  text('酒局总结', 1012, 100, 24, muted, 400, 'right');
  text('相聚有时，回忆有数。', 68, 168, 24, muted, 400, 'left');
  ctx.font = `600 48px ${font}`;
  const titleLines = [''];
  for (const char of [...summary.title]) {
    const index = titleLines.length - 1;
    if (ctx.measureText(at(titleLines, index) + char).width > 944) titleLines.push(char);
    else titleLines[index] += char;
  }
  titleLines.forEach((title, i) => text(title, 68, 240 + i * 62, 48, ink, 600, 'left'));
  text(`${format(summary.startedAt)} — ${format(summary.endedAt)}`, 68, 344, 23, muted, 400, 'left');
  const minutes = Math.floor(summary.durationMs / 60_000);
  const duration = minutes === 0 ? '不足 1 分钟' : minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`;
  text(`第 ${summary.round} 局 · 相聚 ${duration} · 1 杯 = ${summary.cupSize} 个`, 68, 384, 23, muted, 400, 'left');
  ctx.fillStyle = '#ebe4fa'; ctx.fillRect(68, 426, 944, 130);
  const stats: [string, number, string][] = [['酒友', summary.totals.members, '位'], ['已喝', summary.totals.consumed, '个'], ['杯数', summary.totals.cups, '杯'], ['剩余待喝', summary.totals.pending, '个']];
  stats.forEach(([label, value, unit], i) => {
    const center = 186 + i * 236;
    text(label, center, 466, 22, muted, 400, 'center');
    text(`${value} ${unit}`, center, 522, 36, accent, 600, 'center');
  });
  text('本局酒友', 68, 614, 28, ink, 600, 'left');
  text('已喝 / 杯数', 808, 614, 22, muted, 400, 'right');
  text('待喝', 1012, 614, 22, muted, 400, 'right');
  line(640);
  const palette = ['#e8ddff', '#eddefa', '#f5dff6', '#e4e7ff', '#ede0f3', '#ebe7f3'];
  summary.members.forEach((member, i) => {
    const top = 650 + i * 94;
    text(String(member.rank).padStart(2, '0'), 68, top + 54, 23, muted, 400, 'left');
    ctx.fillStyle = at(palette, member.color);
    ctx.beginPath(); ctx.arc(156, top + 44, 26, 0, Math.PI * 2); ctx.fill();
    text(at([...member.name], 0), 156, top + 54, 25, ink, 500, 'center');
    text(member.name, 202, top + 54, 27, ink, 500, 'left');
    text(`${member.consumed} 个 / ${member.cups} 杯`, 808, top + 54, 25, accent, 500, 'right');
    text(`${member.pending} 个`, 1012, top + 54, 25, muted, 400, 'right');
    line(top + 88);
  });
  if (!summary.members.length) text('这一局，留下一份相聚的纪念。', 68, 714, 26, muted, 400, 'left');
  text('开心碰杯，量力而行。', 68, height - 64, 23, accent, 400, 'left');
  text('CHEERS, KEEP TRACK.', 1012, height - 64, 20, muted, 400, 'right');
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片生成失败，请重试')), 'image/png'));
  const date = new Intl.DateTimeFormat('sv-SE').format(summary.endedAt);
  const title = summary.title.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').trim() || '酒局';
  return { blob, filename: `微醺账本-${title}-${date}.png`, summary };
}
