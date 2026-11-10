'use client';
import { useState, type ReactNode } from 'react';
import { CircleHelp, Spade } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGuandanRoom } from '@/hooks/use-guandan-room';
import { GuandanRoomInvite } from './guandan-room-invite';
import { GuandanRoomTable } from './guandan-room-table';
import { GuandanRules } from './guandan-rules';

export function GuandanRoomTool({ back }: { back: ReactNode }) {
  const controller = useGuandanRoom();
  const { room, busy, ready, error } = controller;
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [close, setClose] = useState(false);
  const [rules, setRules] = useState(false);
  const host = room !== null && room.selfSeat === room.hostSeat;
  const ended = room?.status === 'closed' || room?.status === 'expired';
  return <section id="guandan-room-tool" data-appearance-region="guandan" aria-labelledby="guandan-title" className="mx-auto max-w-3xl pb-[calc(var(--appearance-game-action-height)+11px)] lg:pb-6"><Card data-appearance-surface="game" className="gap-0 overflow-hidden p-0 sm:p-0">
    <div className="flex items-center justify-between border-b p-3 sm:px-6"><div className="flex items-center gap-2">{back}<Spade aria-hidden="true" className="size-5 text-primary" /><h2 id="guandan-title" tabIndex={-1} className="text-lg font-semibold outline-none">扫码组局</h2></div><Button id="guandan-room-rules" variant="ghost" size="icon" aria-label="掼蛋规则" onClick={() => setRules(true)}><CircleHelp aria-hidden="true" /></Button></div>
    <div className="p-4 sm:p-6">
      {!ready ? <p role="status">正在读取房间…</p> : ended ? <div className="py-6 text-center"><h3 className="text-lg font-semibold">{room.status === 'expired' ? '房间已过期' : '房间已关闭'}</h3><Button id="guandan-room-reset" className="mt-4" onClick={() => void controller.reset()}>重新组局</Button></div> : !room ? <div className="mx-auto max-w-md">
        <h3 className="text-xl font-semibold">和同桌朋友开一局</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">2–4 位真人，空座由电脑补齐。对家一队，联网同步出牌，不自动记酒。</p>
        <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void controller.create(name); }}><label htmlFor="guandan-room-name" className="text-sm font-medium">你的昵称</label><Input id="guandan-room-name" value={name} maxLength={12} required onChange={event => setName(event.target.value)} autoComplete="nickname" /><Button id="guandan-room-create" className="w-full" disabled={busy || !name.trim() || Boolean(error)}>创建房间</Button></form>
        <form className="mt-6 space-y-3 border-t pt-5" onSubmit={event => { event.preventDefault(); void controller.preview(link); }}><label htmlFor="guandan-room-link" className="text-sm font-medium">已有邀请？粘贴链接加入</label><Input id="guandan-room-link" value={link} onChange={event => setLink(event.target.value)} placeholder="粘贴朋友分享的完整邀请链接" required /><Button id="guandan-room-preview" variant="outline" className="w-full" disabled={busy || !link.trim()}>查看邀请</Button></form>
      </div> : room.selfSeat === null ? <div className="mx-auto max-w-md"><h3 className="text-lg font-semibold">朋友邀请你加入掼蛋</h3><p className="mt-2 text-sm text-muted-foreground">已有 {room.seats.filter(seat => seat.kind === 'human').length} 位玩家。确认后才会占用座位。</p><form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void controller.join(name); }}><label htmlFor="guandan-room-join-name" className="text-sm font-medium">你的昵称</label><Input id="guandan-room-join-name" value={name} maxLength={12} required onChange={event => setName(event.target.value)} autoComplete="nickname" /><Button id="guandan-room-join" className="w-full" disabled={busy || !name.trim() || room.status !== 'waiting' || Boolean(error)}>确认加入</Button></form>{room.status !== 'waiting' && <p className="mt-3 text-sm">房间已开局，暂不能加入。</p>}</div> : <>
        {room.status === 'waiting' ? <><h3 className="font-semibold">等待朋友入座</h3><div id="guandan-room-lobby" className="mt-3 divide-y">{room.seats.map(seat => <div id={`guandan-room-lobby-seat-${seat.seat}`} key={seat.seat} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{seat.seat + 1} 号 · {seat.kind === 'empty' ? '等待加入' : seat.name}{seat.seat === room.selfSeat ? '（你）' : ''}{seat.seat === room.hostSeat ? ' · 房主' : ''}</span><span className="text-xs text-muted-foreground">队伍{seat.seat % 2 === 0 ? '一' : '二'}{seat.kind === 'empty' ? ' · 开局电脑补位' : ''}</span></div>)}</div><p className="my-3 text-xs text-muted-foreground">对家一队。至少 2 位真人才能开局；已入座真人断线时会保留座位，等待本人重连。</p>{host ? <Button id="guandan-room-start" className="w-full" disabled={busy || Boolean(error) || room.seats.filter(seat => seat.kind === 'human').length < 2} onClick={() => void controller.action('start')}>开始对局</Button> : <p role="status" className="text-center text-sm text-primary">等待房主开始</p>}{room.inviteToken && <GuandanRoomInvite invite={{ roomId: room.roomId, inviteToken: room.inviteToken }} />}</> : <GuandanRoomTable room={room} controller={controller} />}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3"><p className="text-xs text-muted-foreground">仅显示你的手牌 · 不自动记酒</p>{host && <Button id="guandan-room-close" variant="ghost" size="sm" disabled={busy} onClick={() => setClose(true)}>关闭房间</Button>}</div>
      </>}
      {!room?.game && controller.notice && <p role="status" className="mt-3 text-xs text-primary">{controller.notice}</p>}
      {error && <div className="mt-4 rounded-lg border border-destructive/40 p-3"><p id="guandan-room-error" role="alert" className="break-words text-xs leading-5 text-destructive">{error}</p><Button id="guandan-room-reconnect" variant="outline" size="sm" className="mt-3" disabled={busy} onClick={() => void controller.reconnect()}>重新连接（只读）</Button><Button id="guandan-room-error-reset" variant="ghost" size="sm" className="mt-3" disabled={busy} onClick={() => void controller.reset()}>返回组局首页</Button><p className="mt-2 text-xs leading-5 text-muted-foreground">返回首页只清除当前房间关联，不会关闭旧房间或释放座位；保留本机座位凭证，再打开原邀请可恢复。</p></div>}
      {busy && <p role="status" className="mt-2 text-xs text-muted-foreground">正在同步…</p>}
    </div></Card>
    <GuandanRules open={rules} onOpenChange={setRules} description="2–4 位真人联网组局，对家一队，开局空座由电脑补位。已入座真人断线后等待本人重连。" persistence="牌局由服务器保存，房间创建后 24 小时失效；本浏览器保存你的座位凭证，清除网站数据将无法恢复该身份。" />
    <Dialog open={close} onOpenChange={setClose}><DialogContent id="guandan-room-close-dialog"><DialogHeader><DialogTitle>关闭这个房间？</DialogTitle><DialogDescription>所有玩家将无法继续本次对局，邀请链接也会失效。本机练习与酒局账本不受影响。</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button id="guandan-room-close-cancel" variant="outline" onClick={() => setClose(false)}>取消</Button><Button id="guandan-room-close-confirm" disabled={busy} onClick={() => { setClose(false); void controller.action('close'); }}>确认关闭</Button></div></DialogContent></Dialog>
  </section>;
}
