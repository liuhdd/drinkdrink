'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DiceTool } from './dice-tool';
import { CharadesTool } from './charades-tool';

const tools = [
  { id: 'dice', name: '摇骰子', description: '盖盅摇一摇，滑动揭晓手气', image: '/design/tools/dice.png', component: DiceTool },
  { id: 'charades', name: '你比划我猜', description: '热梗、成语、脑洞词', image: '/design/tools/charades.png', component: CharadesTool },
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
      <div className="mb-6"><h1 id="tools-title" className="text-2xl font-extrabold tracking-[-0.03em]">喝酒工具</h1><p className="mt-2 text-sm text-muted-foreground">聚在一起，玩点有趣的</p></div>
      <div id="tools-list" className="grid max-w-lg grid-cols-2 gap-3 sm:gap-4">{tools.map(tool => <Button id={`tool-${tool.id}`} key={tool.id} type="button" variant="outline" className="group h-auto min-h-44 min-w-0 flex-col items-stretch justify-start gap-0 whitespace-normal rounded-xl border-0 bg-card p-4 text-left shadow-sm transition-[background-color,box-shadow] hover:bg-card hover:shadow-md" onClick={() => { setPrevious(tool.id); setSelected(tool); }}>
        <span className="relative block"><img src={tool.image} alt="" width={112} height={88} className="h-22 w-full object-contain" /><span className="absolute top-0 right-0 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><ArrowRight aria-hidden="true" className="size-3.5" /></span></span>
        <span className="mt-3 min-w-0 text-base font-semibold leading-6">{tool.name}</span><span className="mt-1 text-[11px] font-normal leading-5 text-muted-foreground">{tool.description}</span>
      </Button>)}</div>
    </> : <>
      <selected.component back={<Button id="tools-back" type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label="全部工具" title="全部工具" onClick={() => setSelected(null)}><ArrowLeft aria-hidden="true" /></Button>} />
    </>}
  </section>;
}
