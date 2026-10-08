'use client';

import { useEffect, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createSummaryImage } from '@/client/summary';
import { FormError } from './ledger-forms';
import { failureLog } from '@/shared/logging';
import type { Session, SummaryImage } from '@/shared/types';

interface Preview extends SummaryImage { url: string; file: File; }
export function SummaryPreview({ session, endedAt }: { session: Session; endedAt: number }) {
  const [image, setImage] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setImage(null);
    setError('');
    const generate = async () => {
      try {
        const result = await createSummaryImage(session, endedAt);
        if (!active) return;
        url = URL.createObjectURL(result.blob);
        const file = new File([result.blob], result.filename, { type: 'image/png' });
        setImage({ ...result, url, file });
        setCanShare(typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }));
      } catch (caught) {
        const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
        console.error(failureLog('generate summary image', cause));
        if (active) setError(cause.message);
      }
    };
    void generate();
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [session, endedAt, attempt]);
  const share = async () => {
    if (!image) return;
    setSharing(true);
    try { await navigator.share({ files: [image.file], title: `${session.title} · 酒局总结` }); }
    catch (caught) {
      const cause = caught instanceof Error ? caught : new Error(String(caught), { cause: caught });
      console.error(failureLog('share summary image', cause));
      setError(`分享未完成（${cause.name}）：${cause.message}`);
    } finally { setSharing(false); }
  };
  return <div className="grid gap-4"><p role="status" className="text-xs text-muted-foreground">{image ? '图片已生成，可下载或长按保存。' : error ? '图片暂未生成' : '正在生成图片…'}</p>
    {image && <img id="summary-preview" src={image.url} width={1080} height={770 + Math.max(image.summary.members.length, 1) * 94} alt="酒局总结：局名、起止时间、总计和每位酒友的最终计数" className="h-auto w-full rounded-xl border" />}
    <FormError message={error} /><div className="flex flex-wrap justify-end gap-2">{error && <Button id="summary-retry" type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>重新生成</Button>}{image && <Button asChild><a id="summary-download" href={image.url} download={image.filename}><Download />下载图片</a></Button>}{image && canShare && <Button id="summary-share" type="button" variant="outline" disabled={sharing} onClick={() => void share()}><Share2 />分享图片</Button>}</div><p className="text-xs text-muted-foreground">图片在本机生成。也可长按保存，再发给朋友。</p>
  </div>;
}
