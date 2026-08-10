"use client";

// IK74V6：AI 视频 tab 面板（从 AgentComposer 下沉）。
// 参数状态由常驻的 AgentComposer 持有，避免 tab 切换时重置用户选择。
// 本组件仅保留 dropdown 的局部展示状态。
import { useRef, useState, type RefObject } from "react";
import { ArrowRight, ArrowUp, ChevronDown, Clock, Plus, RefreshCw, Sparkle, X } from "lucide-react";
import PromptEditor, { type PromptEditorHandle } from "../prompt/PromptEditor";
import { useClickOutsideClose } from "./useClickOutsideClose";
import type { ImageModelCapability } from "@/app/canvas/_canvas/api/generation";
import type { MediaItem } from "./types";
import { ClearPromptButton } from "./ClearPromptButton";
import { AspectRatioIcon } from "../icons/AspectRatioIcon";
import { VIDEO_ASPECT_RATIOS, VIDEO_REF_MODES, RESOLUTIONS } from "./constants";

export interface VideoTabPanelProps {
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
  videoModels: ImageModelCapability[];
  selectedModel: ImageModelCapability | null;
  setSelectedModel: (model: ImageModelCapability) => void;
  refMode: (typeof VIDEO_REF_MODES)[number];
  setRefMode: (mode: (typeof VIDEO_REF_MODES)[number]) => void;
  aspectRatio: (typeof VIDEO_ASPECT_RATIOS)[number];
  setAspectRatio: (ratio: (typeof VIDEO_ASPECT_RATIOS)[number]) => void;
  resolution: (typeof RESOLUTIONS)[number];
  setResolution: (resolution: (typeof RESOLUTIONS)[number]) => void;
  videoDuration: number;
  setVideoDuration: (duration: number) => void;
}

