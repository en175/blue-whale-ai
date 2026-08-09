"use client";

import type { VideoReferenceMode } from "@blue-whale/contracts";

import type { ImageModelCapability } from "@/app/canvas/_canvas/api/generation";

import { SelectField } from "./SceneCardGenerationFields";

export function ConflictNotice({
  conflict,
  onReload,
}: {
  conflict: { scene_card: number; preset: number };
  onReload: () => void;
}) {
  return (
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
        onClick={onReload}
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
  );
}

export function EditorMessages({
  errorMessage,
  referenceCapabilityError,
}: {
  errorMessage: string | null;
  referenceCapabilityError: string | null;
}) {
  return (
    <>
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
    </>
  );
}

export type GenerationOverrides = {
  model_id: string;
  aspect_ratio: string;
  size: string;
  duration: number;
  count: number;
  reference_mode: VideoReferenceMode;
};

type GenerationOptions = {
  sizes: Array<{ id: string; label: string }>;
  ratios: Array<{ id: string; label: string }>;
  duration: { min: number; max: number; step: number };
  quantityMax: number;
};

export function GenerationSettings({
  overrides,
  capabilities,
  options,
  referenceModeOptions,
  disabled,
  onModelChange,
  onChange,
}: {
  overrides: GenerationOverrides;
  capabilities: ImageModelCapability[];
  options: GenerationOptions;
  referenceModeOptions: Array<{ id: string; label: string }>;
  disabled: boolean;
  onModelChange: (modelId: string) => void;
  onChange: (patch: Partial<GenerationOverrides>) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SelectField
        label="模型"
        value={overrides.model_id}
        options={capabilities.map(({ model_id, model_label }) => ({
          id: model_id,
          label: model_label,
        }))}
        disabled={disabled}
        onChange={onModelChange}
      />
      <SelectField
        label="比例"
        value={overrides.aspect_ratio}
        options={options.ratios}
        disabled={disabled}
        onChange={(aspect_ratio) => onChange({ aspect_ratio })}
      />
      <SelectField
        label="分辨率"
        value={overrides.size}
        options={options.sizes}
        disabled={disabled}
        onChange={(size) => onChange({ size })}
      />
      <DurationField
        value={overrides.duration}
        duration={options.duration}
        disabled={disabled}
        onChange={(duration) => onChange({ duration })}
      />
      <SelectField
        label="数量"
        value={String(overrides.count)}
        options={Array.from({ length: options.quantityMax }, (_, index) => ({
          id: String(index + 1),
          label: `${index + 1}x`,
        }))}
        disabled={disabled}
        onChange={(count) => onChange({ count: Number(count) })}
      />
      <SelectField
        label="参考模式"
        value={overrides.reference_mode}
        options={referenceModeOptions}
        disabled
        onChange={() => undefined}
      />
    </section>
  );
}

function DurationField({
  value,
  duration,
  disabled,
  onChange,
}: {
  value: number;
  duration: GenerationOptions["duration"];
  disabled: boolean;
  onChange: (duration: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        时长（{duration.min}-{duration.max}s）
      </label>
      <input
        type="number"
        min={duration.min}
        max={duration.max}
        step={duration.step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded px-2 py-1 text-[12px]"
        style={{
          background: "var(--tc-bg-elevated)",
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
        }}
      />
    </div>
  );
}

export function GenerationActions({
  submitting,
  generateBlocked,
  menuBlocked,
  menuOpen,
  storyboardAvailable,
  onClose,
  onGenerate,
  onToggleMenu,
  onStoryboard,
}: {
  submitting: boolean;
  generateBlocked: boolean;
  menuBlocked: boolean;
  menuOpen: boolean;
  storyboardAvailable: boolean;
  onClose: () => void;
  onGenerate: () => void;
  onToggleMenu: () => void;
  onStoryboard: () => void;
}) {
  return (
    <footer className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
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
      <div className="relative flex gap-1">
        <button
          type="button"
          onClick={onGenerate}
          disabled={submitting || generateBlocked}
          className="rounded px-3 py-1.5 text-[12px]"
          style={{
            background: "var(--tc-accent)",
            border: "1px solid var(--tc-accent)",
            color: "var(--tc-text-primary)",
            opacity: submitting || generateBlocked ? 0.6 : 1,
          }}
        >
          {submitting ? "生成中…" : "生成"}
        </button>
        <button
          type="button"
          aria-label="更多生成方式"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={submitting || menuBlocked}
          onClick={onToggleMenu}
          className="rounded px-2 py-1.5 text-[12px]"
          style={{
            background: "var(--tc-bg-elevated)",
            border: "1px solid var(--tc-border-subtle)",
            color: "var(--tc-text-primary)",
          }}
        >
          ▾
        </button>
        {menuOpen && (
          <GenerationMenu
            storyboardAvailable={storyboardAvailable}
            onGenerate={onGenerate}
            onStoryboard={onStoryboard}
          />
        )}
      </div>
    </footer>
  );
}

function GenerationMenu({
  storyboardAvailable,
  onGenerate,
  onStoryboard,
}: {
  storyboardAvailable: boolean;
  onGenerate: () => void;
  onStoryboard: () => void;
}) {
  return (
    <div
      role="menu"
      aria-label="生成方式"
      className="absolute right-0 bottom-full mb-1 flex w-[168px] flex-col overflow-hidden rounded py-1"
      style={{
        background: "var(--tc-bg-elevated)",
        border: "1px solid var(--tc-border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onGenerate}
        className="px-3 py-2 text-left text-[12px]"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        直接生成视频
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!storyboardAvailable}
        onClick={onStoryboard}
        className="px-3 py-2 text-left text-[12px]"
        style={{ color: "var(--tc-text-secondary)" }}
      >
        先预览分镜图
      </button>
    </div>
  );
}
