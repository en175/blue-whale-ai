"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SCENE_CARD_VERSION_CONFLICT_CODE,
  deriveVideoReferenceMode,
  referenceModeToRequiredFeature,
  type CapabilitySnapshotVersion,
  type VideoReferenceMode,
} from "@blue-whale/contracts";

import {
  createStoryboardPreview,
  generateSceneCard,
  getSceneCardGenerationPreset,
  getStoryboardPreviews,
  type SceneCardGenerationPreset,
  type StoryboardFrameSummary,
} from "@/lib/conversation";
import {
  loadSceneCardDraft,
  saveSceneCardDraft,
  clearSceneCardDraft,
} from "@/lib/scene-card-gen-draft";
import { newCommandIdentity } from "@/lib/command-identity";
import { isApiError } from "@/lib/api/errors";
import {
  getImageModels,
  getVideoModels,
  type ImageModelCapability,
} from "@/app/canvas/_canvas/api/generation";

import { MarkdownBody } from "./MarkdownBody";
import {
  REFERENCE_MODE_OPTIONS,
  CAPABILITY_DRIFT_MESSAGE,
  getReferenceCapabilityError,
  matchesFrozenCapability,
  deriveOptions,
  type Overrides,
} from "./scene-card-generation-logic";
import {
  ConflictNotice,
  EditorMessages,
  GenerationActions,
  GenerationSettings,
} from "./SceneCardGenerationControls";
import {
  isFrameAsset,
  isMentionAsset,
  ReferenceAssetsEditor,
} from "./SceneCardGenerationFields";
import { StoryboardFrameSelector } from "./StoryboardFrameSelector";

