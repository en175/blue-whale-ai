"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useAuth } from "./auth/AuthContext";
import {
  Plus,
  BookOpenText,
  ChevronDown,
  ArrowUp,
  RefreshCw,
  X,
  Sparkle,
  Clock,
  ArrowRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import DirectSkillTag from "./DirectSkillTag";
import SkillPanel, { type UseSkillSelection } from "./SkillPanel";
import {
  clearDirectSkillBinding,
  readDirectSkillBinding,
  writeDirectSkillBinding,
  type DirectSkillBinding,
} from "@/lib/direct-skill-binding";
import { AspectRatioIcon } from "./icons/AspectRatioIcon";
import {
  IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from "./ImageModelSettingsPopover";
import {
  getImageModels,
  getVideoModels,
  getTextModels,
  type ImageModelCapability,
} from "@/app/canvas/_canvas/api/generation";

const TABS = [
  { id: "agent", label: "视频智能体", hasCanvas: true },
  { id: "video", label: "AI 视频" },
  { id: "image", label: "AI 图片" },
];

/**
 * 费用倍率占位（IK70CM）：generation_model_capability 无 costMultiplier 字段，
 * 先统一 1x，待模型管理后台/Go 后端提供真实费用数据后接上（届时随模型下拉一并移除）。
 */
const AGENT_COST_MULTIPLIER = "1x";

/** 取模型默认分辨率档位（能力表 default_size，缺省回退首个）。 */
function pickDefaultSize(m: ImageModelCapability) {
  return (
    m.supported_sizes.find((s) => s.id === m.default_size) ??
    m.supported_sizes[0]
  );
}

const VIDEO_ASPECT_RATIOS = [
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
  { id: "21:9", label: "21:9" },
];

const RESOLUTIONS = [
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
  { id: "2160p", label: "2160p" },
];

const VIDEO_REF_MODES = [
  { id: "omni", label: "Omni Reference" },
  { id: "first-last", label: "首尾帧" },
  { id: "text-to-video", label: "Text to Video" },
];

interface MediaItem {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src: string;
  duration?: string;
}

export interface GenerateImageParams {
  modelId: string;
  aspectRatioId: string;
  resolutionId: string;
}

export interface GenerateContext {
  tab: string;
  prompt: string;
  image: GenerateImageParams;
}

/**
 * IK6XQI-7 重构：三个 tab（视频智能体/AI 视频/AI 图片）各自维护独立输入内容
 * （tabContents），切换 tab 时编辑器重新挂载并从对应内容同步——修复
 * 「切到 AI 视频提示词不显示 / 三 tab 共用一个输入框」的交互混乱。
 * 模板卡片点击经 ref.injectPrompt 注入当前激活 tab（覆盖、单行）。
 */
export interface AgentComposerHandle {
  /** 外部注入提示词（模板卡片点击）：覆盖当前激活 tab 的输入内容。 */
  injectPrompt: (text: string) => void;
}

export type AgentComposerProps = Record<never, never>;

const AgentComposer = forwardRef<AgentComposerHandle, AgentComposerProps>(
  function AgentComposer(_props, ref) {
    const [activeTab, setActiveTab] = useState("agent");
    // IK6XQI-7：三 tab 独立输入内容，互不串扰；切换 tab 时 editor 重新挂载并同步对应内容。
    const [tabContents, setTabContents] = useState<Record<string, string>>({
      agent: "",
      video: "",
      image: "",
    });
    const [isFocused, setIsFocused] = useState(false);
    const [indicator, setIndicator] = useState({ width: 0, x: 0, opacity: 0 });
    const [modelOpen, setModelOpen] = useState(false);
    const [videoModels, setVideoModels] = useState<ImageModelCapability[]>([]);
    const [selectedModel, setSelectedModel] =
      useState<ImageModelCapability | null>(null);
    const [videoModelOpen, setVideoModelOpen] = useState(false);
    const [refModeOpen, setRefModeOpen] = useState(false);
    const [resolutionOpen, setResolutionOpen] = useState(false);
    const [aspectRatioOpen, setAspectRatioOpen] = useState(false);
    const [durationOpen, setDurationOpen] = useState(false);
    const [agentModelOpen, setAgentModelOpen] = useState(false);
    const [agentModels, setAgentModels] = useState<ImageModelCapability[]>([]);
    const [selectedAgentModel, setSelectedAgentModel] =
      useState<ImageModelCapability | null>(null);
    const [mediaList, setMediaList] = useState<MediaItem[]>([]);
    const [skillPanelOpen, setSkillPanelOpen] = useState(false);

  const router = useRouter();
  const { requireAuth } = useAuth();

  // AI 视频 tab params
  const [refMode, setRefMode] = useState(VIDEO_REF_MODES[1]);
  const [aspectRatio, setAspectRatio] = useState(VIDEO_ASPECT_RATIOS[0]);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [videoDuration, setVideoDuration] = useState(15);

  // AI 图片 tab params（模型/分辨率/宽高比均复用画布 ImageModelSettingsPopover 的 seedream 映射）
  const [imageModels, setImageModels] = useState<ImageModelCapability[]>([]);
  const [selectedImageModel, setSelectedImageModel] =
    useState<ImageModelCapability | null>(null);
  const [imageModelOpen, setImageModelOpen] = useState(false);

  const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>(
    IMAGE_ASPECT_RATIOS.find((r) => r.id === "16:9")!,
  );
  const [imageAspectRatioOpen, setImageAspectRatioOpen] = useState(false);
  const [imageResolution, setImageResolution] = useState<
    ImageModelCapability["supported_sizes"][number] | null
  >(null);
  const [imageResolutionOpen, setImageResolutionOpen] = useState(false);

  const handleGenerate = useCallback(() => {
    const promptText = (tabContents[activeTab] ?? "").trim();
    requireAuth({ kind: "home-generate", prompt: promptText }, () => {
      const query = promptText
        ? `?prompt=${encodeURIComponent(promptText)}`
        : "";
      // IK6XQI-4：发送后跳画布（画布读 ?prompt 预填 BottomDock），不再跳 /generate（已下线）。
      router.push(`/canvas${query}`);
    });
  }, [activeTab, tabContents, requireAuth, router]);

  const tabRefs = useRef<(HTMLElement | null)[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelContainerRef = useRef<HTMLDivElement>(null);
  const videoModelContainerRef = useRef<HTMLDivElement>(null);
  const refModeContainerRef = useRef<HTMLDivElement>(null);
  const resolutionContainerRef = useRef<HTMLDivElement>(null);
  const aspectRatioContainerRef = useRef<HTMLDivElement>(null);
  const durationContainerRef = useRef<HTMLDivElement>(null);
  const agentModelContainerRef = useRef<HTMLDivElement>(null);
  const imageModelContainerRef = useRef<HTMLDivElement>(null);
  const imageAspectRatioContainerRef = useRef<HTMLDivElement>(null);
  const imageResolutionContainerRef = useRef<HTMLDivElement>(null);

  // 模型下拉能力表驱动（IK70CM，ADR-0067：generation_model_capability 为唯一事实源）。
  // 拉取失败保持空列表 + console 报错：首页生成走 /generate 跳转不依赖模型，不影响主流程。
  useEffect(() => {
    let cancelled = false;
    getVideoModels()
      .then((list) => {
        if (cancelled || list.length === 0) return;
        setVideoModels(list);
        setSelectedModel(list[0]);
      })
      .catch((err) => console.error("getVideoModels failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getTextModels()
      .then((list) => {
        if (cancelled || list.length === 0) return;
        setAgentModels(list);
        setSelectedAgentModel(list[0]);
      })
      .catch((err) => console.error("getTextModels failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getImageModels()
      .then((list) => {
        if (cancelled || list.length === 0) return;
        setImageModels(list);
        const first = list[0];
        setSelectedImageModel(first);
        setImageResolution(pickDefaultSize(first) ?? null);
      })
      .catch((err) => console.error("getImageModels failed", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // IK6XQI-7：把文本写入当前 editor DOM（幂等：内容一致则不写，避免干扰输入光标）。
  const applyToEditor = useCallback((text: string) => {
    const el = editorRef.current;
    if (el && el.innerText !== text) el.innerText = text;
  }, []);

  // tab 切换时 editor 重新挂载（新空 DOM）→ 从 tabContents 同步对应内容，
  // 修复「切到 AI 视频提示词不显示」。
  useEffect(() => {
    applyToEditor(tabContents[activeTab] ?? "");
    // 仅在 activeTab 变化时同步；输入中内容由 handleInput 维护，避免 effect 链。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 外部注入（模板卡片点击）：覆盖当前激活 tab 内容并立即写 DOM（保持单行）。
  const injectPrompt = useCallback(
    (text: string) => {
      setTabContents((prev) => ({ ...prev, [activeTab]: text }));
      applyToEditor(text);
    },
    [activeTab, applyToEditor],
  );

  useImperativeHandle(ref, () => ({ injectPrompt }), [injectPrompt]);

  const handleInput = useCallback(() => {
    const text = editorRef.current?.innerText ?? "";
    setTabContents((prev) =>
      prev[activeTab] === text ? prev : { ...prev, [activeTab]: text },
    );
  }, [activeTab]);

  const updateIndicator = useCallback(() => {
    const idx = TABS.findIndex((t) => t.id === activeTab);
    const el = tabRefs.current[idx];
    if (el) {
      setIndicator({
        width: el.offsetWidth,
        x: el.offsetLeft,
        opacity: 1,
      });
    }
  }, [activeTab]);

  useEffect(() => {
    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [updateIndicator]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelContainerRef.current &&
        !modelContainerRef.current.contains(event.target as Node)
      ) {
        setModelOpen(false);
      }
    };
    if (modelOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        videoModelContainerRef.current &&
        !videoModelContainerRef.current.contains(event.target as Node)
      ) {
        setVideoModelOpen(false);
      }
    };
    if (videoModelOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [videoModelOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        refModeContainerRef.current &&
        !refModeContainerRef.current.contains(event.target as Node)
      ) {
        setRefModeOpen(false);
      }
    };
    if (refModeOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [refModeOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        resolutionContainerRef.current &&
        !resolutionContainerRef.current.contains(event.target as Node)
      ) {
        setResolutionOpen(false);
      }
    };
    if (resolutionOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [resolutionOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        aspectRatioContainerRef.current &&
        !aspectRatioContainerRef.current.contains(event.target as Node)
      ) {
        setAspectRatioOpen(false);
      }
    };
    if (aspectRatioOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [aspectRatioOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        durationContainerRef.current &&
        !durationContainerRef.current.contains(event.target as Node)
      ) {
        setDurationOpen(false);
      }
    };
    if (durationOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [durationOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        agentModelContainerRef.current &&
        !agentModelContainerRef.current.contains(event.target as Node)
      ) {
        setAgentModelOpen(false);
      }
    };
    if (agentModelOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [agentModelOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        imageModelContainerRef.current &&
        !imageModelContainerRef.current.contains(event.target as Node)
      ) {
        setImageModelOpen(false);
      }
    };
    if (imageModelOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [imageModelOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        imageAspectRatioContainerRef.current &&
        !imageAspectRatioContainerRef.current.contains(event.target as Node)
      ) {
        setImageAspectRatioOpen(false);
      }
    };
    if (imageAspectRatioOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [imageAspectRatioOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        imageResolutionContainerRef.current &&
        !imageResolutionContainerRef.current.contains(event.target as Node)
      ) {
        setImageResolutionOpen(false);
      }
    };
    if (imageResolutionOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [imageResolutionOpen]);

  // 「直接使用」一次性绑定（IK60WY）：技能稳定 ID 只绑下一次 Agent 请求。
  // sessionStorage 承载首页 → /generate 的传递；发送成功或移除标签后清除。
  const [boundSkill, setBoundSkill] = useState<DirectSkillBinding | null>(null);
  // 挂载后读 sessionStorage（跨页传递的绑定）；SSR 无存储，避免水合不一致。
  useEffect(() => {
    setBoundSkill(readDirectSkillBinding());
  }, []);

  const handleUseSkill = useCallback((skill: UseSkillSelection) => {
    if (!skill.creative_skill_id) return;
    const binding = {
      creative_skill_id: skill.creative_skill_id,
      name: skill.name,
    };
    setBoundSkill(binding);
    writeDirectSkillBinding(binding);
    setSkillPanelOpen(false);
  }, []);

  const handleRemoveBoundSkill = useCallback(() => {
    setBoundSkill(null);
    clearDirectSkillBinding();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newItems: MediaItem[] = files.map((file, idx) => {
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      const type = isVideo ? "video" : isAudio ? "audio" : "image";
      const label = isVideo ? "Video" : isAudio ? "Audio" : "Image";
      const number = mediaList.filter((m) => m.type === type).length + idx + 1;
      return {
        id: `${Date.now()}-${idx}`,
        type,
        name: `${label} ${number}`,
        src: URL.createObjectURL(file),
      };
    });

    setMediaList((prev) => [...prev, ...newItems]);
    e.target.value = "";
  };

  const removeMedia = (id: string) => {
    // 释放被移除素材的对象 URL，避免 blob 内存泄漏（仅清理 blob: 协议，跳过 demo/远程 URL）
    setMediaList((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed?.src?.startsWith("blob:")) URL.revokeObjectURL(removed.src);
      return prev.filter((item) => item.id !== id);
    });
  };

  // 仅在组件卸载时统一释放尚未移除的 blob: 对象 URL。
  // 通过 ref 读取最新的 mediaList，且 effect 依赖为空，确保不会在更新时误释放正在显示的 URL。
  const mediaListRef = useRef(mediaList);
  // ref 写入须在 effect 内（render 期间写 ref 触发 react-hooks/refs），保持「最新 mediaList」语义。
  useEffect(() => {
    mediaListRef.current = mediaList;
  });
  useEffect(() => {
    return () => {
      mediaListRef.current.forEach((item) => {
        if (item.src?.startsWith("blob:")) URL.revokeObjectURL(item.src);
      });
    };
  }, []);

  const isVideoTab = activeTab === "video";
  const isImageTab = activeTab === "image";

  // 参数下拉展开方向：统一向下展开（首页场景）。
  const dropClass =
    "top-[calc(100%+6px)] shadow-[0_12px_32px_rgba(0,0,0,0.4)] animate-in fade-in slide-in-from-bottom-1 duration-150";

  return (
    <div
      className={`w-full max-w-[920px] bg-[#1d1d1d] rounded-[18px] border transition-[border-color] duration-300 overflow-visible ${
        isFocused ? "border-white/[0.16]" : "border-white/[0.10]"
      }`}
      style={{
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.045), 0 2px 6px rgba(0,0,0,0.16), 0 18px 36px -14px rgba(0,0,0,0.22)",
      }}
    >
      {/* Tabs */}
      <div className="flex flex-col items-start gap-0.5 pt-2 px-4 pb-1 shadow-[inset_0_-1px_0_rgba(0,0,0,0.34),0_1px_0_rgba(255,255,255,0.035)]">
        <div className="relative flex items-center gap-0">
          <span
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-white/75 transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{
              width: indicator.width,
              opacity: indicator.opacity,
              transform: `translateX(${indicator.x + 8}px)`,
            }}
          />
          {TABS.map((tab, idx) => {
            const isActive = activeTab === tab.id;
            const baseButtonClasses =
              "inline-flex items-center text-[13px] font-medium bg-transparent border-none rounded-none cursor-pointer transition-colors duration-150 whitespace-nowrap";
            const activeClasses = isActive
              ? "text-white/90 hover:text-white/90"
              : "text-white/35 hover:text-white/60";

            if (tab.hasCanvas) {
              return (
                <div
                  key={tab.id}
                  ref={(el) => {
                    tabRefs.current[idx] = el;
                  }}
                  className="relative inline-flex items-center h-8"
                >
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`${baseButtonClasses} h-full pl-3 pr-0 ${activeClasses}`}
                  >
                    {tab.label}
                  </button>
                  <div className="relative inline-flex items-center ml-1 mr-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-[3px] h-[18px] px-[5px] text-[10px] font-medium rounded-[9px] border cursor-pointer transition-all duration-150 whitespace-nowrap leading-none text-white/55 border-white/15 hover:text-white/60 hover:border-white/[0.22] hover:bg-white/[0.04]"
                    >
                      Canvas
                      <svg
                        width="8"
                        height="5"
                        viewBox="0 0 8 5"
                        fill="none"
                        className="opacity-60"
                      >
                        <path
                          d="M1 1L4 4L7 1"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={tab.id}
                type="button"
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                onClick={() => setActiveTab(tab.id)}
                className={`relative inline-flex items-center h-8 px-3 ${baseButtonClasses} ${activeClasses}`}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out motion-reduce:animate-none">
        <div className="flex flex-col">
          <input
            ref={fileInputRef}
            className="hidden"
            accept=".jpg,.jpeg,.png,.mp4,.mp3,.wav,.m4a,image/jpeg,image/png,video/mp4,audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/x-m4a"
            multiple
            type="file"
            onChange={handleFileChange}
          />

          {isImageTab ? (
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

                    {/* Editor area */}
                    <div
                      key="image-editor"
                      ref={editorRef}
                      className="tc-agent-image-editor relative flex-1 min-h-[120px] text-sm text-white/90 bg-transparent border-none outline-none shadow-none appearance-none leading-[1.8] py-3 px-4 font-[inherit] overflow-y-auto whitespace-pre-wrap break-words focus:border-none focus:outline-none focus:shadow-none"
                      contentEditable
                      role="textbox"
                      aria-multiline="true"
                      data-placeholder="从文字与参考图生成 AI 图片。&#10;描述你想生成的图片，已上传的参考将引导风格与细节。"
                      spellCheck={false}
                      autoCorrect="off"
                      onInput={handleInput}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
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
                        onClick={handleGenerate}
                      >
                        <ArrowUp width={16} height={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : isVideoTab ? (
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
                      <div
                        key="video-editor"
                        ref={editorRef}
                        className="relative flex-1 text-sm text-white/90 bg-transparent border-none outline-none shadow-none appearance-none leading-[1.8] py-3 px-4 font-[inherit] overflow-y-auto whitespace-pre-wrap break-words focus:border-none focus:outline-none focus:shadow-none min-h-[120px] empty:before:content-[attr(data-placeholder)] empty:before:absolute empty:before:top-3 empty:before:left-4 empty:before:right-4 empty:before:text-white/35 empty:before:pointer-events-none"
                        contentEditable
                        role="textbox"
                        aria-multiline="true"
                        data-placeholder="通过直接控制提示词快速生成单段片段。&#10;上传 1–5 张参考图或视频并用 @ 引用以创建互动。例如：用 @Image 1 作首帧、@Image 2 作尾帧，让他们像 @Video 1 那样跳舞。"
                        spellCheck={false}
                        autoCorrect="off"
                        onInput={handleInput}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
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
                        onClick={handleGenerate}
                      >
                        <ArrowUp width={16} height={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // Default agent tab layout
            <>
              {/* Media list */}
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

              {boundSkill && (
                <div className="px-4 pt-3">
                  <DirectSkillTag
                    name={boundSkill.name}
                    onRemove={handleRemoveBoundSkill}
                  />
                </div>
              )}

              <div className="relative min-h-[120px]">
                <div
                  key="agent-editor"
                  ref={editorRef}
                  className="tc-agent-composer-editor relative min-h-[120px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent py-3 px-4 text-sm leading-[1.8] text-white/90 border-none outline-none shadow-none focus:border-none focus:outline-none focus:ring-0"
                  contentEditable
                  role="textbox"
                  aria-multiline="true"
                  data-placeholder="描述你想制作的视频，微电影、产品广告、社媒视频等都可支持。适合 1-5 分钟视频；可用 @ 引用已上传素材。"
                  spellCheck={false}
                  autoCorrect="off"
                  onInput={handleInput}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                />
              </div>

              {/* Toolbar */}
              <div className="mt-auto flex flex-wrap items-center gap-2 py-3 px-4">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="ncs-tooltip-simple inline-flex items-center gap-1 h-8 px-2.5 text-[13px] font-medium text-white/45 rounded-lg bg-transparent border border-white/[0.06] cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-white/70 hover:bg-white/[0.05]"
                    data-tooltip="支持上传图片、视频、音频"
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
                                <span className="truncate">
                                  {model.model_label}
                                </span>
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
                        className="flex items-center justify-center rounded-lg transition-all duration-200 p-0 border-none shrink-0 w-8 h-8 bg-white text-black cursor-pointer shadow-[0_2px_8px_rgba(255,255,255,0.1)] hover:bg-[#f0f0f0] hover:scale-105 hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(255,255,255,0.15)] active:scale-95"
                        aria-label="生成"
                        onClick={handleGenerate}
                      >
                        <ArrowUp width={16} height={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <SkillPanel
        isOpen={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
        onUseSkill={handleUseSkill}
      />
    </div>
  );
  },
);

export default AgentComposer;
