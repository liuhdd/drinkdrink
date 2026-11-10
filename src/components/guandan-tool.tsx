'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, QrCode, Spade, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GuandanPractice } from './guandan-practice';
import { GuandanRoomTool } from './guandan-room-tool';

export function GuandanTool({ back }: { back: ReactNode }) {
  const [previousMode, setPreviousMode] = useState<'practice' | 'room' | null>(null);
  const [mode, setMode] = useState<'practice' | 'room' | null>(null);
  useEffect(() => { if (new URLSearchParams(window.location.search).get('tool') === 'guandan-room' || new URLSearchParams(window.location.hash.slice(1)).has('guandan-room')) setMode('room'); }, []);
  useEffect(() => {
    if (mode) document.getElementById('guandan-title')?.focus();
    else if (previousMode) document.getElementById(`guandan-mode-${previousMode}`)?.focus();
  }, [mode, previousMode]);
  const returnToModes = () => {
    setPreviousMode(mode);
    const url = new URL(window.location.href); url.searchParams.delete('tool');
    history.replaceState(history.state, '', url.pathname + url.search);
    setMode(null);
  };
  const modeBack = <Button id="guandan-mode-back" variant="ghost" size="icon" aria-label="掼蛋模式" onClick={returnToModes}><ArrowLeft aria-hidden="true" /></Button>;
  if (mode === 'practice') return <GuandanPractice back={modeBack} />;
  if (mode === 'room') return <GuandanRoomTool back={modeBack} />;
  return <section id="guandan-tool" data-appearance-region="guandan" className="mx-auto max-w-3xl"><Card data-appearance-surface="game" className="gap-0 overflow-hidden p-0 sm:p-0"><div className="flex items-center gap-2 border-b p-3 sm:px-6">{back}<Spade aria-hidden="true" className="size-5 text-primary" /><h2 id="guandan-title" tabIndex={-1} className="text-lg font-semibold outline-none">掼蛋</h2></div><div className="p-5 sm:p-8"><img src="/design/tools/guandan.svg" alt="" width={160} height={120} className="mx-auto mb-5" /><h3 className="text-center text-xl font-semibold">和对家一起，打到 A</h3><div className="mx-auto mt-6 grid max-w-md gap-3"><Button id="guandan-mode-room" className="h-14" onClick={() => setMode('room')}><QrCode aria-hidden="true" />扫码组局</Button><Button id="guandan-mode-practice" variant="outline" className="h-14" onClick={() => setMode('practice')}><Users aria-hidden="true" />本机练习</Button></div><p className="mt-4 text-center text-xs leading-5 text-muted-foreground">扫码组局：2–4 人联网，空座电脑补位<br />本机练习：你和 3 位电脑，页面加载后可离线练习<br />均不自动记酒</p></div></Card></section>;
}
