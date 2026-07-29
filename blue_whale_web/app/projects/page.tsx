"use client";

/**
 * 项目管理页（IK25EG）—— 集中管理当前用户的 Canvas Project。
 *
 * 数据来源仅为 GET /api/projects。打开目标为
 * /canvas?project=<id>（刷新可恢复同一项目）。
 * 删除为不可撤销的永久删除，本页二次确认并列出影响；
 * 操作失败只呈现错误，不把列表更新为成功状态。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  createProject,
  deleteProject,
  listProjects,
  renameProject,
} from "@/lib/canvas";

type ProjectRow = {
  id: number;
  name: string;
  createdAt: string;
};

const PILL_BTN =
  "inline-flex items-center gap-1 rounded-lg border border-[var(--tc-border)] px-2.5 py-1 text-xs text-[var(--tc-text-secondary)] transition-colors hover:text-[var(--tc-text-primary)] disabled:cursor-default disabled:opacity-50";

const ICON_BTN =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--tc-text-muted)] transition-colors hover:text-[var(--tc-text-primary)] disabled:cursor-default disabled:opacity-50";

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
}

/** 拉取当前用户的 Canvas Project，按创建时间倒序。 */
async function fetchProjectRows(): Promise<ProjectRow[]> {
  const projects = await listProjects();
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export default function ProjectsPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [createDraft, setCreateDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 首屏与重试：只拉取 Canvas Project 列表。
  useEffect(() => {
    let cancelled = false;
    fetchProjectRows()
      .then((next) => {
        if (cancelled) return;
        setRows(next);
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(errorMessage(e, "加载项目列表失败"));
        }
      })
      .finally(() => {
        if (!cancelled) setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const handleRetry = useCallback(() => {
    setPhase("loading");
    setLoadError(null);
    setReloadNonce((n) => n + 1);
  }, []);

  const handleCreate = useCallback(() => {
    const name = createDraft.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    void (async () => {
      try {
        const dto = await createProject(name);
        router.push(`/canvas?project=${dto.id}`);
      } catch (e) {
        setCreateError(errorMessage(e, "新建项目失败"));
        setCreating(false);
      }
    })();
  }, [createDraft, creating, router]);

  const openRename = useCallback((row: ProjectRow) => {
    setRenamingId(row.id);
    setRenameDraft(row.name);
    setRenameError(null);
  }, []);

  const submitRename = useCallback(() => {
    if (renamingId == null || renaming) return;
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    void (async () => {
      try {
        const dto = await renameProject(renamingId, name);
        setRows((current) =>
          current.map((row) =>
            row.id === renamingId ? { ...row, name: dto.name } : row,
          ),
        );
        setRenamingId(null);
      } catch (e) {
        setRenameError(errorMessage(e, "重命名失败"));
      } finally {
        setRenaming(false);
      }
    })();
  }, [renamingId, renameDraft, renaming]);

  const openDelete = useCallback((row: ProjectRow) => {
    setDeleteTarget(row);
    setDeleteError(null);
  }, []);

  const handleDelete = useCallback(() => {
    if (deleteTarget == null || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const target = deleteTarget;
    void (async () => {
      try {
        await deleteProject(target.id);
        setRows((current) => current.filter((row) => row.id !== target.id));
        setDeleteTarget(null);
      } catch (e) {
        setDeleteError(errorMessage(e, "删除失败"));
      } finally {
        setDeleting(false);
      }
    })();
  }, [deleteTarget, deleting]);

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-outfit text-xl font-semibold text-[var(--tc-text-primary)]">
            项目
          </h1>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <input
              value={createDraft}
              onChange={(e) => setCreateDraft(e.target.value)}
              placeholder="新项目名称"
              aria-label="新项目名称"
              className="w-44 rounded-md border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-2 py-1 text-sm text-[var(--tc-text-primary)] outline-none"
            />
            <button
              type="submit"
              disabled={creating || !createDraft.trim()}
              className={PILL_BTN}
            >
              <Plus width={13} height={13} aria-hidden="true" />
              {creating ? "创建中…" : "新建项目"}
            </button>
          </form>
        </header>
        {createError && (
          <p className="text-sm text-[var(--tc-destructive)]">{createError}</p>
        )}

        {phase === "loading" ? (
          <p className="py-12 text-center text-sm text-[var(--tc-text-muted)]">
            加载中…
          </p>
        ) : loadError != null ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-[var(--tc-destructive)]">{loadError}</p>
            <button type="button" onClick={handleRetry} className={PILL_BTN}>
              重试
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--tc-text-muted)]">
            还没有项目。输入名称新建一个项目开始创作。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-4 py-3"
              >
                {renamingId === row.id ? (
                  <form
                    className="flex flex-1 flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitRename();
                    }}
                  >
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      aria-label="项目名称"
                      autoFocus
                      className="rounded-md border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-2 py-1 text-sm text-[var(--tc-text-primary)] outline-none"
                    />
                    <button
                      type="submit"
                      disabled={renaming}
                      className={PILL_BTN}
                    >
                      {renaming ? "保存中…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      disabled={renaming}
                      className={PILL_BTN}
                    >
                      取消
                    </button>
                    {renameError && (
                      <p className="w-full text-xs text-[var(--tc-destructive)]">
                        {renameError}
                      </p>
                    )}
                  </form>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Link
                        href={`/canvas?project=${row.id}`}
                        className="truncate text-sm font-medium text-[var(--tc-text-primary)] hover:underline"
                      >
                        {row.name}
                      </Link>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--tc-text-muted)]">
                      {formatCreatedAt(row.createdAt)}
                    </span>
                    <button
                      type="button"
                      aria-label={`重命名 ${row.name}`}
                      title="重命名"
                      onClick={() => openRename(row)}
                      className={ICON_BTN}
                    >
                      <Pencil width={13} height={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${row.name}`}
                      title="删除"
                      onClick={() => openDelete(row)}
                      className={ICON_BTN}
                    >
                      <Trash2 width={13} height={13} aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {deleteTarget != null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="永久删除项目"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--tc-bg-overlay)] px-4"
        >
          <div className="w-full max-w-sm rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--tc-text-primary)]">
              永久删除「{deleteTarget.name}」？
            </h2>
            <p className="mt-2 text-xs leading-5 text-[var(--tc-text-secondary)]">
              将永久删除该项目及其画布、对话、生成记录和作品，不可恢复。其他项目中已有的作品副本不受影响。
            </p>
            {deleteError && (
              <p className="mt-2 text-xs text-[var(--tc-destructive)]">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
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
    </main>
  );
}
