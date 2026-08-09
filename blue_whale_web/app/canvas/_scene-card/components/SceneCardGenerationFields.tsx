"use client";

import type { ProviderPromptAsset } from "@blue-whale/contracts";

const REFERENCE_ROLE_OPTIONS = [
  { id: "reference", label: "普通参考" },
  { id: "first_frame", label: "首帧" },
  { id: "last_frame", label: "尾帧" },
] as const;

export function isMentionAsset(
  asset: ProviderPromptAsset,
): asset is Extract<ProviderPromptAsset, { mention_id: string }> {
  return asset.type === "asset" || asset.type === "scene_card";
}

export function isFrameAsset(
  asset: ProviderPromptAsset,
): asset is Extract<ProviderPromptAsset, { type: "storyboard_frame" }> {
  return asset.type === "storyboard_frame";
}

export function SelectField({
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
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md px-2 py-1 text-[12px]"
        style={{
          background: "var(--tc-bg-elevated)",
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ReferenceAssetsEditor({
  assets,
  disabled,
  onChange,
}: {
  assets: Extract<ProviderPromptAsset, { mention_id: string }>[];
  disabled: boolean;
  onChange: (assets: ProviderPromptAsset[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        参考素材角色
      </span>
      {assets.map((asset, index) => {
        const roleOptions =
          asset.type === "scene_card"
            ? REFERENCE_ROLE_OPTIONS.filter(({ id }) => id === "reference")
            : REFERENCE_ROLE_OPTIONS;
        return (
          <SelectField
            key={`${asset.type}:${asset.mention_id}`}
            label={`参考素材 ${index + 1} 角色`}
            value={asset.role}
            options={roleOptions.map((option) => ({ ...option }))}
            disabled={disabled}
            onChange={(value) => {
              const role = REFERENCE_ROLE_OPTIONS.find(
                (option) => option.id === value,
              )?.id;
              if (!role) return;
              onChange(
                assets.map((current, currentIndex) =>
                  currentIndex === index
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