export function VideoTabPanel({
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
  videoModels,
  selectedModel,
  setSelectedModel,
  refMode,
  setRefMode,
  aspectRatio,
  setAspectRatio,
  resolution,
  setResolution,
  videoDuration,
  setVideoDuration,
}: VideoTabPanelProps) {
  const [videoModelOpen, setVideoModelOpen] = useState(false);
  const [refModeOpen, setRefModeOpen] = useState(false);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [aspectRatioOpen, setAspectRatioOpen] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const videoModelContainerRef = useRef<HTMLDivElement>(null);
  const refModeContainerRef = useRef<HTMLDivElement>(null);
  const resolutionContainerRef = useRef<HTMLDivElement>(null);
  const aspectRatioContainerRef = useRef<HTMLDivElement>(null);
  const durationContainerRef = useRef<HTMLDivElement>(null);

  useClickOutsideClose(videoModelContainerRef, videoModelOpen, () => setVideoModelOpen(false));
  useClickOutsideClose(refModeContainerRef, refModeOpen, () => setRefModeOpen(false));
  useClickOutsideClose(resolutionContainerRef, resolutionOpen, () => setResolutionOpen(false));
  useClickOutsideClose(aspectRatioContainerRef, aspectRatioOpen, () => setAspectRatioOpen(false));
  useClickOutsideClose(durationContainerRef, durationOpen, () => setDurationOpen(false));

  return (
            // AI 视频 Tab layout
            <div className="flex flex-col h-full min-h-0">
              <div className="flex flex-col relative flex-1 min-h-0">
                <div className="flex-1 min-h-0 min-w-0 overflow-visible bg-transparent flex flex-col">
                  <div className="flex flex-col flex-1 min-h-0">
                    {/* Uploaded media list */}
                    {mediaList.length > 0 && (
                      <div className="shrink-0 flex flex-row flex-wrap items-start gap-2 px-3 pt-3">
                        {mediaList.map((item) => (
                          <div
                            key={item.id}
                            className="mediaListItem group/card relative flex flex-col items-center shrink-0 cursor-pointer transition-opacity duration-150 hover:opacity-85 w-14"
                            title={`点击引用 @${item.name}`}
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
                            className="rounded-lg text-white/30 bg-white/[0.025] cursor-pointer transition-all duration-150 hover:text-white/50 hover:bg-white/[0.05] w-[52px] h-[52px] flex items-center justify-center"
                            aria-label="上传参考"
                          >
                            <Plus width={12} height={12} />
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 min-w-0 overflow-hidden flex items-stretch relative">
                      {mediaList.length === 0 && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="shrink-0 w-[88px] h-[88px] mt-4 ml-4 flex flex-col items-center justify-center gap-1 border-none rounded-lg text-white/30 bg-white/[0.025] cursor-pointer transition-all duration-150 self-start p-0 hover:text-white/50 hover:bg-white/[0.05]"
                          aria-label="上传参考"
                        >
                          <Plus width={20} height={20} className="opacity-80" />
                          <span className="text-[10.5px] font-medium opacity-70 whitespace-nowrap">
                            参考
                          </span>
                        </button>
                      )}
                      <PromptEditor
                        key="video-editor"
                        ref={editorRef}
                        value={value ?? ""}
                        onChange={onChange}
                        placeholder={`通过直接控制提示词快速生成单段片段。\n上传 1–5 张参考图或视频并用 @ 引用以创建互动。例如：用 @Image 1 作首帧、@Image 2 作尾帧，让他们像 @Video 1 那样跳舞。`}
                        className="flex-1"
                        onFocusChange={onFocusChange}
                      />
                      <ClearPromptButton
                        visible={Boolean((value ?? "").trim())}
                        onClear={clearPrompt}
                      />
                    </div>
                  </div>

                  {/* Bottom param bar */}
                  <div className="flex flex-wrap items-center gap-2 py-3 mt-auto px-4">
                    <div className="flex flex-wrap items-center gap-2 flex-1 justify-start">
                      {/* 模型 */}
                      <div
                        className="relative"
                        ref={videoModelContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setVideoModelOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={videoModelOpen}
                          aria-label="模型"
                        >
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            <span>
                              {selectedModel?.model_label ?? "加载中…"}
                            </span>
                          </span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {videoModelOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto w-max`}
                            role="listbox"
                            aria-label="模型"
                          >
                            {videoModels.map((model) => {
                              const selected =
                                selectedModel?.model_id === model.model_id;
                              return (
                                <button
                                  key={model.model_id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setSelectedModel(model);
                                    setVideoModelOpen(false);
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
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 参考模式 */}
                      <div
                        className="relative"
                        ref={refModeContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setRefModeOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={refModeOpen}
                          aria-label="参考模式"
                        >
                          <span>{refMode.label}</span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {refModeOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                            role="listbox"
                            aria-label="参考模式"
                          >
                            {VIDEO_REF_MODES.map((mode) => {
                              const selected = refMode.id === mode.id;
                              return (
                                <button
                                  key={mode.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setRefMode(mode);
                                    setRefModeOpen(false);
                                  }}
                                  className={`flex items-center gap-2 w-full text-left text-[13px] font-medium py-2 px-3 rounded-md cursor-pointer border-none transition-all duration-150 whitespace-nowrap hover:bg-white/[0.08] hover:text-white justify-between ${
                                    selected
                                      ? "text-white bg-white/[0.04]"
                                      : "text-white/80 bg-transparent"
                                  }`}
                                >
                                  <span className="inline-flex items-center gap-1.5 min-w-0">
                                    <span className="truncate">
                                      {mode.label}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 宽高比 */}
                      <div
                        className="relative"
                        ref={aspectRatioContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setAspectRatioOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={aspectRatioOpen}
                          aria-label="宽高比"
                        >
                          <AspectRatioIcon ratio={aspectRatio.id} />
                          <span>{aspectRatio.label}</span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {aspectRatioOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                            role="listbox"
                            aria-label="宽高比"
                          >
                            {VIDEO_ASPECT_RATIOS.map((r) => {
                              const selected = aspectRatio.id === r.id;
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setAspectRatio(r);
                                    setAspectRatioOpen(false);
                                  }}
                                  className={`flex items-center gap-2 w-full text-left text-[13px] font-medium py-2 px-3 rounded-md cursor-pointer border-none transition-all duration-150 whitespace-nowrap hover:bg-white/[0.08] hover:text-white justify-between ${
                                    selected
                                      ? "text-white bg-white/[0.04]"
                                      : "text-white/80 bg-transparent"
                                  }`}
                                >
                                  <span className="inline-flex items-center gap-1.5 min-w-0">
                                    <AspectRatioIcon ratio={r.id} />
                                    <span className="truncate">{r.label}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 分辨率 */}
                      <div
                        className="relative"
                        ref={resolutionContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setResolutionOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={resolutionOpen}
                          aria-label="分辨率"
                        >
                          <span>{resolution.label}</span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {resolutionOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                            role="listbox"
                            aria-label="分辨率"
                          >
                            {RESOLUTIONS.map((res) => {
                              const selected = resolution.id === res.id;
                              return (
                                <button
                                  key={res.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setResolution(res);
                                    setResolutionOpen(false);
                                  }}
                                  className={`flex items-center gap-2 w-full text-left text-[13px] font-medium py-2 px-3 rounded-md cursor-pointer border-none transition-all duration-150 whitespace-nowrap hover:bg-white/[0.08] hover:text-white justify-between ${
                                    selected
                                      ? "text-white bg-white/[0.04]"
                                      : "text-white/80 bg-transparent"
                                  }`}
                                >
                                  <span className="inline-flex items-center gap-1.5 min-w-0">
                                    <span className="truncate">
                                      {res.label}
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 时长 */}
                      <div
                        className="relative"
                        ref={durationContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setDurationOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={durationOpen}
                          aria-label="时长"
                        >
                          <Clock width={13} height={13} />
                          <span>{videoDuration}s</span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {durationOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto rounded-xl w-[240px] p-[14px_16px_10px] flex flex-col items-center gap-2 ${dropClass} left-0`}
                            role="listbox"
                            aria-label="时长"
                          >
                            <span className="text-[20px] font-semibold text-white tabular-nums">
                              {videoDuration}s
                            </span>
                            <div className="flex items-center gap-2 w-full">
                              <span className="text-[10px] text-white/[0.35] shrink-0 tabular-nums">
                                4s
                              </span>
                              <input
                                type="range"
                                min="4"
                                max="15"
                                step="1"
                                value={videoDuration}
                                aria-label="时长"
                                onChange={(e) =>
                                  setVideoDuration(parseInt(e.target.value, 10))
                                }
                                className="flex-1 h-1 appearance-none rounded-[2px] bg-white/[0.12] cursor-pointer outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.3)] [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-[120ms] [&::-webkit-slider-thumb]:ease-out [&:hover::-webkit-slider-thumb]:scale-[1.2] [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.3)] [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-[2px] [&::-moz-range-track]:bg-white/[0.12]"
                              />
                              <span className="text-[10px] text-white/[0.35] shrink-0 tabular-nums">
                                15s
                              </span>
                            </div>
                            <button
                              type="button"
                              className="flex items-center gap-1.5 w-full border-t border-white/[0.06] pt-1.5 pb-0.5 text-left whitespace-nowrap mt-0.5 text-[11px] leading-[16px] text-white/[0.35] bg-transparent border-none cursor-pointer transition-colors duration-150 hover:text-white/[0.85]"
                            >
                              <span>需要更长时长？打开 Agent V2</span>
                              <ArrowRight width={11} height={11} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* @ 提及 */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                        aria-label="提及"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="4"></circle>
                          <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"></path>
                        </svg>
                      </button>
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
                        className="flex items-center justify-center rounded-lg transition-all duration-200 p-0 border-none shrink-0 w-8 h-8 bg-white text-black cursor-pointer shadow-[0_2px_8px_rgba(255,255,255,0.1)] hover:bg-[#f0f0f0] hover:scale-105 hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(255,255,255,0.15)] active:scale-95"
                        aria-label="生成"
                        onClick={onGenerate}
                      >
                        <ArrowUp width={16} height={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
  );
}
