"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { skillsApi, type SkillMineItem } from "../api/skills";

/** 个人技能只读视图（IK60WZ，契约 §13.1）：拉取重建的完整 SKILL.md 原文展示，
 *  可复制 Markdown 到剪贴板；不可编辑、不提供下载。非 owner 端点返回 100100 → 错误态。 */
export function PersonalSkillViewer({
  skill,
  onClose,
}: {
  skill: SkillMineItem;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 个人行正常都有稳定身份；缺失属异常数据，渲染期直接给错误态，不发请求
  const missingId = skill.creative_skill_id === null;

  useEffect(() => {
    if (missingId) return;
    let cancelled = false;
    skillsApi
      .getPersonalSkill(skill.creative_skill_id as string)
      .then((res) => {
        if (!cancelled) setContent(res.content);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [missingId, skill.creative_skill_id]);

  const handleCopy = async () => {
    if (content === null) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none"
      onMouseDown={(e) => {
        if (e.button === 0) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        data-testid="skill-personal-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`查看技能：${skill.name ?? ""}`}
        className="bg-[var(--tc-login-modal-bg)] border border-white/[0.12] rounded-2xl shadow-[var(--tc-modal-shadow)] w-[640px] max-w-[calc(100vw-96px)] max-h-[calc(100vh-128px)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // ESC 只关本弹层，不冒到 window 关掉整个技能面板
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-semibold text-white/90 truncate">
              {skill.name ?? "—"}
            </span>
            <span className="shrink-0 text-[11px] text-white/40">
              SKILL.md · 只读
            </span>
          </div>
          <button
            type="button"
            data-testid="skill-personal-viewer-close"
            aria-label="关闭查看"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {missingId ? (
            <div
              data-testid="skill-personal-viewer-error"
              className="text-[12px] text-white/60"
            >
              该技能缺少稳定身份，无法查看
            </div>
          ) : error ? (
            <div
              data-testid="skill-personal-viewer-error"
              className="text-[12px] text-white/60"
            >
              {error}
            </div>
          ) : content === null ? (
            <div className="text-[12px] text-white/40">加载中…</div>
          ) : (
            <pre
              data-testid="skill-personal-viewer-content"
              className="text-[12px] leading-relaxed text-white/80 font-mono whitespace-pre-wrap break-words select-text"
            >
              {content}
            </pre>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/[0.08]">
          <button
            type="button"
            className="h-8 px-3 rounded-lg text-[12px] text-white/70 border border-white/[0.08] hover:bg-white/[0.06] hover:text-white transition-colors"
            onClick={onClose}
          >
            关闭
          </button>
          <button
            type="button"
            data-testid="skill-personal-viewer-copy"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={content === null}
            onClick={handleCopy}
          >
            {copied ? <Check size={13} aria-hidden="true" /> : null}
            {copied ? "已复制" : "复制 Markdown"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 个人技能永久删除确认框（IK60WZ，契约 §13.2）：显示技能名并明确不可逆后果；
 *  确认后调删除端点，成功由调用方移除卡片；失败在框内显示错误、不关闭。 */
export function PersonalSkillDeleteDialog({
  skill,
  onCancel,
  onConfirm,
}: {
  skill: SkillMineItem;
  onCancel: () => void;
  onConfirm: (creativeSkillId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayName = skill.name ?? "—";

  const handleConfirm = async () => {
    if (!skill.creative_skill_id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(skill.creative_skill_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败，请重试");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150 motion-reduce:animate-none"
      onMouseDown={(e) => {
        if (e.button === 0 && !busy) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div
        data-testid="skill-personal-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={`删除技能：${displayName}`}
        className="bg-[var(--tc-login-modal-bg)] border border-white/[0.12] rounded-2xl shadow-[var(--tc-modal-shadow)] w-[400px] max-w-[calc(100vw-96px)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[14px] font-semibold text-white/90">
            删除技能
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-white/70 break-words">
            确认删除「{displayName}」？
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-white/50">
            删除后该技能的正文不可查看、复制或复用，且无法恢复。
          </p>
          {error && (
            <p
              data-testid="skill-personal-delete-error"
              className="mt-2 text-[12px] text-[var(--tc-destructive)]"
            >
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            data-testid="skill-personal-delete-cancel"
            className="h-8 px-3 rounded-lg text-[12px] text-white/70 border border-white/[0.08] hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="skill-personal-delete-confirm"
            className="h-8 px-3 rounded-lg text-[12px] font-medium text-white bg-[var(--tc-destructive)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:pointer-events-none"
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? "删除中…" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
