"use client";

import type { ProviderPromptAsset } from "@blue-whale/contracts";

import type { StoryboardFrameSummary } from "@/lib/conversation";
import type { ImageModelCapability } from "@/app/canvas/_canvas/api/generation";
import { AuthenticatedImage } from "@/app/canvas/_canvas/components/AuthenticatedImage";

/** IK70LQ：画格角色选项——"不使用"表示该画格不进入生成输入；首/尾帧在 select 选项级
 *  按当前模型 features 显式禁用（不支持标灰），不静默降级为 reference。 */
const FRAME_ROLE_OPTIONS = [
  { id: "none", label: "不使用" },
  { id: "reference", label: "普通参考" },
  { id: "first_frame", label: "首帧" },
  { id: "last_frame", label: "尾帧" },
] as const;

type FrameRoleOption = (typeof FRAME_ROLE_OPTIONS)[number]["id"];

function supportsRole(
  model: ImageModelCapability | null,
  role: FrameRoleOption,
) {
  if (role === "first_frame") {
    return (
      model?.features?.["first_frame"] === true ||
      model?.features?.["first_last_frame"] === true
    );
  }
  if (role === "last_frame") {
    return model?.features?.["first_last_frame"] === true;
  }
  return true;
}

function FrameRoleSelect({
  frame,
  index,
  projectId,
  value,
  model,
  disabled,
  onChange,
}: {
  frame: StoryboardFrameSummary;
  index: number;
  projectId: string;
  value: FrameRoleOption;
  model: ImageModelCapability | null;
  disabled: boolean;
  onChange: (role: FrameRoleOption) => void;
}) {
  const label = `画格 ${index + 1}`;
  return (
    <div className="flex flex-col gap-1">
      <AuthenticatedImage
        accessUrl={`/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(String(frame.asset_id))}/content`}
        alt={label}
        className="h-20 w-full rounded-md object-cover"
      />
      <label className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        {label} 角色
      </label>
      <select
        aria-label={`${label} 角色`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as FrameRoleOption)}
        className="rounded-md px-2 py-1 text-[12px]"
        style={{
          background: "var(--tc-bg-elevated)",
          border: "1px solid var(--tc-border-subtle)",
          color: "var(--tc-text-primary)",
        }}
      >
        {FRAME_ROLE_OPTIONS.map((option) => {
          const unsupported = !supportsRole(model, option.id);
          return (
            <option key={option.id} value={option.id} disabled={unsupported}>
              {unsupported ? `${option.label}（不支持）` : option.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

/** IK70LQ：分镜画格角色选择器——列出 succeeded 画格，每个画格选角色（不使用/普通参考/首帧/尾帧）。
 *  首/尾帧选项按当前模型 features 显式禁用（不支持标灰），不静默降级；首/尾帧全局唯一由后端兜底。 */
export function StoryboardFrameSelector({
  projectId,
  frames,
  frameAssets,
  model,
  disabled,
  onChange,
}: {
  projectId: string;
  frames: StoryboardFrameSummary[];
  frameAssets: Extract<ProviderPromptAsset, { type: "storyboard_frame" }>[];
  model: ImageModelCapability | null;
  disabled: boolean;
  onChange: (
    next: Extract<ProviderPromptAsset, { type: "storyboard_frame" }>[],
  ) => void;
}) {
  const roleBySlotId = new Map(
    frameAssets.map((frame) => [frame.slot_id, frame.role]),
  );
  const updateRole = (slotId: string, role: FrameRoleOption) => {
    const others = frameAssets.filter((frame) => frame.slot_id !== slotId);
    if (role === "none") {
      onChange(others);
      return;
    }
    onChange([
      ...others,
      {
        slot_id: slotId,
        type: "storyboard_frame" as const,
        role,
      },
    ]);
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px]" style={{ color: "var(--tc-text-muted)" }}>
        分镜画格
      </span>
      {frames.map((frame, i) => {
        const current = roleBySlotId.get(String(frame.slot_id)) ?? "none";
        return (
          <FrameRoleSelect
            key={`storyboard_frame:${frame.slot_id}`}
            frame={frame}
            index={i}
            projectId={projectId}
            value={current}
            model={model}
            disabled={disabled}
            onChange={(role) => updateRole(String(frame.slot_id), role)}
          />
        );
      })}
    </div>
  );
}
