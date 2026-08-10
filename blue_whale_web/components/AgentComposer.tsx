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
import { useRouter } from "next/navigation";
import type { PromptEditorHandle } from "./prompt/PromptEditor";
import { ImageTabPanel } from "./composer/ImageTabPanel";
import { VideoTabPanel } from "./composer/VideoTabPanel";
import { AgentTabPanel } from "./composer/AgentTabPanel";
import type { ComposerTabId, MediaItem } from "./composer/types";
import {
  IMAGE_ASPECT_RATIOS,
  type ImageAspectRatio,
} from "./ImageModelSettingsPopover";
import {
  RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_REF_MODES,
} from "./composer/constants";
import {
  clearDirectSkillBinding,
  readDirectSkillBinding,
  writeDirectSkillBinding,
  type DirectSkillBinding,
} from "@/lib/direct-skill-binding";
import type { UseSkillSelection } from "./skill/SkillPanel";
import { toast } from "@/components/Toast";
import {
  getImageModels,
  getVideoModels,
  getTextModels,
  type ImageModelCapability,
} from "@/app/canvas/_canvas/api/generation";
import { uploadAsset } from "@/lib/assets";

const TABS: { id: ComposerTabId; label: string }[] = [
  { id: "agent", label: "视频智能体" },
  { id: "video", label: "AI 视频" },
  { id: "image", label: "AI 图片" },
];

const INITIAL_TAB_MEDIA: Record<ComposerTabId, MediaItem[]> = {
  agent: [],
  video: [],
  image: [],
};

type MediaType = "image" | "video" | "audio";

// IK74TX 3.1：上传类型按 Tab 收紧（文件选择器 accept + 实际校验双重把关）。
const ACCEPT_BY_TAB: Record<ComposerTabId, string> = {
  agent:
    ".jpg,.jpeg,.png,.mp4,.mp3,.wav,.m4a,image/jpeg,image/png,video/mp4,audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/mp4,audio/x-m4a",
  video: ".jpg,.jpeg,.png,.mp4,image/jpeg,image/png,video/mp4",
  image: ".jpg,.jpeg,.png,image/jpeg,image/png",
};
const ALLOWED_TYPES_BY_TAB: Record<ComposerTabId, MediaType[]> = {
  agent: ["image", "video", "audio"],
  video: ["image", "video"],
  image: ["image"],
};
const INITIAL_MEDIA_COUNTER: Record<ComposerTabId, Record<MediaType, number>> = {
  agent: { image: 0, video: 0, audio: 0 },
  video: { image: 0, video: 0, audio: 0 },
  image: { image: 0, video: 0, audio: 0 },
};

function detectMediaType(file: File): MediaType {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}

function mediaLabel(type: MediaType): string {
  return type === "video" ? "Video" : type === "audio" ? "Audio" : "Image";
}

function pickDefaultSize(model: ImageModelCapability) {
  return (
    model.supported_sizes.find((size) => size.id === model.default_size) ??
    model.supported_sizes[0]
  );
}

/**
 * IK6XQI-7：三个 tab 各自维护独立输入内容；切换 tab 时编辑器重新挂载并同步。
 * 模板卡片点击经 ref.injectPrompt 注入当前激活 tab（覆盖、单行）。
 *
 * IK74TX 6.1：素材与参数同样按 tab 隔离——mediaByTab / video 模型选择（智能体
 * 与 AI 视频各自独立）均存 Record<ComposerTabId, T>。面板随 tab 条件渲染会卸载，
 * 状态放本组件（父级）才能跨 tab 保留。参数（refMode/aspectRatio/resolution/
 * duration/image 等）本就只各自 tab 显示且 state 在父级，天然满足「切换不清空」。
 */
export interface AgentComposerHandle {
  /** 外部注入提示词（模板卡片点击）：覆盖当前激活 tab 的输入内容。 */
  injectPrompt: (text: string) => void;
}

export type AgentComposerProps = Record<never, never>;

