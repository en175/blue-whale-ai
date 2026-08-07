"use client";

// IK74V6：AI 图片 tab 面板（从 AgentComposer 下沉）。
// 参数状态由常驻的 AgentComposer 持有，避免 tab 切换时重置用户选择。
// 本组件仅保留 dropdown 的局部展示状态。
import { useRef, useState, type RefObject } from "react";
import { ArrowUp, ChevronDown, Plus, Sparkle, X } from "lucide-react";
import PromptEditor, { type PromptEditorHandle } from "../prompt/PromptEditor";
import { useClickOutsideClose } from "./useClickOutsideClose";
import {
  IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from "../ImageModelSettingsPopover";
import type { ImageModelCapability } from "@/app/canvas/_canvas/api/generation";
import type { MediaItem } from "./types";
import { ClearPromptButton } from "./ClearPromptButton";
import { AspectRatioIcon } from "../icons/AspectRatioIcon";

/** 默认分辨率：能力表 default_size 对应档位，缺省首档。 */
function pickDefaultSize(m: ImageModelCapability) {
  return (
    m.supported_sizes.find((s) => s.id === m.default_size) ??
    m.supported_sizes[0]
  );
}

export interface ImageTabPanelProps {
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
  imageModels: ImageModelCapability[];
  selectedImageModel: ImageModelCapability | null;
  setSelectedImageModel: (model: ImageModelCapability) => void;
  imageAspectRatio: ImageAspectRatio;
  setImageAspectRatio: (ratio: ImageAspectRatio) => void;
  imageResolution:
    | ImageModelCapability["supported_sizes"][number]
    | null;
  setImageResolution: (
    size: ImageModelCapability["supported_sizes"][number] | null,
  ) => void;
}

export function ImageTabPanel({
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
  imageModels,
  selectedImageModel,
  setSelectedImageModel,
  imageAspectRatio,
  setImageAspectRatio,
  imageResolution,
  setImageResolution,
}: ImageTabPanelProps) {
  const [imageModelOpen, setImageModelOpen] = useState(false);
  const [imageAspectRatioOpen, setImageAspectRatioOpen] = useState(false);
  const [imageResolutionOpen, setImageResolutionOpen] = useState(false);
  const imageModelContainerRef = useRef<HTMLDivElement>(null);
  const imageAspectRatioContainerRef = useRef<HTMLDivElement>(null);
  const imageResolutionContainerRef = useRef<HTMLDivElement>(null);

  useClickOutsideClose(imageModelContainerRef, imageModelOpen, () => setImageModelOpen(false));
  useClickOutsideClose(imageAspectRatioContainerRef, imageAspectRatioOpen, () => setImageAspectRatioOpen(false));
  useClickOutsideClose(imageResolutionContainerRef, imageResolutionOpen, () => setImageResolutionOpen(false));

  return (
            // AI 图片 Tab layout
            <div className="flex flex-col">
              <div className="flex flex-col relative">
                <div className="flex-1 min-w-0 overflow-visible bg-transparent flex flex-col">
                  {/* Uploaded image list */}
                  {mediaList.length > 0 && (
                    <div className="shrink-0 flex flex-row flex-wrap items-start gap-1.5 px-3 pt-3">
                      {mediaList.map((item) => (
                        <div
                          key={item.id}
                          className="group/card relative flex flex-col items-center w-14 shrink-0 transition-opacity duration-150 hover:opacity-85"
                        >
                          <div className="relative w-[52px] h-[52px]">
                            <img
                              className="w-full h-full rounded-md object-cover block border border-white/[0.08]"
                              alt={item.name}
                              draggable={false}
                              src={item.src}
                            />
                          </div>
                          <span className="mt-[3px] text-[10px] text-white/40 whitespace-nowrap overflow-hidden text-ellipsis max-w-[56px] text-center leading-[1.3]">
                            {item.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeMedia(item.id)}
                            className="absolute -top-[3px] -right-px w-4 h-4 flex items-center justify-center bg-[rgb(30,30,30)] border border-white/[0.12] rounded-full text-white/50 cursor-pointer p-0 z-[2] transition-opacity duration-150 opacity-0 group-hover/card:opacity-100 hover:text-white hover:bg-[rgba(50,50,50,0.95)]"
                            aria-label={`移除 ${item.name}`}
                          >
                            <X width={12} height={12} />
                          </button>
                        </div>
                      ))}
                      <div className="shrink-0">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-[52px] h-[52px] flex items-center justify-center border border-dashed border-white/[0.12] rounded-md text-white/30 bg-transparent cursor-pointer transition-all duration-150 p-0 hover:text-white/70 hover:border-white/25 hover:bg-white/[0.04]"
                          aria-label="添加更多图片"
                        >
                          <Plus width={12} height={12} />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 min-w-0 overflow-hidden flex items-stretch relative">
                    {/* Left upload image button - hidden when images uploaded */}
                    {mediaList.length === 0 && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="shrink-0 w-[88px] h-[88px] mt-4 ml-4 flex flex-col items-center justify-center gap-1 border-none rounded-lg text-white/30 bg-white/[0.025] cursor-pointer transition-all duration-150 self-start p-0 hover:text-white/50 hover:bg-white/[0.05]"
                        aria-label="上传参考图片"
                      >
                        <Plus width={20} height={20} className="opacity-80" />
                        <span className="text-[10.5px] font-medium opacity-70">
                          图片
                        </span>
                      </button>
                    )}

                    {/* Editor area（IK747Z-2：PromptEditor 受控组件，含占位 state 渲染） */}
                    <PromptEditor
                      key="image-editor"
                      ref={editorRef}
                      value={value ?? ""}
                      onChange={onChange}
                      placeholder={`从文字与参考图生成 AI 图片。\n描述你想生成的图片，已上传的参考将引导风格与细节。`}
                      className="flex-1"
                      onFocusChange={onFocusChange}
                    />
                    <ClearPromptButton
                      visible={Boolean((value ?? "").trim())}
                      onClear={clearPrompt}
                    />
                  </div>

                  {/* Bottom param bar */}
                  <div className="flex flex-wrap items-center gap-2 py-3 px-4 mt-auto">
                    <div className="flex flex-wrap items-center gap-2 flex-1 justify-start">
                      {/* 模型 */}
                      {/* 模型 */}
                      <div
                        className="relative"
                        ref={imageModelContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setImageModelOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={imageModelOpen}
                          aria-label="模型"
                        >
                          <span>
                            {selectedImageModel?.model_label ?? "加载中…"}
                          </span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {imageModelOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                            role="listbox"
                            aria-label="模型"
                          >
                            {imageModels.map((model) => {
                              const selected =
                                selectedImageModel?.model_id === model.model_id;
                              return (
                                <button
                                  key={model.model_id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setSelectedImageModel(model);
                                    // 切模型：当前分辨率不在新模型可用集合则重置为该模型默认分辨率。
                                    if (
                                      !model.supported_sizes.some(
                                        (s) => s.id === imageResolution?.id,
                                      )
                                    ) {
                                      setImageResolution(
                                        pickDefaultSize(model) ?? null,
                                      );
                                    }
                                    setImageModelOpen(false);
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

                      {/* 宽高比 */}
                      <div
                        className="relative"
                        ref={imageAspectRatioContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setImageAspectRatioOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={imageAspectRatioOpen}
                          aria-label="宽高比"
                        >
                          <AspectRatioIcon ratio={imageAspectRatio.id} />
                          <span>{imageAspectRatio.label}</span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {imageAspectRatioOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                            role="listbox"
                            aria-label="宽高比"
                          >
                            {IMAGE_ASPECT_RATIOS.map((r) => {
                              const selected = imageAspectRatio.id === r.id;
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setImageAspectRatio(r);
                                    setImageAspectRatioOpen(false);
                                  }}
                                  className={`flex items-center gap-2 w-full text-left text-[13px] font-medium py-2 px-3 rounded-md cursor-pointer border-none transition-all duration-150 whitespace-nowrap hover:bg-white/[0.08] hover:text-white justify-between ${
                                    selected
                                      ? "text-white bg-white/[0.04]"
                                      : "text-white/80 bg-transparent"
                                  }`}
                                >
                                  <AspectRatioIcon ratio={r.id} />
                                  <span className="inline-flex items-center gap-1.5 min-w-0">
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
                        ref={imageResolutionContainerRef}
                        data-param-dropdown-root="true"
                      >
                        <button
                          type="button"
                          onClick={() => setImageResolutionOpen((v) => !v)}
                          className="inline-flex items-center gap-1 h-8 text-[13px] font-medium text-white/45 px-3 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                          aria-haspopup="listbox"
                          aria-expanded={imageResolutionOpen}
                          aria-label="分辨率"
                        >
                          <span>{imageResolution?.label ?? "加载中…"}</span>
                          <ChevronDown width={11} height={11} />
                        </button>
                        {imageResolutionOpen && (
                          <div
                            className={`ncs-thin-scrollbar absolute bg-[rgb(35,35,35)] border border-white/10 rounded-lg p-1 z-[100] min-w-[80px] max-h-[240px] overflow-y-auto ${dropClass} left-0 right-auto`}
                            role="listbox"
                            aria-label="分辨率"
                          >
                            {selectedImageModel?.supported_sizes.map((res) => {
                              const selected = imageResolution?.id === res.id;
                              return (
                                <button
                                  key={res.id}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  onClick={() => {
                                    setImageResolution(res);
                                    setImageResolutionOpen(false);
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
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Credits */}
                      <div className="relative inline-flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-medium font-mono whitespace-nowrap py-0.5 px-1.5 rounded-sm transition-all duration-150 relative cursor-default text-white/35"
                          aria-label="积分：0.8"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Sparkle
                              width={14}
                              height={14}
                              className="shrink-0"
                            />
                            <span className="font-semibold">0.8</span>
                          </span>
                        </button>
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
