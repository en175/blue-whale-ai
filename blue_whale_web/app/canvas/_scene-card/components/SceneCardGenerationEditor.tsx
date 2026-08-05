"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SCENE_CARD_VERSION_CONFLICT_CODE,
  deriveVideoReferenceMode,
  referenceModeToRequiredFeature,
  type CapabilitySnapshotVersion,
  type ProviderPromptAsset,
  type VideoReferenceMode,
} from "@blue-whale/contracts";

import {
  generateSceneCard,
  getSceneCardGenerationPreset,
  type SceneCardGenerationPreset,
} from "@/lib/conversation";
import {
  loadSceneCardDraft,
  saveSceneCardDraft,
  clearSceneCardDraft,
} from "@/lib/scene-card-gen-draft";
import { newCommandIdentity } from "@/lib/command-identity";
import { isApiError } from "@/lib/api/errors";
import {
  getVideoModels,
  type ImageModelCapability,
} from "@/app/canvas/_canvas/api/generation";
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATION_MAX,
  VIDEO_DURATION_MIN,
  VIDEO_DURATION_STEP,
  VIDEO_RESOLUTIONS,
} from "@/app/canvas/_canvas/constants";

import { MarkdownBody } from "./MarkdownBody";

/** 可调参数 overrides（IK67HB/T13）：媒体类型/权威正文/ProviderPromptProjection 只读；
 *  模型仅可切到与首次冻结能力版本和摘要一致的候选；
 *  比例/分辨率/时长/数量/参考模式在当前能力支持范围内可调。 */
type Overrides = {
  model_id: string;
  aspect_ratio: string;
  size: string;
  duration: number;
  count: number;
  reference_mode: VideoReferenceMode;
  reference_assets: ProviderPromptAsset[];
};

const REFERENCE_MODE_OPTIONS = [
  { id: "text_to_video", label: "文生视频" },
  { id: "first_frame", label: "首帧" },
  { id: "last_frame", label: "尾帧" },
  { id: "first_and_last_frame", label: "首尾帧" },
];

const REFERENCE_ROLE_OPTIONS = [
  { id: "reference", label: "普通参考" },
  { id: "first_frame", label: "首帧" },
  { id: "last_frame", label: "尾帧" },
] as const;

const CAPABILITY_DRIFT_MESSAGE =
  "模型能力与首次冻结快照不一致，未切换；请重新确认生成参数。";

function getReferenceCapabilityError(
  model: ImageModelCapability | null,
  referenceMode: VideoReferenceMode,
): string | null {
  if (!model || referenceMode === "text_to_video") return null;
  const required = referenceModeToRequiredFeature(referenceMode);
  if (required && model.features[required] !== true) {
    const label =
      REFERENCE_MODE_OPTIONS.find((option) => option.id === referenceMode)
        ?.label ?? referenceMode;
    return `当前模型不支持${label}参考模式`;
  }
  return null;
}

function matchesFrozenCapability(
  model: ImageModelCapability | undefined,
  snapshot: CapabilitySnapshotVersion,
): model is ImageModelCapability {
  return Boolean(
    model &&
    model.version === snapshot.row_version &&
    model.digest === snapshot.digest,
  );
}

