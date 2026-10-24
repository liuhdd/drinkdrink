'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Dices, Drama, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DiceTool } from './dice-tool';
import { CharadesTool } from './charades-tool';

const tools = [
  { id: 'dice', name: '摇骰子', description: '盖盅摇一摇，滑动揭晓手气', icon: Dices, component: DiceTool },
  { id: 'charades', name: '你比划我猜', description: '热梗、成语、脑洞词，看看谁最懂你', icon: Drama, component: CharadesTool },
] as const;
type Tool = typeof tools[number];

export function DrinkingTools() {
  const [selected, setSelected] = useState<Tool | null>(null);
  const [previous, setPrevious] = useState<Tool['id'] | null>(null);
  useEffect(() => {
    if (selected) document.getElementById(`${selected.id}-title`)?.focus();
    else if (previous) document.getElementById(`tool-${previous}`)?.focus();
  }, [selected, previous]);
  return <section className="mx-auto max-w-4xl pb-6" aria-label="喝酒工具">
    {selected === null ? <>
      <div className="mb-7 flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-2xl bg-accent text-primary"><Sparkles aria-hidden="true" className="size-6" /></span><div><h1 id="tools-title" className="text-2xl font-semibold tracking-tight">喝酒工具</h1><p className="mt-1 text-xs text-muted-foreground">选一个小游戏，让相聚多点乐趣。</p></div></div>
      <div id="tools-list" className="grid gap-4 sm:grid-cols-2">{tools.map(tool => <Button id={`tool-${tool.id}`} key={tool.id} type="button" variant="outline" className="h-auto min-w-0 items-start justify-start gap-4 whitespace-normal rounded-2xl p-5 text-left sm:p-7" onClick={() => { setPrevious(tool.id); setSelected(tool); }}>
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-primary"><tool.icon aria-hidden="true" className="size-6" /></span>
        <span className="min-w-0 flex-1"><span className="block text-base font-semibold">{tool.name}</span><span className="mt-2 block text-xs font-normal leading-6 text-muted-foreground">{tool.description}</span></span><ArrowRight aria-hidden="true" className="mt-1 size-4 text-primary/60" />
      </Button>)}</div>
    </> : <>
      <selected.component back={<Button id="tools-back" type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label="全部工具" title="全部工具" onClick={() => setSelected(null)}><ArrowLeft aria-hidden="true" /></Button>} />
    </>}
  </section>;
}
