import { Plus, X } from "@phosphor-icons/react";
import type { Goal, GoalMemberRef } from "@timedata/shared";
import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon.js";
import { SelectSheet, type SelectOption } from "../../components/ui/SelectSheet.js";
import type { GoalMember } from "../../lib/goalsView.js";

interface GoalPrerequisiteEditorProps {
  members: GoalMember[];
  prerequisites: Goal["prerequisites"];
  onChange: (next: Goal["prerequisites"]) => void;
}

function memberKey(ref: GoalMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

function memberLabel(member: GoalMember): string {
  return `${member.kind === "task" ? "任务" : "轨道"} · ${member.title}`;
}

function missingMemberLabel(ref: GoalMemberRef): string {
  return `${ref.kind === "task" ? "任务" : "轨道"} · 已失效成员`;
}

function memberOptions(members: GoalMember[]): SelectOption<string>[] {
  return members.map((member) => ({ value: memberKey(member), label: memberLabel(member) }));
}

export function GoalPrerequisiteEditor({ members, prerequisites, onChange }: GoalPrerequisiteEditorProps) {
  const [blocker, setBlocker] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const options = useMemo(() => memberOptions(members), [members]);
  const memberByKey = useMemo(() => new Map(members.map((member) => [memberKey(member), member])), [members]);
  const labelByKey = useMemo(() => new Map(members.map((member) => [memberKey(member), memberLabel(member)])), [members]);

  function addEdge(): void {
    if (!blocker || !blocked || blocker === blocked) return;
    const blockerMember = memberByKey.get(blocker);
    const blockedMember = memberByKey.get(blocked);
    if (!blockerMember || !blockedMember) return;
    if (prerequisites.some((edge) => memberKey(edge.blocker) === blocker && memberKey(edge.blocked) === blocked)) return;
    onChange([
      ...prerequisites,
      {
        blocker: { kind: blockerMember.kind, id: blockerMember.id },
        blocked: { kind: blockedMember.kind, id: blockedMember.id },
      },
    ]);
    setBlocked(null);
  }

  function removeEdge(blockerKey: string, blockedKey: string): void {
    onChange(prerequisites.filter((edge) => memberKey(edge.blocker) !== blockerKey || memberKey(edge.blocked) !== blockedKey));
  }

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-ink">前置关系</h2>
        <span className="text-xs text-ink-3">{prerequisites.length} 条</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <SelectSheet label="选择前置成员" placeholder="选择前置成员" value={blocker} options={options} onChange={setBlocker} />
        <SelectSheet label="选择受阻成员" placeholder="选择受阻成员" value={blocked} options={options} onChange={setBlocked} />
        <button
          type="button"
          aria-label="添加前置关系"
          onClick={addEdge}
          className="flex min-h-11 items-center justify-center rounded-ctl bg-accent px-3 text-sm text-page hover:bg-accent-strong"
        >
          <Icon icon={Plus} size={18} />
        </button>
      </div>
      {prerequisites.length === 0 ? (
        <p className="mt-3 rounded-row border border-dashed border-border-hairline px-3 py-4 text-center text-sm text-ink-3">
          暂无前置关系
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border-hairline">
          {prerequisites.map((edge) => {
            const blockerKey = memberKey(edge.blocker);
            const blockedKey = memberKey(edge.blocked);
            const blockerTitle = labelByKey.get(blockerKey) ?? missingMemberLabel(edge.blocker);
            const blockedTitle = labelByKey.get(blockedKey) ?? missingMemberLabel(edge.blocked);
            return (
              <li key={`${blockerKey}->${blockedKey}`} className="flex min-h-11 items-center gap-3 py-2">
                <p className="min-w-0 flex-1 break-words text-sm text-ink">
                  {blockerTitle} {"->"} {blockedTitle}
                </p>
                <button
                  type="button"
                  aria-label={`删除前置关系 ${blockerTitle} 到 ${blockedTitle}`}
                  onClick={() => removeEdge(blockerKey, blockedKey)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl bg-surface-elevated text-ink-3 hover:text-danger"
                >
                  <Icon icon={X} size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
