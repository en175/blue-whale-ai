"use client";

// IK74V6：Agent 对话面板输入区（从 AgentChatPanel 下沉）。
// 承载 contentEditable 输入器、上传条目、技能/模型/发送按钮；状态归属仍在父组件。
import type { RefObject } from "react";
import { BookOpenText, Box } from "lucide-react";
import DirectSkillTag from "@/components/DirectSkillTag";
import { ComposerShell, ModelSettingsMenu } from "../Composer";
import { IconPlus, IconSend } from "../../icons";
import { UPLOAD_ACCEPT } from "@/lib/uploadRules";
import type { ComposerUploadEntry } from "../chat-panel-lib";
import type { ImageModelCapability } from "../../api/generation";

export interface ChatPanelComposerProps {
  composerRef: RefObject<HTMLDivElement | null>;
  composerEmpty: boolean;
  onComposerInput: () => void;
  onSend: () => void;
  submitting: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** 上传能力是否可用（父组件 onUploadFile 存在时为 true）。 */
  uploadEnabled: boolean;
  uploads: ComposerUploadEntry[];
  anyUploading: boolean;
  onFilePick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUploadRetry: (entryId: string) => void;
  onUploadRemove: (entryId: string) => void;
  pendingForcedSkill: { name: string } | null;
  onRemoveForcedSkill: () => void;
  skillPanelOpen: boolean;
  onOpenSkillPanel: () => void;
  selectedModel: ImageModelCapability | null;
  models: ImageModelCapability[];
  onModelChange: (m: ImageModelCapability) => void;
  modelSettingsOpen: boolean;
  onToggleModelSettings: () => void;
  modelSettingsMenuRef: RefObject<HTMLDivElement | null>;
  modelSettingsTriggerRef: RefObject<HTMLButtonElement | null>;
}

export function ChatPanelComposer({
  composerRef,
  composerEmpty,
  onComposerInput,
  onSend,
  submitting,
  fileInputRef,
  uploadEnabled,
  uploads,
  anyUploading,
  onFilePick,
  onUploadRetry,
  onUploadRemove,
  pendingForcedSkill,
  onRemoveForcedSkill,
  skillPanelOpen,
  onOpenSkillPanel,
  selectedModel,
  models,
  onModelChange,
  modelSettingsOpen,
  onToggleModelSettings,
  modelSettingsMenuRef,
  modelSettingsTriggerRef,
}: ChatPanelComposerProps) {
  return (
            <ComposerShell>
              <div className="relative p-2">
                {pendingForcedSkill && (
                  <div className="px-1 pb-1">
                    <DirectSkillTag
                      name={pendingForcedSkill.name}
                      onRemove={() => onRemoveForcedSkill()}
                    />
                  </div>
                )}
                <div
                  ref={composerRef}
                  className="tc-agent-composer-editor min-h-[40px] max-h-[120px] overflow-y-auto px-3 py-2 text-sm text-white outline-none"
                  data-placeholder="描述你的想法，使用 @ 引用素材"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  data-empty={composerEmpty}
                  data-tour-editor="agent-composer-input"
                  spellCheck={false}
                  autoCorrect="off"
                  onInput={onComposerInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSend();
                    }
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  multiple
                  className="tc-agent-composer-file-input sr-only"
                  onChange={onFilePick}
                  aria-hidden="true"
                  tabIndex={-1}
                />
                {uploads.length > 0 && (
                  <div
                    className="tc-agent-composer-uploads mt-2 flex flex-col gap-1"
                    aria-label="素材上传状态"
                  >
                    {uploads.map((entry) => (
                      <div
                        key={entry.id}
                        data-composer-upload-entry={entry.id}
                        data-composer-upload-status={entry.status}
                        data-composer-upload-asset={entry.assetId ?? undefined}
                        className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-2.5 py-1.5 text-xs"
                      >
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{ color: "var(--tc-text-secondary)" }}
                          title={entry.name}
                        >
                          {entry.name}
                        </span>
                        {entry.status === "uploading" && (
                          <span style={{ color: "var(--tc-text-tertiary)" }}>
                            上传中…
                          </span>
                        )}
                        {entry.status === "success" && (
                          <>
                            <span style={{ color: "var(--tc-success)" }}>
                              已上传
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onUploadRemove(entry.id)
                              }
                              data-composer-upload-remove={entry.id}
                              className="shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.08]"
                              style={{ color: "var(--tc-text-tertiary)" }}
                              aria-label={`移除 ${entry.name}`}
                            >
                              移除
                            </button>
                          </>
                        )}
                        {entry.status === "error" && (
                          <>
                            <span style={{ color: "var(--tc-destructive)" }}>
                              上传失败
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onUploadRetry(entry.id)
                              }
                              data-composer-upload-retry={entry.id}
                              className="shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.08]"
                              style={{ color: "var(--tc-accent)" }}
                              aria-label={`重试上传 ${entry.name}`}
                            >
                              重试
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onUploadRemove(entry.id)
                              }
                              data-composer-upload-remove={entry.id}
                              className="shrink-0 rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.08]"
                              style={{ color: "var(--tc-text-tertiary)" }}
                              aria-label={`移除 ${entry.name}`}
                            >
                              移除
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className="tc-agent-composer-actions mt-2 flex items-center justify-between"
                  aria-label="Composer actions"
                >
                  <div className="tc-agent-composer-actions__start flex items-center gap-1">
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!uploadEnabled}
                        className="tc-agent-upload-btn tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.08] disabled:cursor-default disabled:opacity-40"
                        aria-label="上传素材"
                        data-tooltip="上传图片、视频或音频"
                      >
                        <IconPlus size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSkillPanel()}
                        className="tc-agent-skill-btn tc-agent-composer-pill-btn inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.08]"
                        aria-label="技能"
                        aria-haspopup="dialog"
                        aria-expanded={skillPanelOpen}
                        aria-controls="tc-agent-skill-panel"
                        data-tour-target="agent-skill-button"
                      >
                        <span className="tc-agent-skill-btn__content inline-flex items-center gap-1.5">
                          <BookOpenText size={16} />
                          <span className="tc-agent-skill-btn__label">
                            技能
                          </span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="tc-agent-composer-actions__end flex items-center gap-1">
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <div className="tc-model-settings-selector relative">
                        <button
                          type="button"
                          ref={modelSettingsTriggerRef}
                          onClick={() => onToggleModelSettings()}
                          className="tc-model-settings-trigger tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.08]"
                          aria-haspopup="dialog"
                          aria-expanded={modelSettingsOpen}
                          aria-label={`模型: ${selectedModel?.model_label ?? "加载中…"}`}
                          title="模型"
                        >
                          <Box size={16} />
                        </button>

                        {modelSettingsOpen && selectedModel && (
                          <ModelSettingsMenu
                            model={selectedModel}
                            models={models}
                            onModelChange={onModelChange}
                            onClose={onToggleModelSettings}
                            menuRef={modelSettingsMenuRef}
                            triggerRef={modelSettingsTriggerRef}
                          />
                        )}
                      </div>
                    </div>
                    <div lang="zh-CN" dir="ltr" style={{ display: "contents" }}>
                      <button
                        type="button"
                        onClick={onSend}
                        disabled={
                          composerEmpty || submitting || anyUploading
                        }
                        className="tc-agent-send-btn tc-agent-composer-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/90 disabled:cursor-default disabled:bg-white/[0.1] disabled:text-white/[0.25]"
                        aria-label="发送"
                        aria-disabled={
                          composerEmpty || submitting || anyUploading
                        }
                      >
                        <IconSend size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </ComposerShell>  );
}
