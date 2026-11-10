import { domainError } from '../shared/errors.ts';
import type { Member, Session } from '../shared/types.ts';

// 编辑和删除均绑定打开表单时的成员快照，避免冲突重试覆盖新局或新计数。 Bind edits and removals to the member snapshot shown when the form opened so retries cannot overwrite another session or updated counts.
export function unchangedMember(current: Session, source: Session, member: Member): Member {
  if (current.startedAt !== source.startedAt || current.round !== source.round || current.demo !== source.demo) throw domainError('当前酒局已变更，请关闭窗口后重新选择酒友', 'validate member source');
  if (current.endedAt !== undefined) throw domainError('本局已结束，不能修改酒友', 'validate member source');
  const saved = current.members.find(item => item.id === member.id);
  if (!saved) throw domainError('这位酒友已不在本局，请关闭窗口', 'validate member source');
  if (saved.name !== member.name || saved.color !== member.color || saved.pending !== member.pending || saved.consumed !== member.consumed || saved.cups !== member.cups || saved.cupSize !== member.cupSize) throw domainError('这位酒友的记录已更新，请关闭窗口后重新确认', 'validate member source');
  return saved;
}
