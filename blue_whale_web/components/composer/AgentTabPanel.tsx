"use client";

// IK74TX：视频智能体 tab 面板（从 AgentComposer 拆出，对齐 VideoTabPanel/ImageTabPanel）。
// 行为零变化：参数状态与素材状态仍由常驻的 AgentComposer 持有（AgentTabPanel 随 tab
// 条件渲染，卸载即丢失——状态放父级才能跨 tab 保留，对齐工单 6.1「切换 Tab 不清空」）。
// 本组件仅保留 dropdown 的局部展开状态，与 VideoTabPanel/ImageTabPanel 一致。
import { useRef, useState, type RefObject } from "react";
import {
  ArrowUp,
  BookOpenText,
  ChevronDown,
  Plus,
  RefreshCw,
  Sparkle,
  X,
} from "lucide-react";
import PromptEditor, { type PromptEditorHandle } from "../prompt/PromptEditor";
import { useClickOutsideClose } from "./useClickOutsideClose";
import type { ImageModelCapability } from "@/app/canvas/_canvas/api/generation";
import type { MediaItem } from "./types";
import { ClearPromptButton } from "./ClearPromptButton";
import DirectSkillTag from "../DirectSkillTag";
import SkillPanel, { type UseSkillSelection } from "../skill/SkillPanel";
import type { DirectSkillBinding } from "@/lib/direct-skill-binding";

/**
 * 费用倍率占位（IK70CM）：generation_model_capability 无 costMultiplier 字段，
 * 先统一 1x，待模型管理后台/Go 后端提供真实费用数据后接上。
 */
const AGENT_COST_MULTIPLIER = "1x";

export interface AgentTabPanelProps {
  value: string;
  onChange: (text: string) => void;
  editorRef: RefObject<PromptEditorHandle | null>;
  onFocusChange: (focused: boolean) => void;
  mediaList: MediaItem[];
  removeMedia: (id: string) => void;
  clearPrompt: () => void;
  onGenerate: () => void;
  dropClass: string;
  /** 上传文件 input（父组件持有，面板触发 click）。 */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** 替换素材（3.5）：记录目标 id 后唤起文件选择器。 */
  onReplaceMedia: (id: string) => void;
  /** 素材上传上限（3.2）：当前模型 max_reference_images；达上限后上传入口置灰。 */
  maxReferenceImages: number;
  /** 「直接使用」一次性技能绑定（IK60WY），父组件持有（跨 tab 保留）。 */
  boundSkill: DirectSkillBinding | null;
  onRemoveBoundSkill: () => void;
  skillPanelOpen: boolean;
  setSkillPanelOpen: (open: boolean) => void;
  onUseSkill: (skill: UseSkillSelection) => void;
  videoModels: ImageModelCapability[];
  selectedModel: ImageModelCapability | null;
  setSelectedModel: (model: ImageModelCapability) => void;
  agentModels: ImageModelCapability[];
  selectedAgentModel: ImageModelCapability | null;
  setSelectedAgentModel: (model: ImageModelCapability) => void;
}

