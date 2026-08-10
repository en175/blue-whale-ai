"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileText,
  MessageSquareText,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { skillsApi } from "../api/skills";
import {
  validateSkillUpload,
  type SkillUploadValidation,
} from "@/lib/skills/validate-skill-upload";

/** SKILL.md 编辑器初始模板（IK60WU）。 */
const SKILL_MD_TEMPLATE = `---
name: 
description: 
---

`;

/** 上传模式的已选文件状态（IK60WW）：原文独立持有，不进编写编辑器。 */
type UploadState = {
  fileName: string;
  content: string;
  validation: SkillUploadValidation;
};

/** 创建技能：编写 SKILL.md（IK60WU）/ 上传 SKILL.md（IK60WW）双模式 + 总结当前对话入口（IK60X1）。
 *  编写：手写含 YAML frontmatter 的完整 SKILL.md。
 *  上传：选择或拖入单个 .md 文件，客户端预校验后显式保存。
 *  总结当前对话：仅 canvas 宿主提供回调时渲染；点击交给宿主关面板并预填固定提示词，
 *  由用户在对话输入框审阅后手动发送，面板内不产出本地草稿（契约 §15.1）。
 *  模式切换不清除两边状态；仅明确点击「保存到我的技能」才创建资产；
 *  草稿/已选文件在 tab 切换/面板关闭时保留，脏态离开需确认。 */
