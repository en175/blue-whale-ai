import { ChevronDown, Plus } from "lucide-react";
import type { AgentSessionSummary } from "@/lib/agent-service/client";

export type AgentPanelPersistence = {
  sessions: AgentSessionSummary[];
  selectedSessionId: string | null;
  loading?: boolean;
  error?: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onCancel?: () => Promise<void>;
  onResume?: () => Promise<void>;
  onSkip?: () => Promise<void>;
};

export function AgentSessionPicker({
  sessions,
  selectedSessionId,
  loading,
  onSelect,
  onNew,
}: {
  sessions: AgentSessionSummary[];
  selectedSessionId: string | null;
  loading?: boolean;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
}) {
  const selected = sessions.find(
    (session) => session.session_id === selectedSessionId,
  );
  return (
    <div className="tc-agent-session-picker relative flex min-w-0 flex-1 items-center gap-1">
      <details className="group relative min-w-0 flex-1">
        <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-xs text-white/80 transition-colors hover:bg-white/[0.06] [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 truncate">
            {loading ? "加载会话…" : (selected?.title ?? "新对话")}
          </span>
          <ChevronDown
            size={13}
            className="shrink-0 text-white/45 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="absolute left-0 top-8 z-[30] w-72 overflow-hidden rounded-lg border border-white/[0.08] bg-[var(--tc-surface-primary)] p-1 shadow-[var(--tc-dropdown-shadow)]">
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-white/85 transition-colors hover:bg-white/[0.08]"
          >
            <Plus size={14} />
            新对话
          </button>
          {sessions.length > 0 && <div className="my-1 h-px bg-white/[0.06]" />}
          <div className="max-h-64 overflow-y-auto">
            {sessions.map((session) => (
              <button
                key={session.session_id}
                type="button"
                onClick={() => onSelect(session.session_id)}
                aria-current={
                  session.session_id === selectedSessionId ? "true" : undefined
                }
                className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-white/[0.08] aria-[current=true]:bg-white/[0.08]"
              >
                <span className="w-full truncate text-xs text-white/85">
                  {session.title}
                </span>
                <span className="text-[10px] text-white/40">
                  {new Date(session.updated_at).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </button>
            ))}
          </div>
        </div>
      </details>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
        aria-label="新建 Agent 对话"
        title="新对话"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