export function AgentTabPanel({
  value,
  onChange,
  editorRef,
  onFocusChange,
  mediaList,
  removeMedia,
  clearPrompt,
  onGenerate,
  dropClass,
  fileInputRef,
  onReplaceMedia,
  maxReferenceImages,
  boundSkill,
  onRemoveBoundSkill,
  skillPanelOpen,
  setSkillPanelOpen,
  onUseSkill,
  videoModels,
  selectedModel,
  setSelectedModel,
  agentModels,
  selectedAgentModel,
  setSelectedAgentModel,
}: AgentTabPanelProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [agentModelOpen, setAgentModelOpen] = useState(false);
  const modelContainerRef = useRef<HTMLDivElement>(null);
  const agentModelContainerRef = useRef<HTMLDivElement>(null);

  useClickOutsideClose(modelContainerRef, modelOpen, () => setModelOpen(false));
  useClickOutsideClose(agentModelContainerRef, agentModelOpen, () =>
    setAgentModelOpen(false),
  );

  // IK74TX 3.2：达上限后所有上传入口置灰。
  const atLimit = mediaList.length >= maxReferenceImages;

  return (
    <>
      {/* Media list */}
      {mediaList.length > 0 && (
        <div className="shrink-0 flex flex-row flex-wrap items-start gap-2 px-3 pt-3">
          {mediaList.map((item) => (
            <div
              key={item.id}
              className="mediaListItem group/card relative flex flex-col items-center shrink-0 cursor-pointer transition-opacity duration-150 hover:opacity-85 w-14"
              title={item.name}
            >
              <div className="mediaListThumbWrapper relative rounded-md object-cover block border border-white/[0.08] w-[52px] h-[52px]">
                <img
                  className="rounded-md object-cover block border border-white/[0.08] w-[52px] h-[52px]"
                  alt={item.name}
                  draggable={false}
                  src={item.src}
                />
                {item.duration && (
                  <span className="absolute bottom-1 right-1 z-[2] px-[5px] py-px text-[10px] font-medium font-mono text-white bg-black/60 rounded leading-[1.4] select-none pointer-events-none">
                    {item.duration}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onReplaceMedia(item.id)}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full bg-black/60 border border-white/20 text-white cursor-pointer z-[2] opacity-0 transition-all duration-150 ease-out group-hover/card:opacity-100 hover:bg-black/80 hover:scale-105 h-5 w-5"
                  aria-label="替换"
                >
                  <RefreshCw width={11} height={11} />
                </button>
              </div>
              <span className="text-white/40 whitespace-nowrap overflow-hidden text-ellipsis text-center mt-[3px] text-[10px] max-w-[56px]">
                {item.name}
              </span>
              <button
                type="button"
                onClick={() => removeMedia(item.id)}
                className="absolute flex items-center justify-center rounded-full text-white/50 cursor-pointer z-[3] transition-opacity duration-150 opacity-0 group-hover/card:opacity-100 hover:text-white bg-[rgba(50,50,54,0.95)] -top-[3px] -right-px w-4 h-4"
                aria-label="移除"
              >
                <X width={12} height={12} />
              </button>
            </div>
          ))}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={atLimit}
              title={atLimit ? "已达上传上限" : undefined}
              className={`rounded-lg w-[52px] h-[52px] flex items-center justify-center transition-all duration-150 ${
                atLimit
                  ? "text-white/20 bg-white/[0.02] cursor-not-allowed"
                  : "text-white/30 bg-white/[0.025] cursor-pointer hover:text-white/50 hover:bg-white/[0.05]"
              }`}
              aria-label="上传参考"
            >
              <Plus width={12} height={12} />
            </button>
          </div>
        </div>
      )}

      {boundSkill && (
        <div className="px-4 pt-3">
          <DirectSkillTag
            name={boundSkill.name}
            onRemove={onRemoveBoundSkill}
          />
        </div>
      )}

      <div className="relative min-h-[120px]">
        <PromptEditor
          key="agent-editor"
          ref={editorRef}
          value={value ?? ""}
          onChange={onChange}
          placeholder={`描述你想制作的视频，微电影、产品广告、社媒视频等都可支持。适合 1-5 分钟视频。`}
          className="w-full"
          onFocusChange={onFocusChange}
          onSend={onGenerate}
        />
        <ClearPromptButton
          visible={Boolean((value ?? "").trim())}
          onClear={clearPrompt}
        />
      </div>

      {/* Toolbar */}
      <div className="mt-auto flex flex-wrap items-center gap-2 py-3 px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={atLimit}
            className={`ncs-tooltip-simple inline-flex items-center gap-1 h-8 px-2.5 text-[13px] font-medium rounded-lg bg-transparent border border-white/[0.06] transition-all duration-150 whitespace-nowrap ${
              atLimit
                ? "text-white/25 cursor-not-allowed"
                : "text-white/45 cursor-pointer hover:text-white/70 hover:bg-white/[0.05]"
            }`}
            data-tooltip={atLimit ? "已达上传上限" : "支持上传图片、视频、音频"}
            aria-label="上传文件"
          >
            <Plus width={13} height={13} />
          </button>
          <button
            type="button"
            onClick={() => setSkillPanelOpen(true)}
            className="inline-flex items-center gap-1 h-8 px-3 text-[13px] font-medium text-white/35 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-colors duration-150 whitespace-nowrap hover:bg-white/[0.05] hover:text-white/70"
            aria-label="Skills"
            aria-haspopup="dialog"
            aria-expanded={skillPanelOpen}
            aria-controls="home-canvas-skill-panel"
          >
            <BookOpenText
              width={13}
              height={13}
              className="translate-y-px"
              aria-hidden="true"
            />
            <span className="whitespace-nowrap">Skill</span>
          </button>
          <div className="relative" ref={modelContainerRef}>
            <div className="relative" data-param-dropdown-root="true">
              <button
                type="button"
                onClick={() => setModelOpen((v) => !v)}
                className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                aria-label="选择模型"
                aria-expanded={modelOpen}
              >
                <span className="whitespace-nowrap">
                  {selectedModel?.model_label ?? "加载中…"}
                </span>
                <ChevronDown
                  width={11}
                  height={11}
                  className={`transition-transform duration-150 ${
                    modelOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {modelOpen && (
                <div
                  className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                >
                  {videoModels.map((model) => (
                    <button
                      key={model.model_id}
                      type="button"
                      onClick={() => {
                        setSelectedModel(model);
                        setModelOpen(false);
                      }}
                      className={`flex items-center gap-2 w-full text-left text-[13px] font-medium py-2 px-3 rounded-md cursor-pointer border-none transition-all duration-150 whitespace-nowrap hover:bg-white/[0.08] hover:text-white justify-between ${
                        selectedModel?.model_id === model.model_id
                          ? "text-white bg-white/[0.04]"
                          : "text-white/80 bg-transparent"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span className="truncate">{model.model_label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="relative ml-auto flex items-center gap-3">
            <div className="flex items-center gap-0.5">
              <div className="relative" ref={agentModelContainerRef}>
                <button
                  type="button"
                  onClick={() => setAgentModelOpen((v) => !v)}
                  className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                  aria-haspopup="listbox"
                  aria-expanded={agentModelOpen}
                  aria-label="选择模型"
                >
                  <span className="whitespace-nowrap">
                    {selectedAgentModel?.model_label ?? "加载中…"}
                  </span>
                  <ChevronDown
                    width={11}
                    height={11}
                    className={`transition-transform duration-150 ${
                      agentModelOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {agentModelOpen && (
                  <div
                    className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                    role="listbox"
                    aria-label="选择模型"
                  >
                    {agentModels.map((model) => {
                      const selected =
                        selectedAgentModel?.model_id === model.model_id;
                      return (
                        <button
                          key={model.model_id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setSelectedAgentModel(model);
                            setAgentModelOpen(false);
                          }}
                          className={`flex items-center gap-2 w-full text-left text-[13px] font-medium py-2 px-3 rounded-md cursor-pointer border-none transition-all duration-150 whitespace-nowrap hover:bg-white/[0.08] hover:text-white justify-between ${
                            selected
                              ? "text-white bg-white/[0.04]"
                              : "text-white/80 bg-transparent"
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span className="truncate">
                              {model.model_label}
                            </span>
                          </span>
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] leading-[1.2] text-white/55"
                            aria-label={`费用 ${AGENT_COST_MULTIPLIER}`}
                          >
                            <span>💰 费用</span>
                            <span className="tabular-nums text-white/70">
                              {AGENT_COST_MULTIPLIER}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Credits */}
              <div className="relative inline-flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium font-mono whitespace-nowrap py-0.5 px-1.5 rounded-sm transition-all duration-150 relative cursor-pointer text-white/35 hover:bg-white/[0.06] hover:text-white/50"
                  aria-label="积分：9"
                >
                  <span className="inline-flex items-center gap-1">
                    <Sparkle
                      width={14}
                      height={14}
                      className="shrink-0"
                    />
                    <span className="font-semibold">9</span>
                  </span>
                </button>
                <span className="inline-flex items-center gap-[3px] absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 text-[10px] text-green-400/70 cursor-pointer whitespace-nowrap z-10 hover:text-green-400">
                  或尝试无限
                </span>
              </div>

              {/* Generate button */}
              <button
                type="button"
                disabled={!Boolean((value ?? "").trim()) && mediaList.length === 0}
                className={`flex items-center justify-center rounded-lg transition-all duration-200 p-0 border-none shrink-0 w-8 h-8 ${
                  !Boolean((value ?? "").trim()) && mediaList.length === 0
                    ? "bg-white/20 text-black/40 cursor-not-allowed shadow-none"
                    : "bg-white text-black cursor-pointer shadow-[0_2px_8px_rgba(255,255,255,0.1)] hover:bg-[#f0f0f0] hover:scale-105 hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(255,255,255,0.15)] active:scale-95"
                }`}
                aria-label="生成"
                onClick={onGenerate}
              >
                <ArrowUp width={16} height={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <SkillPanel
        isOpen={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
        onUseSkill={onUseSkill}
      />
    </>
  );
}