function deriveOptions(model: ImageModelCapability | null) {
  const sizes =
    model?.supported_sizes.map((s) => ({ id: s.id, label: s.label })) ??
    VIDEO_RESOLUTIONS;
  const ratios =
    model?.supported_aspect_ratios.map((r) => ({ id: r, label: r })) ??
    VIDEO_ASPECT_RATIOS.map((r) => ({ id: r.id, label: r.label }));
  const duration = model?.supported_durations ?? {
    min: VIDEO_DURATION_MIN,
    max: VIDEO_DURATION_MAX,
    step: VIDEO_DURATION_STEP,
  };
  const quantityMax = model?.features.quantity_max ?? 1;
  return { sizes, ratios, duration, quantityMax };
}

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
  const [overrides, setOverrides] = useState<Overrides | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    scene_card: number;
    preset: number;
  } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setConflict(null);
      setErrorMessage(null);
      try {
        const [presetData, models] = await Promise.all([
          getSceneCardGenerationPreset(projectId, sceneCardId),
          getVideoModels(),
        ]);
        if (cancelled) return;
        setPreset(presetData);
        setCapabilities(models);
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
        {overrides.reference_assets.length > 0 && (
          <ReferenceAssetsEditor
            assets={overrides.reference_assets}
            disabled={submitting}
            onChange={(reference_assets) =>
              setOverrides({
                ...overrides,
                reference_mode: deriveVideoReferenceMode(reference_assets),
                reference_assets,
              })
            }
          />
        )}
      </section>

      {conflict && (
        <div
          className="flex flex-col gap-2 rounded p-3 text-[12px]"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-accent)",
            color: "var(--tc-text-primary)",
          }}
        >
          <span>
            版本冲突：该场景卡已被另一处更新（当前版本 {conflict.scene_card}/
            {conflict.preset}）。草稿已保留，重新加载复核后可再次提交。
          </span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="self-start rounded px-3 py-1 text-[12px]"
            style={{
              background: "var(--tc-accent)",
              border: "1px solid var(--tc-accent)",
              color: "var(--tc-text-primary)",
            }}
          >
            重新加载
          </button>
        </div>
      )}

      {/* 可调区：模型切换受首次冻结能力版本与摘要约束 */}
      <section className="flex flex-col gap-3">
        <SelectField
          label="模型"
          value={overrides.model_id}
          options={capabilities.map((model) => ({
            id: model.model_id,
            label: model.model_label,
          }))}
          disabled={submitting}
          onChange={handleModelChange}
        />
        <SelectField
          label="比例"
          value={overrides.aspect_ratio}
          options={options.ratios}
          disabled={submitting}
          onChange={(aspect_ratio) =>
            setOverrides({ ...overrides, aspect_ratio })
          }
        />
        <SelectField
          label="分辨率"
          value={overrides.size}
          options={options.sizes}
          disabled={submitting}
          onChange={(size) => setOverrides({ ...overrides, size })}
        />
        <div className="flex flex-col gap-1">
          <label
            className="text-[11px]"
            style={{ color: "var(--tc-text-muted)" }}
          >
            时长（{options.duration.min}-{options.duration.max}s）
          </label>
          <input
            type="number"
            min={options.duration.min}
            max={options.duration.max}
            step={options.duration.step}
            value={overrides.duration}
            disabled={submitting}
            onChange={(e) =>
              setOverrides({ ...overrides, duration: Number(e.target.value) })
            }
            className="rounded px-2 py-1 text-[12px]"
            style={{
              background: "var(--tc-bg-elevated)",
              border: "1px solid var(--tc-border-subtle)",
              color: "var(--tc-text-primary)",
            }}
          />
        </div>
        <SelectField
          label="数量"
          value={String(overrides.count)}
          options={Array.from({ length: options.quantityMax }, (_, i) => ({
            id: String(i + 1),
            label: `${i + 1}x`,
          }))}
          disabled={submitting}
          onChange={(count) =>
            setOverrides({ ...overrides, count: Number(count) })
          }
        />
        <SelectField
          label="参考模式"
          value={overrides.reference_mode}
          options={referenceModeOptions}
          disabled
          onChange={() => undefined}
        />
      </section>

      {errorMessage && (
        <p
          className="m-0 text-[12px]"
          style={{ color: "var(--tc-text-primary)" }}
        >
          {errorMessage}
        </p>
      )}

      {referenceCapabilityError && (
        <p
          className="m-0 text-[12px]"
          style={{ color: "var(--tc-text-primary)" }}
        >
          {referenceCapabilityError}
        </p>
      )}

      <footer className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleClose}
          disabled={submitting}
          className="rounded px-3 py-1.5 text-[12px]"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            color: "var(--tc-text-primary)",
          }}
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={
            submitting || conflict !== null || referenceCapabilityError !== null
          }
          className="rounded px-3 py-1.5 text-[12px]"
          style={{
            background: "var(--tc-accent)",
            border: "1px solid var(--tc-accent)",
            color: "var(--tc-text-primary)",
            opacity:
              submitting || conflict !== null || referenceCapabilityError
                ? 0.6
                : 1,
          }}
        >
          {submitting ? "生成中…" : "生成"}
        </button>
      </footer>
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        {label}
      </label>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded px-2 py-1 text-[12px]"
        style={{
          background: "var(--tc-bg-elevated)",
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
        }}
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReferenceAssetsEditor({
  assets,
  disabled,
  onChange,
}: {
  assets: ProviderPromptAsset[];
  disabled: boolean;
  onChange: (assets: ProviderPromptAsset[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        参考素材角色
      </span>
      {assets.map((asset, i) => {
        return (
          <SelectField
            key={`${asset.type}:${asset.mention_id}`}
            label={`参考素材 ${i + 1} 角色`}
            value={asset.role}
            options={REFERENCE_ROLE_OPTIONS.map((option) => ({ ...option }))}
            disabled={disabled}
            onChange={(value) => {
              const role = REFERENCE_ROLE_OPTIONS.find(
                (option) => option.id === value,
              )?.id;
              if (!role) return;
              onChange(
                assets.map((current, index) =>
                  index === i
                    ? { ...current, role }
                    : role !== "reference" && current.role === role
                      ? { ...current, role: "reference" }
                      : current,
                ),
              );
            }}
          />
        );
      })}
    </div>
  );
}