export function CreateContent({
  onSaved,
  registerDirtyCheck,
  onSummarizeConversation,
}: {
  onSaved: () => void;
  registerDirtyCheck: (fn: () => boolean) => void;
  onSummarizeConversation?: () => void;
}) {
  const [mode, setMode] = useState<"write" | "upload">("write");
  const [draft, setDraft] = useState(SKILL_MD_TEMPLATE);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const draftDirty = draft !== SKILL_MD_TEMPLATE;
  const uploadValid = upload !== null && upload.validation.ok;
  const canSave = mode === "write" ? draftDirty : uploadValid;

  useEffect(() => {
    registerDirtyCheck(() => draft !== SKILL_MD_TEMPLATE || upload !== null);
  }, [draft, upload, registerDirtyCheck]);

  const acceptFile = async (file: File) => {
    setError(null);
    const content = await file.text();
    setUpload({
      fileName: file.name,
      content,
      validation: validateSkillUpload({ fileName: file.name, content }),
    });
  };

  const handleSave = async () => {
    let content: string;
    if (mode === "upload") {
      if (!upload || !upload.validation.ok) return;
      content = upload.content;
    } else {
      content = draft;
    }
    setSaving(true);
    setError(null);
    try {
      await skillsApi.createPersonalSkill(content);
      setDraft(SKILL_MD_TEMPLATE);
      setUpload(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  /** AI 格式化（IK60X0）：仅编写模式、显式点击触发；成功整段替换草稿，
   *  不保存、不创建资产，用户可继续编辑；失败保留原草稿并显示错误。 */
  const handleFormat = async () => {
    setFormatting(true);
    setError(null);
    try {
      const res = await skillsApi.formatSkillDraft(draft);
      setDraft(res.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 格式化失败");
    } finally {
      setFormatting(false);
    }
  };

  const modeBtn = (m: "write" | "upload", label: string) => (
    <button
      type="button"
      data-testid={`skill-create-mode-${m}`}
      aria-pressed={mode === m}
      className={`h-7 px-3 rounded-full text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors ${
        mode === m
          ? "bg-white/[0.14] text-white/90"
          : "text-white/45 hover:text-white/75 hover:bg-white/[0.06]"
      }`}
      onClick={() => setMode(m)}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="skill-create-editor"
      className="tc-agent-skill-panel__content flex flex-col flex-1 min-h-0 overflow-hidden bg-[var(--tc-login-modal-bg)]"
    >
      {/* 窄断点允许整组换行，按钮文字保持不换行不竖排（IK6H3O） */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4 py-2.5 border-b border-white/[0.08]">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="创建模式"
        >
          {modeBtn("write", "编写")}
          {modeBtn("upload", "上传 SKILL.md")}
        </div>
        <div className="flex items-center gap-2">
          {onSummarizeConversation && (
            <button
              type="button"
              data-testid="skill-summarize-entry"
              onClick={onSummarizeConversation}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-8 px-3.5 text-[13px] font-medium rounded-lg border border-white/[0.12] text-white/75 hover:bg-white/[0.06] transition-colors"
            >
              <MessageSquareText size={14} />
              总结当前对话
            </button>
          )}
          {mode === "write" && (
            <button
              type="button"
              data-testid="skill-ai-format-btn"
              disabled={saving || formatting || !draftDirty}
              onClick={handleFormat}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-8 px-3.5 text-[13px] font-medium rounded-lg border border-white/[0.12] text-white/75 hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Sparkles size={14} />
              {formatting ? "格式化中…" : "AI 格式化"}
            </button>
          )}
          <button
            type="button"
            data-testid="skill-save-btn"
            disabled={saving || formatting || !canSave}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 h-8 px-3.5 text-[13px] font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            <Check size={14} />
            保存到我的技能
          </button>
        </div>
      </div>
      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[12px] text-white/60 bg-white/[0.04] border-b border-white/[0.08]">
          <span className="truncate">{error}</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2 hover:text-white/90"
            onClick={() => setError(null)}
          >
            关闭
          </button>
        </div>
      )}
      {mode === "write" ? (
        <textarea
          data-testid="skill-md-editor"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="skill-md-textarea flex-1 w-full resize-none bg-transparent p-4 text-[13px] leading-relaxed text-white/90 font-mono outline-none placeholder:text-white/30 overflow-y-auto"
          placeholder={SKILL_MD_TEMPLATE}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,text/markdown"
            data-testid="skill-upload-input"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void acceptFile(file);
              e.target.value = "";
            }}
          />
          {upload === null ? (
            <div
              data-testid="skill-upload-dropzone"
              role="button"
              tabIndex={0}
              aria-label="选择或拖入 SKILL.md 文件"
              className="flex flex-col items-center justify-center gap-2 h-full min-h-[240px] rounded-xl border border-dashed border-white/[0.16] text-white/45 hover:text-white/70 hover:bg-white/[0.03] transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void acceptFile(file);
              }}
            >
              <Upload size={20} aria-hidden="true" />
              <span className="text-[13px]">选择或拖入单个 .md 文件</span>
              <span className="text-[12px] text-white/30">
                需包含 YAML frontmatter（name / description）与正文
              </span>
            </div>
          ) : (
            <div
              data-testid="skill-upload-file"
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void acceptFile(file);
              }}
            >
              <div className="flex items-center gap-2.5">
                <FileText
                  size={16}
                  className="shrink-0 text-white/60"
                  aria-hidden="true"
                />
                <span className="text-[13px] font-medium text-white/90 truncate">
                  {upload.fileName}
                </span>
                <button
                  type="button"
                  data-testid="skill-upload-remove"
                  aria-label="移除已选文件"
                  className="ml-auto shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg text-white/45 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
                  onClick={() => {
                    setUpload(null);
                    setError(null);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="mt-2 text-[12px]">
                {upload.validation.ok ? (
                  <span
                    data-testid="skill-upload-status-ok"
                    className="inline-flex items-center gap-1.5 text-success"
                  >
                    <Check size={12} aria-hidden="true" />
                    校验通过 · {upload.validation.name} /{" "}
                    {upload.validation.description}
                  </span>
                ) : (
                  <span
                    data-testid="skill-upload-status-error"
                    className="text-[var(--tc-destructive)]"
                  >
                    {upload.validation.error}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="mt-3 text-[12px] text-white/60 underline underline-offset-2 hover:text-white/90"
                onClick={() => fileInputRef.current?.click()}
              >
                重新选择文件
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
