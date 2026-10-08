'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { colors, CloseButton } from './ledger-panels';
import { addMembers, validInteger } from '@/shared/domain';
import { availableMembers, rememberMembers, finishSession, startNextSession, withLedgerSession } from '@/shared/persistence';
import { draftIdentity } from '@/client/actions';
import { editMember } from '@/client/edit-member';
import { domainError } from '@/shared/errors';
import type { Ledger, Member, Session } from '@/shared/types';
import type { LedgerController } from '@/hooks/use-ledger';

interface FormProps { ledger: Ledger; controller: LedgerController; close: () => void; }
export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
export function FormError({ message }: { message: string }) { return message ? <p role="alert" className="break-words text-sm text-destructive" data-testid="form-error">{message}</p> : null; }
function useFormSubmit(operation: () => Promise<void>) {
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try { await operation(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  return { error, submit };
}
export function AddMembersForm({ ledger, controller, close }: FormProps) {
  const [drafts, setDrafts] = useState([{ id: 0, name: '', pending: '0' }]);
  const available = availableMembers(ledger.knownMembers, ledger.session);
  const update = (id: number, field: 'name' | 'pending', value: string) => setDrafts(items => items.map(item => item.id === id ? { ...item, [field]: value } : item));
  const { error, submit } = useFormSubmit(async () => {
    const session = addMembers(ledger.session, drafts, ledger.knownMembers, draftIdentity(drafts.length));
    const added = session.members.slice(ledger.session.members.length);
    await controller.saveMember(withLedgerSession(ledger, session, { knownMembers: rememberMembers(ledger.knownMembers, added) }), `已添加 ${drafts.length} 位酒友`);
    close();
  });
  return <form id="add-members-form" onSubmit={submit} className="grid gap-5">
    <div id="draft-members" className="grid gap-4">{drafts.map((draft, index) => <div key={draft.id} className="grid gap-3 rounded-xl border bg-background p-4">
      <div className="flex justify-between text-xs text-muted-foreground"><span>酒友 {index + 1}</span>{drafts.length > 1 && <button type="button" aria-label={`移除第 ${index + 1} 行`} data-testid={`remove-draft-${draft.id}`} onClick={() => setDrafts(items => items.filter(item => item.id !== draft.id))}><Trash2 className="size-4" /></button>}</div>
      <Field id={`draft-name-${draft.id}`} label="成员昵称"><Input id={`draft-name-${draft.id}`} autoComplete="off" maxLength={12} required list={`known-members-${draft.id}`} value={draft.name} onChange={event => update(draft.id, 'name', event.target.value)} placeholder="输入或选择以前的酒友" />
        <datalist id={`known-members-${draft.id}`}>{available.filter(profile => !drafts.some(other => other.id !== draft.id && other.name.trim().toLowerCase() === profile.name.toLowerCase())).map(profile => <option key={profile.id} value={profile.name} />)}</datalist>
      </Field><Field id={`draft-pending-${draft.id}`} label="初始待喝（个）"><Input id={`draft-pending-${draft.id}`} type="number" min={0} max={9999} step={1} required value={draft.pending} onChange={event => update(draft.id, 'pending', event.target.value)} /></Field>
    </div>)}</div>
    <Button id="append-member" type="button" variant="outline" disabled={controller.saving || drafts.length + ledger.session.members.length >= 30} onClick={() => setDrafts(items => [...items, { id: Math.max(...items.map(item => item.id)) + 1, name: '', pending: '0' }])}><Plus />再加一位</Button>
    <FormError message={error} /><div className="flex justify-end gap-2"><CloseButton close={close} /><Button id="add-members-submit" type="submit" disabled={controller.saving}>添加 {drafts.length} 位</Button></div>
  </form>;
}
export function EditMemberForm({ ledger, controller, close, member, remove }: FormProps & { member: Member; remove: () => void }) {
  const [name, setName] = useState(member.name);
  const [color, setColor] = useState(member.color);
  const [pending, setPending] = useState(String(member.pending));
  const { error, submit } = useFormSubmit(async () => {
    await controller.saveMember(editMember(ledger, member.id, name, color, pending, { id: crypto.randomUUID(), at: Date.now() }), `已更新${name}`);
    close();
  });
  return <form id="member-form" onSubmit={submit} className="grid gap-5">
    <Field id="member-name" label="成员昵称"><Input id="member-name" required maxLength={12} value={name} onChange={event => setName(event.target.value)} /></Field>
    <fieldset className="grid gap-3"><legend className="mb-3 text-sm font-medium">选择头像颜色</legend><div id="color-picker" className="flex flex-wrap gap-3">{colors.map((item, index) => <label key={item.name} className="relative flex size-9 items-center justify-center rounded-full ring-offset-2 has-checked:ring-2 has-checked:ring-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-ring" style={{ backgroundColor: item.bg }}><input className="absolute inset-0 size-full cursor-pointer opacity-0" type="radio" name="color" value={index} aria-label={item.name} checked={color === index} onChange={() => setColor(index)} data-testid={`color-${index}`} />{color === index && <Check aria-hidden="true" className="size-4" style={{ color: item.fg }} />}</label>)}</div></fieldset>
    <Field id="member-pending" label="待喝数量（个）"><Input id="member-pending" type="number" required min={0} max={9999} step={1} value={pending} onChange={event => setPending(event.target.value)} /></Field>
    <FormError message={error} /><div className="flex flex-wrap justify-end gap-2"><Button id="delete-member" type="button" variant="destructive" onClick={remove} disabled={controller.saving}>移除成员</Button><CloseButton close={close} /><Button id="save-member" type="submit" disabled={controller.saving}>保存成员</Button></div>
  </form>;
}
export function SettingsForm({ ledger, controller, close, start }: FormProps & { start: () => void }) {
  const [name, setName] = useState(ledger.session.title);
  const [step, setStep] = useState(String(ledger.step));
  const finished = ledger.session.endedAt !== undefined;
  const { error, submit } = useFormSubmit(async () => {
    const title = name.trim();
    if (!title) throw domainError('请输入酒局名称', 'settings');
    await controller.saveLedger({ ...ledger, session: { ...ledger.session, title }, step: validInteger(step, '快捷加减数量', 1, 99) }, '酒局设置已保存');
    controller.renameUndo(title);
    close();
  });
  return <div className="grid gap-6"><form id="settings-form" onSubmit={submit} className="grid gap-5">
    <Field id="settings-name" label="本局名称"><Input id="settings-name" maxLength={30} required value={name} disabled={finished} onChange={event => setName(event.target.value)} /></Field>
    <Field id="settings-step" label="快捷加减数量（个）"><Input id="settings-step" type="number" min={1} max={99} step={1} required value={step} disabled={finished} onChange={event => setStep(event.target.value)} /></Field>
    <p className="text-xs text-muted-foreground">{finished ? '本局已结束，设置已锁定。新开一局后可继续修改。' : '「＋」「−」每次操作这个数量。'}</p><FormError message={error} /><div className="flex justify-end gap-2"><CloseButton close={close} /><Button id="save-settings" type="submit" disabled={finished || controller.saving}>保存设置</Button></div>
  </form><div className="border-t pt-5"><Button id="new-session-button" type="button" variant="outline" className="w-full" onClick={start} disabled={controller.saving}><Plus />新开一局</Button></div></div>;
}
export function NewSessionForm({ ledger, controller, close }: FormProps) {
  const [name, setName] = useState('今晚的酒局');
  const [cup, setCup] = useState(String(ledger.session.cupSize));
  const [keep, setKeep] = useState(!ledger.session.demo);
  const { error, submit } = useFormSubmit(async () => {
    const title = name.trim();
    if (!title) throw domainError('请输入酒局名称', 'new session');
    const next = startNextSession(ledger, { title, cupSize: validInteger(cup, '每杯数量', 1, 99), members: keep ? ledger.session.members : [] }, Date.now(), crypto.randomUUID());
    await controller.saveLedger(next, '新一局开始了');
    controller.clearUndo();
    close();
  });
  return <form id="session-form" onSubmit={submit} className="grid gap-5">
    <Field id="new-session-name" label="酒局名称"><Input id="new-session-name" maxLength={30} required value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field id="new-session-cup" label="一杯算几个（全员统一）"><Input id="new-session-cup" type="number" min={1} max={99} step={1} required value={cup} onChange={event => setCup(event.target.value)} /></Field>
    <div className="flex items-center gap-3"><Checkbox id="keep-members" checked={keep} onCheckedChange={value => setKeep(value === true)} /><Label htmlFor="keep-members">保留本局成员</Label></div>
    <p className="rounded-xl bg-muted p-4 text-xs leading-6 text-muted-foreground">{ledger.session.endedAt !== undefined ? '上一局已结束并保存。' : '当前酒局会自动保存到历史（体验酒局除外）。'}新局重新计数，添加过的酒友仍可快捷选择。</p>
    <FormError message={error} /><div className="flex justify-end gap-2"><CloseButton close={close} /><Button id="confirm-new-session" type="submit" disabled={controller.saving}>确认开启</Button></div>
  </form>;
}
export function EndSessionForm({ ledger, controller, close, summary }: FormProps & { summary: (session: Session, endedAt: number) => void }) {
  const { error, submit } = useFormSubmit(async () => {
    const next = finishSession(ledger, Date.now(), crypto.randomUUID());
    const saved = await controller.saveLedger(next, '本局已结束，最终记录已保存');
    controller.clearUndo();
    const endedAt = saved.ledger.session.endedAt;
    if (endedAt === undefined) throw domainError('结束时间未保存', 'end session');
    summary(saved.ledger.session, endedAt);
  });
  return <form id="end-session-form" onSubmit={submit} className="grid gap-5"><p className="text-sm leading-7">确认结束「{ledger.session.title}」？本局共 {ledger.session.members.length} 位酒友，剩余待喝 {ledger.session.members.reduce((sum, member) => sum + member.pending, 0)} 个。</p><p className="text-xs leading-6 text-muted-foreground">最终计数和结束时间将保存到历史酒局。结束后不能继续记账，剩余待喝原样保留，不计入已喝。</p><FormError message={error} /><div className="flex justify-end gap-2"><CloseButton close={close} /><Button id="confirm-end-session" type="submit" disabled={controller.saving}>确认结束</Button></div></form>;
}
export function RemoveMemberForm({ ledger, controller, close, member }: FormProps & { member: Member }) {
  const { error, submit } = useFormSubmit(async () => {
    await controller.saveMember(withLedgerSession(ledger, { ...ledger.session, members: ledger.session.members.filter(item => item.id !== member.id) }, {}), `已移除${member.name}`);
    close();
  });
  return <form id="remove-form" onSubmit={submit} className="grid gap-5"><p className="text-sm leading-7">确认移除「{member.name}」？这位成员将从本局排行榜移除，操作记录仍然保留。</p><FormError message={error} /><div className="flex justify-end gap-2"><CloseButton close={close} /><Button id="confirm-remove-member" type="submit" variant="destructive" disabled={controller.saving}>确认移除</Button></div></form>;
}
