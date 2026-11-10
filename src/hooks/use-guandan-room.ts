'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomActionRequest, RoomSnapshot } from '@/shared/guandan-room';
import { activateRoomIdentity, callRoom, clearRoomInvite, forgetActiveRoom, parseRoomInvite, prepareRoomIdentity, readRoomIdentity, readRoomInvite, roomErrorStatus, storeRoomInvite, type RoomIdentity, type RoomInvite } from '@/client/guandan-room';

export function useGuandanRoom() {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [invite, setInvite] = useState<RoomInvite | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const identity = useRef<RoomIdentity | null>(null);
  const invitation = useRef<RoomInvite | null>(null);
  const current = useRef<RoomSnapshot | null>(null);
  const mounted = useRef(false);
  const working = useRef(false);
  const stopped = useRef(false);
  const polling = useRef(false);
  const hintIndex = useRef(0);
  const accept = useCallback((snapshot: RoomSnapshot) => {
    if (!mounted.current) return;
    if (current.current?.roomId === snapshot.roomId && current.current.version > snapshot.version) return;
    if (current.current?.version !== snapshot.version) { setSelected([]); hintIndex.current = 0; setNotice(''); }
    current.current = snapshot; setRoom(snapshot);
    if (snapshot.selfSeat !== null) {
      clearRoomInvite();
    }
  }, []);
  const load = useCallback(async () => {
    const roomId = identity.current?.roomId ?? invitation.current?.roomId;
    if (!roomId) return;
    const snapshot = await callRoom(`/api/guandan/rooms/${roomId}`, identity.current, invitation.current, null);
    if ((identity.current?.roomId ?? invitation.current?.roomId) === roomId) accept(snapshot);
  }, [accept]);
  const run = useCallback(async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); stopped.current = false; }
    catch (caught) {
      stopped.current = true;
      let message = caught instanceof Error ? caught.message : String(caught);
      if (caught instanceof Error && roomErrorStatus(caught) === 409) {
        try { await load(); message += ' 已读取最新牌桌，请重新选择操作。'; }
        catch (refreshError) { message += `；恢复读取失败：${refreshError instanceof Error ? refreshError.message : String(refreshError)}`; }
      }
      if (mounted.current) {
        if (caught instanceof Error && roomErrorStatus(caught) === 400) { setNotice(message); stopped.current = false; }
        else setError(message);
      }
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    void run(async () => {
      const draft = readRoomInvite(); invitation.current = draft; setInvite(draft);
      identity.current = readRoomIdentity(draft?.roomId ?? null);
      if (identity.current) activateRoomIdentity(identity.current);
      await load();
    }).finally(() => { if (mounted.current) setReady(true); });
    const timer = window.setInterval(() => {
      if (document.hidden || polling.current || working.current || stopped.current || !current.current || ['closed', 'expired'].includes(current.current.status)) return;
      polling.current = true;
      const pollVersion = current.current.version;
      const pollRoomId = current.current.roomId;
      const pollIdentity = identity.current;
      void load().catch((caught: unknown) => {
        if (mounted.current && !working.current && current.current?.roomId === pollRoomId && current.current.version === pollVersion && identity.current === pollIdentity) { stopped.current = true; setError(caught instanceof Error ? caught.message : String(caught)); }
      }).finally(() => { polling.current = false; });
    }, 1800);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [load, run]);
  const create = (name: string) => run(async () => {
    const id = crypto.randomUUID();
    identity.current = prepareRoomIdentity(id); invitation.current = null; setInvite(null); clearRoomInvite();
    accept(await callRoom('/api/guandan/rooms', identity.current, null, { roomId: id, name: name.trim() }));
  });
  const preview = (link: string) => run(async () => {
    const draft = parseRoomInvite(link, window.location.origin); storeRoomInvite(draft);
    invitation.current = draft; setInvite(draft); identity.current = readRoomIdentity(draft.roomId);
    if (identity.current) activateRoomIdentity(identity.current);
    current.current = null; setRoom(null); await load();
  });
  const join = (name: string) => run(async () => {
    if (!invitation.current || !current.current) throw new Error('请先读取有效的邀请。');
    identity.current = prepareRoomIdentity(invitation.current.roomId);
    accept(await callRoom(`/api/guandan/rooms/${invitation.current.roomId}/join`, identity.current, invitation.current, { version: current.current.version, name: name.trim() }));
  });
  const action = (type: RoomActionRequest['type']) => run(async () => {
    if (!current.current || !identity.current) throw new Error('请先加入房间。');
    const body: RoomActionRequest = type === 'play' ? { type, version: current.current.version, cardIds: selected } : { type, version: current.current.version };
    accept(await callRoom(`/api/guandan/rooms/${current.current.roomId}/action`, identity.current, null, body));
  });
  const suggest = () => {
    const hints = room?.game?.hints ?? [];
    if (!hints.length) { setSelected([]); setNotice('没有可压过上一手的牌，可以选择不出。'); return; }
    const hint = hints[hintIndex.current % hints.length]!; hintIndex.current += 1;
    setSelected(hint); setNotice(`提示 ${(hintIndex.current - 1) % hints.length + 1} / ${hints.length}，再次点击可切换。`);
  };
  const reset = () => run(async () => {
    forgetActiveRoom();
    const url = new URL(window.location.href); url.hash = ''; url.searchParams.delete('tool');
    history.replaceState(history.state, '', url.pathname + url.search);
    identity.current = null; invitation.current = null; current.current = null; setRoom(null); setInvite(null); setSelected([]); setNotice('');
  });
  return { room, invite, ready, busy, error, selected, notice, create, preview, join, action, suggest, reset, reconnect: () => run(load), clear: () => setSelected([]), toggle: (id: string) => setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]) };
}
