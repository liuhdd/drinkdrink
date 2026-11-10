'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { inviteUrl, type RoomInvite } from '@/client/guandan-room';

export function GuandanRoomInvite({ invite }: { invite: RoomInvite }) {
  const [link, setLink] = useState('');
  const [image, setImage] = useState('');
  const [message, setMessage] = useState('');
  const [localPreview, setLocalPreview] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLocalPreview(['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname));
    const url = inviteUrl(invite, window.location.origin); setLink(url); setImage(''); setError('');
    void QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 320, color: { dark: '#201610', light: '#ffffff' } }).then(data => { if (active) setImage(data); }).catch((caught: unknown) => { if (active) setError(`二维码生成失败：${caught instanceof Error ? caught.message : String(caught)}`); });
    return () => { active = false; };
  }, [invite.roomId, invite.inviteToken]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setMessage('邀请链接已复制'); setError(''); }
    catch { setError('无法访问剪贴板，请长按下方邀请链接手动复制。'); }
  };
  return <div className="mt-5 border-t pt-5 text-center">
    <h3 className="text-sm font-semibold">让朋友用手机相机扫码</h3>
    {image && <img id="guandan-room-qr" src={image} alt="掼蛋房间邀请二维码" width={320} height={320} className="mx-auto my-3 size-64 max-w-full" />}
    <label htmlFor="guandan-room-invite-url" className="sr-only">房间邀请链接</label><Input id="guandan-room-invite-url" value={link} readOnly onFocus={event => event.target.select()} />
    <Button id="guandan-room-copy-invite" type="button" variant="outline" className="mt-3" disabled={!link} onClick={() => void copy()}>复制邀请链接</Button>
    {message && <p role="status" className="mt-2 text-xs text-primary">{message}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {localPreview && <p id="guandan-room-local-preview" className="mt-3 text-xs leading-5 text-primary">当前是本机预览，其他设备无法连接；发布到可访问的 HTTPS 地址后可扫码组局。</p>}
    <p className="mt-3 text-xs leading-5 text-muted-foreground">双方需要联网，无需同一 Wi-Fi；用手机相机扫码打开同一网站，不能离线联机。邀请有效至房间关闭或创建后 24 小时，请只分享给同桌朋友。</p>
  </div>;
}
