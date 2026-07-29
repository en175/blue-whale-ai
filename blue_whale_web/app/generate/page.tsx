"use client";

/**
 * 生成页 /generate：Agent 对话式创作页（IK21O9，替代原参数表单工具页）。
 *
 * 数据模型：生成收件箱（generation_inbox Project，多对话容器）。
 *   - 打开页面只 GET /api/generation-inbox 探测，绝不主动创建 Project；
 *     data=null → 空态（欢迎文案 + 输入框）；首条消息由后端原子创建收件箱+对话+消息。
 *   - 对话态：顶栏（改名 / 新对话 / 历史切换 / 删除）+ 消息流 + 输入框；
 *     消息流复用画布 ChatBubbles 渲染，生成卡片携「添加到项目」入口。
 *   - 恢复/实时：runProjectRecovery（Snapshot + SSE），刷新/重进后进度与结果自动恢复。
 *
 * 闭环：首页 AgentComposer 点生成 → router.push('/generate?prompt=…') → 本页读 ?prompt
 * 预填输入框 → 用户发送首条消息 → 收件箱创建，进入对话态。
 *
 * 颜色一律走 globals.css 的 --tc-* / --background CSS 变量（DESIGN token），不硬编码 hex。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { History, Pencil, Plus, Send, Trash2 } from "lucide-react";
import {
  AgentCard,
  AgentMessageBubble,
  ThinkingBlock,
  UserMessageBubble,
} from "@/app/canvas/_canvas/components/ChatBubbles";
import {
  createInboxConversation,
  deleteGenerationInbox,
  getGenerationInbox,
  listInboxConversations,
  postInboxMessage,
  type GenerationInbox,
  type InboxConversation,
} from "@/lib/generation-inbox";
import { copyAssetToProject } from "@/lib/assets";
import { listProjects, renameProject, type ProjectDto } from "@/lib/canvas";
import { newCommandIdentity } from "@/lib/command-identity";
import {
  deriveAnswerableClarification,
  projectRecoveryTransport,
  runProjectRecovery,
  type ProjectSnapshot,
} from "@/lib/project-recovery";
import { wireIntegersEqual, type WireInteger } from "@/lib/wire-integer";
import { inboxSnapshotToChatMessages } from "./inboxMessages";

const PILL_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-[var(--tc-border)] px-2.5 py-1 text-xs text-[var(--tc-text-secondary)] transition-colors hover:text-[var(--tc-text-primary)] disabled:cursor-default disabled:opacity-50";

function formatConversationTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 页面统一的消息输入框（空态/对话态共用）：Enter 发送，Shift+Enter 换行。 */
function InboxComposer({
  draft,
  sending,
  onDraftChange,
  onSend,
}: {
  draft: string;
  sending: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="w-full rounded-2xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-3">
      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="描述你想生成的图片或视频…"
        rows={3}
        aria-label="消息输入框"
        className="w-full resize-none bg-transparent text-sm leading-6 text-[var(--tc-text-primary)] outline-none placeholder:text-[var(--tc-text-muted)]"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-[var(--tc-text-muted)]">
          Enter 发送 · Shift+Enter 换行
        </span>
        <button
          type="button"
          onClick={onSend}
          disabled={!draft.trim() || sending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--tc-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:cursor-default disabled:bg-[var(--tc-bg-elevated)] disabled:text-[var(--tc-text-muted)]"
        >
          <Send width={12} height={12} />
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </div>
  );
}

export default function GeneratePage() {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [inbox, setInbox] = useState<GenerationInbox | null>(null);
  const [conversationId, setConversationId] = useState<WireInteger | null>(
    null,
  );
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<
    InboxConversation[] | null
  >(null);
  const [conversationsError, setConversationsError] = useState<string | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [addTargetAssetId, setAddTargetAssetId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copiedProject, setCopiedProject] = useState<ProjectDto | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  // 幂等键生命周期：同一次用户操作在重试间复用同一键（参照画布 retryIdempotencyKeysRef 模式），
  // 成功后换新，避免网络重试在后端产生重复消息/对话/副本。
  const sendKeysRef = useRef<{
    text: string;
    clientMessageId: string;
    idempotencyKey: string;
  } | null>(null);
  const newConversationKeyRef = useRef<string | null>(null);
  const copyIdempotencyKeysRef = useRef<Record<string, string>>({});

  // 首屏：探测收件箱（只读，绝不创建）+ 读 ?prompt 预填输入框（首页闭环）。
  useEffect(() => {
    let cancelled = false;
    const p = new URLSearchParams(window.location.search).get("prompt");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p) setDraft(p);
    getGenerationInbox()
      .then((data) => {
        if (cancelled) return;
        setInbox(data);
        setConversationId(data?.active_conversation_id ?? null);
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled)
          setLoadError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 收件箱 Project 级 Snapshot + SSE 恢复闭环（刷新/重进后进度与结果恢复）。
  const projectId = inbox?.project.id ?? null;
  useEffect(() => {
    if (projectId == null) return;
    const controller = new AbortController();
    void runProjectRecovery(
      projectId,
      projectRecoveryTransport,
      (state) => {
        if (controller.signal.aborted) return;
        if (state.deleted) {
          // 收件箱在他端被删 → 回空态
          controller.abort();
          setInbox(null);
          setSnapshot(null);
          setConversationId(null);
          setConversations(null);
          return;
        }
        if (state.snapshot) setSnapshot(state.snapshot);
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [projectId]);

  // 消息视图按当前 conversationId 过滤（多对话）。
  const messages = useMemo(
    () =>
      snapshot && conversationId != null
        ? inboxSnapshotToChatMessages(snapshot, conversationId)
        : [],
    [snapshot, conversationId],
  );

  // 新消息到达后滚到底部。
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const displayName = snapshot?.project.name ?? inbox?.project.name ?? "";

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    void (async () => {
      try {
        // 同一条消息（文本相同）在重试间复用 client/幂等键；发送成功或修改文本后换新。
        let keys = sendKeysRef.current;
        if (!keys || keys.text !== text) {
          keys = {
            text,
            clientMessageId: newCommandIdentity(),
            idempotencyKey: newCommandIdentity(),
          };
          sendKeysRef.current = keys;
        }
        if (!inbox) {
          // 首条消息：后端原子创建收件箱+对话+消息；随后重拉收件箱进入对话态。
          const accepted = await postInboxMessage({
            content: text,
            clientMessageId: keys.clientMessageId,
            idempotencyKey: keys.idempotencyKey,
          });
          sendKeysRef.current = null;
          setDraft("");
          const next = await getGenerationInbox();
          setInbox(next);
          setConversationId(
            next?.active_conversation_id ?? accepted.conversation_id,
          );
        } else {
          // 有可回答的创作澄清时绑定回答（deriveAnswerableClarification）。
          const answerable = deriveAnswerableClarification(snapshot);
          const accepted = await postInboxMessage({
            content: text,
            clientMessageId: keys.clientMessageId,
            idempotencyKey: keys.idempotencyKey,
            conversationId: conversationId ?? undefined,
            replyToInputRequestId: answerable?.input_request_id,
          });
          sendKeysRef.current = null;
          setDraft("");
          if (conversationId == null)
            setConversationId(accepted.conversation_id);
        }
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "发送失败");
      } finally {
        setSending(false);
      }
    })();
  }, [draft, sending, inbox, snapshot, conversationId]);

  const handleNewConversation = useCallback(() => {
    void (async () => {
      try {
        // 失败后重试复用同一幂等键；成功创建后换新（下次点击是新对话）。
        const key = (newConversationKeyRef.current ??= newCommandIdentity());
        const created = await createInboxConversation(key);
        newConversationKeyRef.current = null;
        setConversationId(created.id);
        setConversations((current) =>
          current ? [created, ...current] : current,
        );
        setHistoryOpen(false);
        setSendError(null);
      } catch (e) {
        setSendError(e instanceof Error ? e.message : "新建对话失败");
      }
    })();
  }, []);

  const handleToggleHistory = useCallback(() => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && conversations == null) {
      listInboxConversations()
        .then((list) => {
          setConversations(list);
          setConversationsError(null);
        })
        .catch((e) =>
          setConversationsError(
            e instanceof Error ? e.message : "加载历史失败",
          ),
        );
    }
  }, [historyOpen, conversations]);

  const handleSelectConversation = useCallback((id: WireInteger) => {
    setConversationId(id);
    setHistoryOpen(false);
  }, []);

  const submitRename = useCallback(() => {
    if (!inbox) return;
    const name = renameDraft.trim();
    if (!name || name === displayName) {
      setRenaming(false);
      return;
    }
    void (async () => {
      try {
        const dto = await renameProject(inbox.project.id, name);
        setInbox((current) =>
          current
            ? { ...current, project: { ...current.project, name: dto.name } }
            : current,
        );
        setRenaming(false);
        setRenameError(null);
      } catch (e) {
        setRenameError(e instanceof Error ? e.message : "重命名失败");
      }
    })();
  }, [inbox, renameDraft, displayName]);

  const handleDelete = useCallback(() => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    void (async () => {
      try {
        await deleteGenerationInbox();
        setInbox(null);
        setSnapshot(null);
        setConversationId(null);
        setConversations(null);
        setDeleteOpen(false);
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : "删除失败");
      } finally {
        setDeleting(false);
      }
    })();
  }, [deleting]);

  const openAddToProject = useCallback(
    (assetId: string) => {
      setAddTargetAssetId(assetId);
      setCopiedProject(null);
      setCopyError(null);
      if (projects == null) {
        listProjects()
          .then((list) => {
            setProjects(list);
            setProjectsError(null);
          })
          .catch((e) =>
            setProjectsError(e instanceof Error ? e.message : "加载项目失败"),
          );
      }
    },
    [projects],
  );

  const handleCopyToProject = useCallback(
    (project: ProjectDto) => {
      if (addTargetAssetId == null || copying) return;
      setCopying(true);
      setCopyError(null);
      void (async () => {
        try {
          // 同一资产→同一项目的重试复用同一幂等键（对话框内重复点击不产重复副本）。
          const opKey = `${addTargetAssetId}:${project.id}`;
          const identity = (copyIdempotencyKeysRef.current[opKey] ??=
            newCommandIdentity());
          await copyAssetToProject(project.id, addTargetAssetId, identity);
          setCopiedProject(project);
        } catch (e) {
          setCopyError(e instanceof Error ? e.message : "添加失败");
        } finally {
          setCopying(false);
        }
      })();
    },
    [addTargetAssetId, copying],
  );

  return (
    <main className="flex h-screen flex-col bg-[var(--background)]">
      {phase === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-[var(--tc-text-muted)]">加载中…</p>
        </div>
      ) : inbox == null ? (
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center gap-6 px-4">
          <div className="text-center">
            <h1 className="font-outfit text-2xl font-semibold text-[var(--tc-text-primary)]">
              让 Agent 帮你创作
            </h1>
            <p className="mt-2 text-sm text-[var(--tc-text-secondary)]">
              描述你想生成的图片或视频，发送第一条消息即可开始。
            </p>
          </div>
          {loadError && (
            <p className="text-sm text-[var(--tc-destructive)]">{loadError}</p>
          )}
          {sendError && (
            <p className="text-sm text-[var(--tc-destructive)]">{sendError}</p>
          )}
          <InboxComposer
            draft={draft}
            sending={sending}
            onDraftChange={setDraft}
            onSend={handleSend}
          />
        </div>
      ) : (
        <>
          <header className="border-b border-[var(--tc-border)]">
            <div className="mx-auto flex w-full max-w-[920px] items-center gap-2 px-4 py-3">
              {renaming ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitRename();
                  }}
                >
                  <input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    aria-label="收件箱名称"
                    autoFocus
                    className="rounded-md border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-2 py-1 text-sm text-[var(--tc-text-primary)] outline-none"
                  />
                  <button type="submit" className={PILL_BTN}>
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenaming(false)}
                    className={PILL_BTN}
                  >
                    取消
                  </button>
                </form>
              ) : (
                <>
                  <h1 className="truncate text-sm font-semibold text-[var(--tc-text-primary)]">
                    {displayName}
                  </h1>
                  <button
                    type="button"
                    aria-label="重命名"
                    title="重命名"
                    onClick={() => {
                      setRenameDraft(displayName);
                      setRenameError(null);
                      setRenaming(true);
                    }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--tc-text-muted)] transition-colors hover:text-[var(--tc-text-primary)]"
                  >
                    <Pencil width={13} height={13} />
                  </button>
                </>
              )}
              {renameError && (
                <span className="text-xs text-[var(--tc-destructive)]">
                  {renameError}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNewConversation}
                  className={PILL_BTN}
                >
                  <Plus width={12} height={12} />
                  新对话
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={handleToggleHistory}
                    aria-expanded={historyOpen}
                    className={PILL_BTN}
                  >
                    <History width={12} height={12} />
                    历史
                  </button>
                  {historyOpen && (
                    <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-1 shadow-lg">
                      {conversationsError ? (
                        <p className="px-3 py-2 text-xs text-[var(--tc-destructive)]">
                          {conversationsError}
                        </p>
                      ) : conversations == null ? (
                        <p className="px-3 py-2 text-xs text-[var(--tc-text-muted)]">
                          加载中…
                        </p>
                      ) : conversations.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-[var(--tc-text-muted)]">
                          暂无历史对话
                        </p>
                      ) : (
                        conversations.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleSelectConversation(c.id)}
                            aria-current={
                              conversationId !== null &&
                              wireIntegersEqual(c.id, conversationId)
                            }
                            className={
                              "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left hover:bg-[var(--tc-menu-item-hover)]" +
                              (conversationId !== null &&
                              wireIntegersEqual(c.id, conversationId)
                                ? " bg-[var(--tc-menu-item-hover)]"
                                : "")
                            }
                          >
                            <span className="truncate text-xs text-[var(--tc-text-primary)]">
                              {c.preview || "（空对话）"}
                            </span>
                            <span className="text-[11px] text-[var(--tc-text-muted)]">
                              {formatConversationTime(c.created_at)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--tc-border)] px-2.5 py-1 text-xs text-[var(--tc-destructive)] transition-colors hover:bg-[var(--tc-menu-item-hover)]"
                >
                  <Trash2 width={12} height={12} />
                  删除
                </button>
              </div>
            </div>
          </header>
          <div ref={listRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[920px] flex-col gap-2 px-4 py-4">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--tc-text-muted)]">
                  这个对话还没有消息，描述你的想法开始创作。
                </p>
              ) : (
                messages.map((msg) => {
                  if (msg.type === "user")
                    return <UserMessageBubble key={msg.id} text={msg.text} />;
                  if (msg.type === "thinking")
                    return <ThinkingBlock key={msg.id} msg={msg} />;
                  if (msg.type === "card") {
                    const assetId = msg.assetId;
                    return (
                      <div key={msg.id} className="self-stretch">
                        <AgentCard msg={msg} hideCta />
                        <div className="mt-1 flex items-center gap-2 px-1">
                          {msg.status === "generating" && (
                            <span className="text-xs text-[var(--tc-accent)]">
                              生成中…
                            </span>
                          )}
                          {msg.status === "normal" && assetId && (
                            <button
                              type="button"
                              onClick={() => openAddToProject(assetId)}
                              className="rounded-md border border-[var(--tc-border)] px-2 py-1 text-xs text-[var(--tc-text-secondary)] transition-colors hover:text-[var(--tc-text-primary)]"
                            >
                              添加到项目
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return <AgentMessageBubble key={msg.id} text={msg.text} />;
                })
              )}
            </div>
          </div>
          <div className="mx-auto w-full max-w-[920px] px-4 pb-4">
            {sendError && (
              <p className="mb-2 text-sm text-[var(--tc-destructive)]">
                {sendError}
              </p>
            )}
            <InboxComposer
              draft={draft}
              sending={sending}
              onDraftChange={setDraft}
              onSend={handleSend}
            />
          </div>
        </>
      )}

      {deleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="删除生成收件箱"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--tc-bg-overlay)] px-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--tc-text-primary)]">
              永久删除生成收件箱？
            </h2>
            <p className="mt-2 text-xs leading-5 text-[var(--tc-text-secondary)]">
              将永久删除收件箱及全部对话、生成任务与作品，不可恢复。
            </p>
            {deleteError && (
              <p className="mt-2 text-xs text-[var(--tc-destructive)]">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className={PILL_BTN}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-[var(--tc-destructive)] px-3 py-1.5 text-xs text-white disabled:cursor-default disabled:opacity-50"
              >
                {deleting ? "删除中…" : "永久删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {addTargetAssetId != null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="添加到项目"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--tc-bg-overlay)] px-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--tc-text-primary)]">
              添加到项目
            </h2>
            {copiedProject ? (
              <div className="mt-3">
                <p className="text-xs text-[var(--tc-text-secondary)]">
                  已添加到「{copiedProject.name}」。
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Link
                    href={`/canvas?project=${copiedProject.id}`}
                    className="rounded-lg bg-[var(--tc-accent)] px-3 py-1.5 text-xs text-white"
                  >
                    打开项目
                  </Link>
                  <button
                    type="button"
                    onClick={() => setAddTargetAssetId(null)}
                    className={PILL_BTN}
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-3 max-h-64 overflow-y-auto">
                  {projectsError ? (
                    <p className="text-xs text-[var(--tc-destructive)]">
                      {projectsError}
                    </p>
                  ) : projects == null ? (
                    <p className="text-xs text-[var(--tc-text-muted)]">
                      加载中…
                    </p>
                  ) : projects.length === 0 ? (
                    <p className="text-xs text-[var(--tc-text-muted)]">
                      还没有项目，请先在画布中创建。
                    </p>
                  ) : (
                    projects.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={copying}
                        onClick={() => handleCopyToProject(p)}
                        className="flex w-full items-center rounded-md px-3 py-2 text-left text-xs text-[var(--tc-text-primary)] hover:bg-[var(--tc-menu-item-hover)] disabled:opacity-50"
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
                {copyError && (
                  <p className="mt-2 text-xs text-[var(--tc-destructive)]">
                    {copyError}
                  </p>
                )}
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAddTargetAssetId(null)}
                    disabled={copying}
                    className={PILL_BTN}
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