const AgentComposer = forwardRef<AgentComposerHandle, AgentComposerProps>(
  function AgentComposer(_props, ref) {
    const [activeTab, setActiveTab] = useState<ComposerTabId>("agent");
    // IK6XQI-7：三 tab 独立输入内容，互不串扰。
    const [tabContents, setTabContents] = useState<Record<ComposerTabId, string>>({
      agent: "",
      video: "",
      image: "",
    });
    const [isFocused, setIsFocused] = useState(false);
    const [indicator, setIndicator] = useState({ width: 0, x: 0, opacity: 0 });
    const [videoModels, setVideoModels] = useState<ImageModelCapability[]>([]);
    // IK74TX 6.1：智能体 tab 与 AI 视频 tab 的视频模型选择各自独立，互不污染。
    const [videoSelectedModel, setVideoSelectedModel] =
      useState<ImageModelCapability | null>(null);
    const [agentVideoModel, setAgentVideoModel] =
      useState<ImageModelCapability | null>(null);
    const [agentModels, setAgentModels] = useState<ImageModelCapability[]>([]);
    const [selectedAgentModel, setSelectedAgentModel] =
      useState<ImageModelCapability | null>(null);
    const [videoRefMode, setVideoRefMode] = useState(VIDEO_REF_MODES[1]);
    const [videoAspectRatio, setVideoAspectRatio] = useState(
      VIDEO_ASPECT_RATIOS[0],
    );
    const [videoResolution, setVideoResolution] = useState(RESOLUTIONS[0]);
    const [videoDuration, setVideoDuration] = useState(15);
    const [imageModels, setImageModels] = useState<ImageModelCapability[]>([]);
    const [selectedImageModel, setSelectedImageModel] =
      useState<ImageModelCapability | null>(null);
    const [imageAspectRatio, setImageAspectRatio] = useState<ImageAspectRatio>(
      IMAGE_ASPECT_RATIOS.find((ratio) => ratio.id === "16:9")!,
    );
    const [imageResolution, setImageResolution] = useState<
      ImageModelCapability["supported_sizes"][number] | null
    >(null);
    // IK74TX 6.1：素材按 tab 隔离，切换 tab 不共享、不清空。
    const [mediaByTab, setMediaByTab] =
      useState<Record<ComposerTabId, MediaItem[]>>(INITIAL_TAB_MEDIA);
    // IK74TX 3.4：素材编号只增不减、永不复用（Tab 维度内累计计数；删除不回落）。
    const [mediaCounterByTab, setMediaCounterByTab] =
      useState<Record<ComposerTabId, Record<MediaType, number>>>(INITIAL_MEDIA_COUNTER);
    const [skillPanelOpen, setSkillPanelOpen] = useState(false);

    // 「直接使用」一次性绑定（IK60WY）：技能稳定 ID 只绑下一次 Agent 请求。
    // sessionStorage 承载首页 → 画布的传递；发送成功或移除标签后清除。
    // 声明在 handleGenerate 之前（handleGenerate 1.3 构造跳转参数时读 boundSkill）。
    const [boundSkill, setBoundSkill] = useState<DirectSkillBinding | null>(null);
    // 挂载后读 sessionStorage（跨页传递的绑定）；SSR 无存储，避免水合不一致。
    useEffect(() => {
      // 挂载后一次性读取是官方认可模式；react-hooks/set-state-in-effect 对该调用不触发。
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

    const router = useRouter();
    const { requireAuth } = useAuth();

    // IK74TX 3.2/3.3：当前激活 tab 所属模型的参考素材上限（能力表唯一事实源，ADR-0067）。
    const maxRefForTab = useCallback(
      (tab: ComposerTabId) => {
        const model =
          tab === "image"
            ? selectedImageModel
            : tab === "video"
              ? videoSelectedModel
              : agentVideoModel;
        return model?.features.max_reference_images ?? null;
      },
      [agentVideoModel, selectedImageModel, videoSelectedModel],
    );

    const handleGenerate = useCallback(async () => {
      const promptText = (tabContents[activeTab] ?? "").trim();
      const media = mediaByTab[activeTab];
      // 1.5① 内容非空（7.2）。
      if (!promptText && media.length === 0) return;

      // 1.5③ 素材数不超当前模型上限（3.3）。
      const maxRef = maxRefForTab(activeTab);
      if (maxRef !== null && media.length > maxRef) {
        toast.error(
          `当前模型最多支持 ${maxRef} 个参考素材，请先移除超额素材`,
        );
        return;
      }

      // 1.5② 参考模式校验（4.2，仅 AI 视频 tab）。
      if (activeTab === "video") {
        if (videoRefMode.id === "first-last" && media.length < 2) {
          toast.error("首尾帧模式需要至少 2 个素材（首帧与尾帧）");
          return;
        }
        if (videoRefMode.id === "omni" && media.length < 1) {
          toast.error("Omni Reference 需要至少 1 个参考素材");
          return;
        }
        if (videoRefMode.id === "text-to-video" && media.length > 0) {
          toast.error(
            "Text to Video 模式不使用参考素材，请先移除素材或切换参考模式",
          );
          return;
        }
      }

      requireAuth({ kind: "home-generate", prompt: promptText }, async () => {
        // 防止上传/跳转期间重复触发。
        if (submittingRef.current) return;
        submittingRef.current = true;
        try {
          // IK74TX 1.1/1.2/1.3：素材先落全局资产库（不带 projectId → project_id=0），
          // 拿全局 assetId 后拼进跳转 URL；画布 worker resolveInputAssets 认 project_id=0。
          const uploaded: string[] = [];
          for (const item of media) {
            if (!item.file) continue;
            const { id } = await uploadAsset(item.file);
            uploaded.push(id);
          }

          // 构造跳转参数：tab 分化携带（1.1/1.2/1.3 契约）。
          const params = new URLSearchParams();
          params.set("tab", activeTab);
          if (promptText) params.set("prompt", promptText);
          if (uploaded.length > 0) params.set("assets", uploaded.join(","));
          if (activeTab === "video") {
            if (videoSelectedModel) params.set("model", videoSelectedModel.model_id);
            params.set("ratio", videoAspectRatio.id);
            params.set("size", videoResolution.id);
            params.set("duration", String(videoDuration));
            params.set("refMode", videoRefMode.id);
          } else if (activeTab === "image") {
            if (selectedImageModel) params.set("model", selectedImageModel.model_id);
            params.set("ratio", imageAspectRatio.id);
            if (imageResolution) params.set("size", imageResolution.id);
          } else {
            // 视频智能体（1.3）：带技能 + 双模型。
            if (boundSkill?.creative_skill_id) params.set("skill", boundSkill.creative_skill_id);
            if (agentVideoModel) params.set("model", agentVideoModel.model_id);
            if (selectedAgentModel) params.set("agentModel", selectedAgentModel.model_id);
          }

          // IK74TX 5.2：提交即交接给画布 Agent，清除「直接使用」技能绑定。
          setBoundSkill(null);
          clearDirectSkillBinding();
          // IK74TX 1.4：提交成功后清空当前 tab（文字/素材/参数），其他 tab 不受影响。
          setTabContents((prev) => ({ ...prev, [activeTab]: "" }));
          setMediaByTab((prev) => {
            const list = prev[activeTab];
            list.forEach((item) => {
              if (item.src?.startsWith("blob:")) URL.revokeObjectURL(item.src);
            });
            return { ...prev, [activeTab]: [] };
          });
          if (activeTab === "video") {
            setVideoRefMode(VIDEO_REF_MODES[1]);
            setVideoAspectRatio(VIDEO_ASPECT_RATIOS[0]);
            setVideoResolution(RESOLUTIONS[0]);
            setVideoDuration(15);
          } else if (activeTab === "image") {
            setImageAspectRatio(IMAGE_ASPECT_RATIOS.find((r) => r.id === "16:9")!);
            setImageResolution(null);
          }
          // IK6XQI-4：发送后跳画布（画布读 ?tab/… 新建项目 + Dock 预填 + 自动生成/Agent 接管），不再跳 /generate（已下线）。
          router.push(`/canvas?${params.toString()}`);
        } catch (err) {
          console.error("[home-generate] uploadAsset failed", err);
          toast.error("素材上传失败，请重试");
        } finally {
          submittingRef.current = false;
        }
      });
    }, [
      activeTab,
      tabContents,
      mediaByTab,
      maxRefForTab,
      videoRefMode,
      requireAuth,
      router,
      videoSelectedModel,
      videoAspectRatio,
      videoResolution,
      videoDuration,
      selectedImageModel,
      imageAspectRatio,
      imageResolution,
      boundSkill,
      agentVideoModel,
      selectedAgentModel,
    ]);

    const tabRefs = useRef<(HTMLElement | null)[]>([]);
    const promptEditorRef = useRef<PromptEditorHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // IK74TX 3.5：替换素材的目标 id——点击缩略图替换按钮后置位，文件选择器完成时消费。
    const replaceTargetRef = useRef<string | null>(null);
    // IK74TX 1.1/1.2/1.3：提交中（上传素材+跳转）防重复触发。async 回调闭包读取，
    // 故用 ref 而非 state（避免依赖数组重跑 + 竞态）。
    const submittingRef = useRef(false);

    // 模型下拉能力表驱动（IK70CM，ADR-0067：generation_model_capability 为唯一事实源）。
    // 拉取失败保持空列表 + console 报错：首页生成走 /generate 跳转不依赖模型，不影响主流程。
    useEffect(() => {
      let cancelled = false;
      getVideoModels()
        .then((list) => {
          if (cancelled || list.length === 0) return;
          setVideoModels(list);
          // 智能体与 AI 视频两处视频模型选择初始化为同一首个模型，此后各自独立。
          const first = list[0];
          setVideoSelectedModel(first);
          setAgentVideoModel(first);
          // IK74TX 2.2：初始时长收敛到首个模型 supported_durations 范围。
          const dur = first.supported_durations;
          if (dur) {
            setVideoDuration((prev) =>
              Math.min(Math.max(prev, dur.min), dur.max),
            );
          }
        })
        .catch((err) => console.error("getVideoModels failed", err));
      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      let cancelled = false;
      getImageModels()
        .then((list) => {
          if (cancelled || list.length === 0) return;
          const first = list[0];
          setImageModels(list);
          setSelectedImageModel(first);
          setImageResolution(pickDefaultSize(first) ?? null);
        })
        .catch((err) => console.error("getImageModels failed", err));
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

    // 外部注入（模板卡片点击）：覆盖当前激活 tab 内容（保持单行）。
    const injectPrompt = useCallback((text: string) => {
      setTabContents((prev) => ({ ...prev, [activeTab]: text }));
      // IK726P 规则5：注入后聚焦、光标到末尾、长文本滚动可见（由 PromptEditor 封装）。
      promptEditorRef.current?.focusToEnd();
    }, [activeTab]);

    useImperativeHandle(ref, () => ({ injectPrompt }), [injectPrompt]);

    const handleInput = useCallback((text: string) => {
      setTabContents((prev) =>
        prev[activeTab] === text ? prev : { ...prev, [activeTab]: text },
      );
    }, [activeTab]);

    // IK726P 规则4：一键清除——清空当前 tab 内容回到空态（占位提示重新出现）并聚焦。
    const clearPrompt = useCallback(() => {
      setTabContents((prev) => ({ ...prev, [activeTab]: "" }));
      promptEditorRef.current?.focusToEnd();
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

    // 素材上传只落入当前激活 tab（6.1）；编号按 tab 内类型累计（3.4）；类型按 tab 收紧（3.1）。
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (files.length === 0) return;

      // 替换模式（3.5）：新文件顶替原素材位置并保留编号。
      const replaceId = replaceTargetRef.current;
      replaceTargetRef.current = null;
      if (replaceId && files[0]) {
        const file = files[0];
        const type = detectMediaType(file);
        if (!ALLOWED_TYPES_BY_TAB[activeTab].includes(type)) {
          toast.error("该 Tab 不支持此文件类型");
          return;
        }
        setMediaByTab((prev) => ({
          ...prev,
          [activeTab]: prev[activeTab].map((item) => {
            if (item.id !== replaceId) return item;
            if (item.src?.startsWith("blob:")) URL.revokeObjectURL(item.src);
            const num = item.name.match(/\d+$/)?.[0] ?? "";
            return {
              ...item,
              type,
              name: `${mediaLabel(type)} ${num}`,
              src: URL.createObjectURL(file),
              file,
            };
          }),
        }));
        return;
      }

      // 类型校验（3.1）：传入不允许类型 → 轻提示并拒绝。
      const allowed = ALLOWED_TYPES_BY_TAB[activeTab];
      const invalid = files.filter((f) => !allowed.includes(detectMediaType(f)));
      if (invalid.length > 0) {
        toast.error("该 Tab 不接受此文件类型");
        return;
      }

      // 编号只增不减（3.4）：基于累计 counter 分配，删除后不复用。
      const counter = { ...mediaCounterByTab[activeTab] };
      const newItems: MediaItem[] = files.map((file) => {
        const type = detectMediaType(file);
        counter[type] += 1;
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          name: `${mediaLabel(type)} ${counter[type]}`,
          src: URL.createObjectURL(file),
          file,
        };
      });
      setMediaCounterByTab((prev) => ({ ...prev, [activeTab]: counter }));
      setMediaByTab((prev) => ({
        ...prev,
        [activeTab]: [...prev[activeTab], ...newItems],
      }));
    };

    // IK74TX 3.5：缩略图替换入口——记录目标 id 后唤起文件选择器，选择器消费时顶替。
    const handleReplaceMedia = useCallback((id: string) => {
      replaceTargetRef.current = id;
      fileInputRef.current?.click();
    }, []);

    const removeMedia = useCallback(
      (id: string) => {
        setMediaByTab((prev) => {
          const list = prev[activeTab];
          const removed = list.find((item) => item.id === id);
          if (removed?.src?.startsWith("blob:")) URL.revokeObjectURL(removed.src);
          return {
            ...prev,
            [activeTab]: list.filter((item) => item.id !== id),
          };
        });
      },
      [activeTab],
    );

    // 仅在组件卸载时统一释放所有 tab 尚未移除的 blob: 对象 URL。
    const mediaByTabRef = useRef(mediaByTab);
    // ref 写入须在 effect 内（render 期间写 ref 触发 react-hooks/refs）。
    useEffect(() => {
      mediaByTabRef.current = mediaByTab;
    });
    useEffect(() => {
      return () => {
        Object.values(mediaByTabRef.current)
          .flat()
          .forEach((item) => {
            if (item.src?.startsWith("blob:")) URL.revokeObjectURL(item.src);
          });
      };
    }, []);

    const isVideoTab = activeTab === "video";
    const isImageTab = activeTab === "image";

    // IK74TX 3.2：当前 tab 所属模型的素材上限（模型未加载时不限制）。
    const activeMaxRef =
      (isImageTab
        ? selectedImageModel
        : isVideoTab
          ? videoSelectedModel
          : agentVideoModel)?.features.max_reference_images ?? Infinity;

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
              accept={ACCEPT_BY_TAB[activeTab]}
              multiple
              type="file"
              onChange={handleFileChange}
            />

            {isImageTab ? (
              // AI 图片 Tab layout（IK74V6：面板组件化，参数态下沉）
              <ImageTabPanel
                value={tabContents[activeTab] ?? ""}
                onChange={handleInput}
                editorRef={promptEditorRef}
                onFocusChange={setIsFocused}
                mediaList={mediaByTab[activeTab]}
                removeMedia={removeMedia}
                clearPrompt={clearPrompt}
                onGenerate={handleGenerate}
                dropClass={dropClass}
                fileInputRef={fileInputRef}
                onReplaceMedia={handleReplaceMedia}
                maxReferenceImages={activeMaxRef}
                imageModels={imageModels}
                selectedImageModel={selectedImageModel}
                setSelectedImageModel={setSelectedImageModel}
                imageAspectRatio={imageAspectRatio}
                setImageAspectRatio={setImageAspectRatio}
                imageResolution={imageResolution}
                setImageResolution={setImageResolution}
              />
            ) : isVideoTab ? (
              // AI 视频 Tab layout（IK74V6：面板组件化，参数态下沉）
              <VideoTabPanel
                value={tabContents[activeTab] ?? ""}
                onChange={handleInput}
                editorRef={promptEditorRef}
                onFocusChange={setIsFocused}
                mediaList={mediaByTab[activeTab]}
                removeMedia={removeMedia}
                clearPrompt={clearPrompt}
                onGenerate={handleGenerate}
                dropClass={dropClass}
                fileInputRef={fileInputRef}
                onReplaceMedia={handleReplaceMedia}
                maxReferenceImages={activeMaxRef}
                videoModels={videoModels}
                selectedModel={videoSelectedModel}
                setSelectedModel={setVideoSelectedModel}
                refMode={videoRefMode}
                setRefMode={setVideoRefMode}
                aspectRatio={videoAspectRatio}
                setAspectRatio={setVideoAspectRatio}
                resolution={videoResolution}
                setResolution={setVideoResolution}
                videoDuration={videoDuration}
                setVideoDuration={setVideoDuration}
              />
            ) : (
              // 视频智能体 Tab layout（IK74TX：拆分为 AgentTabPanel）
              <AgentTabPanel
                value={tabContents[activeTab] ?? ""}
                onChange={handleInput}
                editorRef={promptEditorRef}
                onFocusChange={setIsFocused}
                mediaList={mediaByTab[activeTab]}
                removeMedia={removeMedia}
                clearPrompt={clearPrompt}
                onGenerate={handleGenerate}
                dropClass={dropClass}
                fileInputRef={fileInputRef}
                onReplaceMedia={handleReplaceMedia}
                maxReferenceImages={activeMaxRef}
                boundSkill={boundSkill}
                onRemoveBoundSkill={handleRemoveBoundSkill}
                skillPanelOpen={skillPanelOpen}
                setSkillPanelOpen={setSkillPanelOpen}
                onUseSkill={handleUseSkill}
                videoModels={videoModels}
                selectedModel={agentVideoModel}
                setSelectedModel={setAgentVideoModel}
                agentModels={agentModels}
                selectedAgentModel={selectedAgentModel}
                setSelectedAgentModel={setSelectedAgentModel}
              />
            )}
          </div>
        </div>
      </div>
    );
  },
);

export default AgentComposer;
