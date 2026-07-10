"use client";

import { Check, FileText, FileUp, WandSparkles } from "lucide-react";

/**
 * "创建 Skill" tab 容器：写 / 上传 SKILL.md 切换 + 编辑器 + 保存按钮。
 * 拆自原 components/SkillPanel.tsx（IJZYVO）。
 */

type CreateMode = "write" | "upload";

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`tc-agent-skill-create__mode-btn inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium rounded-lg transition-colors ${
        active
          ? "tc-agent-skill-create__mode-btn--active text-white/95"
          : "text-white/45 hover:text-white/70 hover:bg-white/[0.05]"
      }`}
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );
}

export default function CreateSkillContent({
  mode,
  setMode,
  skillMd,
  setSkillMd,
}: {
  mode: CreateMode;
  setMode: (v: CreateMode) => void;
  skillMd: string;
  setSkillMd: (v: string) => void;
}) {
  return (
    <div className="tc-agent-skill-panel__content flex-1 min-h-0 overflow-y-auto p-4">
      <div className="tc-agent-skill-create flex flex-col gap-4">
        <div
          className="tc-agent-skill-create__mode flex items-center gap-2"
          role="tablist"
          aria-label="创建 Skill 方式"
        >
          <ModeButton
            active={mode === "write"}
            onClick={() => setMode("write")}
            icon={FileText}
            label="编写 SKILL.md"
          />
          <ModeButton
            active={mode === "upload"}
            onClick={() => setMode("upload")}
            icon={FileUp}
            label="上传 SKILL.md"
          />
        </div>
        <div className="tc-agent-skill-create__panel">
          {mode === "write" ? (
            <div className="tc-agent-skill-create__editor-wrap">
              <label className="tc-agent-skill-create__editor flex flex-col gap-2">
                <span className="text-[13px] font-medium text-white/70">
                  SKILL.md
                </span>
                <textarea
                  className="w-full h-64 bg-[#151515] border border-white/[0.08] rounded-lg p-3 text-[13px] text-white/85 leading-relaxed outline-none resize-none focus:border-white/20 placeholder:text-white/25"
                  placeholder="在此编写或粘贴 SKILL.md，需包含 name 与 description 的 frontmatter。"
                  spellCheck={false}
                  value={skillMd}
                  onChange={(e) => setSkillMd(e.target.value)}
                />
              </label>
            </div>
          ) : (
            <div className="tc-agent-skill-create__upload-placeholder flex flex-col items-center justify-center h-64 rounded-lg border border-dashed border-white/10 text-white/40 text-sm">
              上传 SKILL.md 文件占位区
            </div>
          )}
          <div className="tc-agent-skill-panel__actions tc-agent-skill-panel__actions--right flex justify-end gap-2 mt-4">
            <button
              type="button"
              className="tc-agent-skill-panel__secondary-action inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-white/70 rounded-lg border border-white/[0.08] hover:bg-white/[0.05] transition-colors"
            >
              <WandSparkles size={14} aria-hidden="true" />
              <span>AI 格式化</span>
            </button>
            <button
              type="button"
              className="tc-agent-skill-panel__primary-action inline-flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-black bg-white rounded-lg border border-white hover:bg-[#f0f0f0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!skillMd.trim()}
            >
              <Check size={14} />
              <span>保存到我的 Skills</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