export function SceneCardGenerationEditor({
  projectId,
  sceneCardId,
  onClose,
}: {
  projectId: string;
  sceneCardId: string;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<SceneCardGenerationPreset | null>(null);
  const [capabilities, setCapabilities] = useState<ImageModelCapability[]>([]);
  const [storyboardModels, setStoryboardModels] = useState<
    ImageModelCapability[]
  >([]);
  const [storyboardFrames, setStoryboardFrames] = useState<
    StoryboardFrameSummary[]
  >([]);
  const [overrides, setOverrides] = useState<Overrides | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    scene_card: number;
    preset: number;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [generationMenuOpen, setGenerationMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setConflict(null);
      setErrorMessage(null);
      try {
        const [presetData, models, imageModels, previewData] =
          await Promise.all([
            getSceneCardGenerationPreset(projectId, sceneCardId),
            getVideoModels(),
            getImageModels().catch(() => []),
            getStoryboardPreviews(projectId, sceneCardId).catch((error) => {
              console.error(
                "[scene-card-editor] 分镜画格加载失败：",
                error instanceof Error ? error.message : error,
              );
              return { previews: [], frames: [] };
            }),
          ]);
        if (cancelled) return;
        setPreset(presetData);
        setCapabilities(models);
        setStoryboardModels(imageModels);
        setStoryboardFrames(previewData.frames ?? []);
        // 恢复草稿（若有且 base 版本一致），否则用当前 preset 初始化 overrides。
        const draft = loadSceneCardDraft(sceneCardId);
        const params = presetData.preset.parameters as Record<string, unknown>;
        const snapshot = presetData.preset
          .capability_snapshot_version as CapabilitySnapshotVersion;
        const initialReferenceAssets = presetData.preset.reference_assets;
        const initial: Overrides = {
          model_id: String(params.model_id ?? snapshot.model_id),
          aspect_ratio: String(params.aspect_ratio ?? ""),
          size: String(params.size ?? ""),
          duration: Number(params.duration ?? 0),
          count: Number(params.count ?? 1),
          reference_mode: deriveVideoReferenceMode(initialReferenceAssets),
          reference_assets: initialReferenceAssets,
        };
        if (
          draft &&
          draft.baseSceneCardVersion === presetData.scene_card.version &&
          draft.basePresetVersion === presetData.preset.version
        ) {
          const d = draft.overrides as Partial<Overrides>;
          const draftModelId = d.model_id ?? initial.model_id;
          const draftModel = models.find(
            (model) => model.model_id === draftModelId,
          );
          const canRestoreDraftModel =
            draftModelId === snapshot.model_id ||
            matchesFrozenCapability(draftModel, snapshot);
          if (!canRestoreDraftModel) {
            setErrorMessage(CAPABILITY_DRIFT_MESSAGE);
          }
          const referenceAssets =
            d.reference_assets ?? initial.reference_assets;
          setOverrides({
            model_id: canRestoreDraftModel ? draftModelId : initial.model_id,
            aspect_ratio: d.aspect_ratio ?? initial.aspect_ratio,
            size: d.size ?? initial.size,
            duration: d.duration ?? initial.duration,
            count: d.count ?? initial.count,
            reference_mode: deriveVideoReferenceMode(referenceAssets),
            reference_assets: referenceAssets,
          });
        } else {
          setOverrides(initial);
        }
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          isApiError(error) ? error.message : "加载场景卡生成预设失败",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, sceneCardId, reloadKey]);

  const selectedModel = useMemo(() => {
    if (!overrides?.model_id) return null;
    return capabilities.find((m) => m.model_id === overrides.model_id) ?? null;
  }, [overrides, capabilities]);

  const options = useMemo(() => deriveOptions(selectedModel), [selectedModel]);

  const referenceCapabilityError = useMemo(
    () =>
      overrides
        ? getReferenceCapabilityError(selectedModel, overrides.reference_mode)
        : null,
    [overrides, selectedModel],
  );

  // 参考模式按当前模型能力过滤（AC#1）：text_to_video 永展；first_frame、last_frame、
  // first_and_last_frame 分别跟随各自独立能力。无模型数据时全展
  // （与 deriveOptions fallback 一致，合法性交 worker 兜底）。
  const referenceModeOptions = useMemo(() => {
    if (!selectedModel) return REFERENCE_MODE_OPTIONS;
    const features = selectedModel.features;
    return REFERENCE_MODE_OPTIONS.filter((opt) => {
      if (opt.id === overrides?.reference_mode) return true;
      const required = referenceModeToRequiredFeature(
        opt.id as VideoReferenceMode,
      );
      return required === null || features[required] === true;
    });
  }, [overrides?.reference_mode, selectedModel]);

  // IK70LQ：reference_assets 分两组——mention 派生组（身份锁）走 ReferenceAssetsEditor，
  //  画格组（自由增删改 role）走 StoryboardFrameSelector；合并保持 [mention, frame] 顺序。
  const mentionAssets = useMemo(
    () => (overrides?.reference_assets ?? []).filter(isMentionAsset),
    [overrides],
  );
  const frameAssets = useMemo(
    () => (overrides?.reference_assets ?? []).filter(isFrameAsset),
    [overrides],
  );

  // overrides 变化即时存草稿（跨刷新存活；冲突/关闭由调用方决定清除）。
  useEffect(() => {
    if (!overrides || !preset) return;
    saveSceneCardDraft(sceneCardId, {
      baseSceneCardVersion: preset.scene_card.version,
      basePresetVersion: preset.preset.version,
      overrides,
      updatedAt: new Date().toISOString(),
    });
  }, [overrides, preset, sceneCardId]);

  function handleModelChange(modelId: string) {
    if (!preset || !overrides) return;
    const candidate = capabilities.find((model) => model.model_id === modelId);
    const frozen = preset.preset
      .capability_snapshot_version as CapabilitySnapshotVersion;
    if (!matchesFrozenCapability(candidate, frozen)) {
      setErrorMessage(CAPABILITY_DRIFT_MESSAGE);
      return;
    }
    setErrorMessage(null);
    setOverrides({ ...overrides, model_id: modelId });
  }

  async function handleGenerate() {
    if (
      !preset ||
      !overrides ||
      !selectedModel ||
      submitting ||
      referenceCapabilityError
    )
      return;
    setSubmitting(true);
    setErrorMessage(null);
    setConflict(null);
    try {
      const baseParameters = preset.preset.parameters as Record<
        string,
        unknown
      >;
      const frozen = preset.preset
        .capability_snapshot_version as CapabilitySnapshotVersion;
      const capabilitySnapshotVersion: CapabilitySnapshotVersion =
        selectedModel.model_id === frozen.model_id
          ? frozen
          : {
              schema_version: 1,
              capability_type: "video",
              model_id: selectedModel.model_id,
              provider_id: selectedModel.provider_id,
              row_version: selectedModel.version,
              digest: selectedModel.digest,
            };
      const body = {
        scene_card_id: sceneCardId,
        base_scene_card_version: preset.scene_card.version,
        base_preset_version: preset.preset.version,
        parameters: {
          ...baseParameters,
          model_id: overrides.model_id,
          aspect_ratio: overrides.aspect_ratio,
          size: overrides.size,
          duration: overrides.duration,
          count: overrides.count,
        },
        reference_mode: overrides.reference_mode,
        reference_assets: overrides.reference_assets,
        capability_snapshot_version: capabilitySnapshotVersion,
      };
      await generateSceneCard(
        projectId,
        sceneCardId,
        newCommandIdentity(),
        body,
      );
      clearSceneCardDraft(sceneCardId);
      onClose();
    } catch (error) {
      if (isApiError(error)) {
        if (error.code === String(SCENE_CARD_VERSION_CONFLICT_CODE)) {
          const detail = error.detail as
            | {
                current_scene_card_version?: number;
                current_preset_version?: number;
              }
            | undefined;
          const currentSceneCardVersion =
            detail?.current_scene_card_version ?? preset.scene_card.version;
          const currentPresetVersion =
            detail?.current_preset_version ?? preset.preset.version;
          // AC#6：零写入但草稿必须存活到复核——按服务端最新版本重写草稿基准，
          // 否则重新加载后基准失配、草稿被静默丢弃，"刷新复核再提交"不可达。
          saveSceneCardDraft(sceneCardId, {
            baseSceneCardVersion: currentSceneCardVersion,
            basePresetVersion: currentPresetVersion,
            overrides,
            updatedAt: new Date().toISOString(),
          });
          setConflict({
            scene_card: currentSceneCardVersion,
            preset: currentPresetVersion,
          });
          setSubmitting(false);
          return;
        }
        setErrorMessage(error.message);
      } else {
        setErrorMessage("生成失败，请稍后重试");
      }
    }
    setSubmitting(false);
  }

  async function handleStoryboardPreview() {
    const model = storyboardModels[0];
    if (!preset || !model || submitting) {
      if (!model) setErrorMessage("暂无可用图片模型，无法生成分镜预览");
      return;
    }
    setSubmitting(true);
    setGenerationMenuOpen(false);
    setErrorMessage(null);
    try {
      await createStoryboardPreview(
        projectId,
        sceneCardId,
        newCommandIdentity(),
        {
          scene_card_id: sceneCardId,
          base_scene_card_version: preset.scene_card.version,
          parameters: {
            model_id: model.model_id,
            size: model.default_size,
            aspect_ratio: model.default_aspect_ratio,
            count: Math.min(4, Math.max(1, model.features.quantity_max)),
          },
          capability_snapshot_version: {
            schema_version: 1,
            capability_type: "image",
            model_id: model.model_id,
            provider_id: model.provider_id,
            row_version: model.version,
            digest: model.digest,
          },
        },
      );
      onClose();
    } catch (error) {
      setErrorMessage(
        isApiError(error) ? error.message : "分镜预览生成失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    // 用户显式关闭 → 清草稿（AC#3 关闭不持久化）。
    clearSceneCardDraft(sceneCardId);
    onClose();
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center p-6 text-[12px]"
        style={{ color: "var(--tc-text-muted)" }}
      >
        加载生成预设…
      </div>
    );
  }

  if (errorMessage && !preset) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p
          className="m-0 text-[12.5px]"
          style={{ color: "var(--tc-text-secondary)" }}
        >
          {errorMessage}
        </p>
        <button
          type="button"
          onClick={handleClose}
          className="self-start rounded px-3 py-1.5 text-[12px]"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            color: "var(--tc-text-primary)",
          }}
        >
          关闭
        </button>
      </div>
    );
  }

  if (!preset || !overrides) return null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <span
          className="text-[13px] font-semibold"
          style={{ color: "var(--tc-text-primary)" }}
        >
          {preset.scene_card.title}
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="text-[12px]"
          style={{ color: "var(--tc-text-muted)" }}
        >
          关闭
        </button>
      </header>

      {/* 只读区：媒体类型 + 权威 Markdown */}
      <section className="flex flex-col gap-2">
        <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
          媒体类型：视频
        </span>
        <div
          className="rounded p-3"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
          }}
        >
          <MarkdownBody markdown={preset.scene_card.content_markdown} />
        </div>
        {preset.projection && (
          <div className="flex flex-col gap-1">
            <span
              className="text-[11px]"
              style={{ color: "var(--tc-text-muted)" }}
            >
              Provider 提示词（只读）
            </span>
            <div
              className="whitespace-pre-wrap rounded p-3 text-[12px]"
              style={{
                background: "var(--tc-bg-elevated)",
                border: "1px solid var(--tc-border-subtle)",
                color: "var(--tc-text-secondary)",
              }}
            >
              {preset.projection.prompt_text}
            </div>
          </div>
        )}
        {mentionAssets.length > 0 && (
          <ReferenceAssetsEditor
            assets={mentionAssets}
            disabled={submitting}
            onChange={(nextMentions) => {
              if (!overrides) return;
              const reference_assets = [...nextMentions, ...frameAssets];
              setOverrides({
                ...overrides,
                reference_mode: deriveVideoReferenceMode(reference_assets),
                reference_assets,
              });
            }}
          />
        )}
        {storyboardFrames.length > 0 && (
          <StoryboardFrameSelector
            projectId={projectId}
            frames={storyboardFrames}
            frameAssets={frameAssets}
            model={selectedModel}
            disabled={submitting}
            onChange={(nextFrames) => {
              if (!overrides) return;
              const reference_assets = [...mentionAssets, ...nextFrames];
              setOverrides({
                ...overrides,
                reference_mode: deriveVideoReferenceMode(reference_assets),
                reference_assets,
              });
            }}
          />
        )}
      </section>

      {conflict && (
        <ConflictNotice
          conflict={conflict}
          onReload={() => setReloadKey((key) => key + 1)}
        />
      )}

      {/* 可调区：模型切换受首次冻结能力版本与摘要约束 */}
      <GenerationSettings
        overrides={overrides}
        capabilities={capabilities}
        options={options}
        referenceModeOptions={referenceModeOptions}
        disabled={submitting}
        onModelChange={handleModelChange}
        onChange={(patch) => setOverrides({ ...overrides, ...patch })}
      />

      <EditorMessages
        errorMessage={errorMessage}
        referenceCapabilityError={referenceCapabilityError}
      />

      <GenerationActions
        submitting={submitting}
        generateBlocked={conflict !== null || referenceCapabilityError !== null}
        menuBlocked={conflict !== null}
        menuOpen={generationMenuOpen}
        storyboardAvailable={storyboardModels.length > 0}
        onClose={handleClose}
        onGenerate={() => void handleGenerate()}
        onToggleMenu={() => setGenerationMenuOpen((open) => !open)}
        onStoryboard={() => void handleStoryboardPreview()}
      />
    </div>
  );
}
