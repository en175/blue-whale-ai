/**
 * SceneCard 生成编辑器草稿（IK67HB/T13）：按 sceneCardId 持久化到 localStorage。
 * 跨刷新存活；用户显式点"关闭/取消"或生成成功才清除；版本冲突时保留草稿，刷新复核后重提交。
 */
const DRAFT_KEY_PREFIX = "blue-whale:scene-card-gen-draft:";

export type SceneCardGenDraft = {
  baseSceneCardVersion: number;
  basePresetVersion: number;
  overrides: Record<string, unknown>;
  updatedAt: string;
};

function storageKey(sceneCardId: string): string {
  return `${DRAFT_KEY_PREFIX}${sceneCardId}`;
}

export function loadSceneCardDraft(
  sceneCardId: string,
): SceneCardGenDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(sceneCardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SceneCardGenDraft>;
    if (
      typeof parsed.baseSceneCardVersion !== "number" ||
      typeof parsed.basePresetVersion !== "number" ||
      !parsed.overrides ||
      typeof parsed.overrides !== "object"
    ) {
      return null;
    }
    return {
      baseSceneCardVersion: parsed.baseSceneCardVersion,
      basePresetVersion: parsed.basePresetVersion,
      overrides: parsed.overrides,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

export function saveSceneCardDraft(
  sceneCardId: string,
  draft: SceneCardGenDraft,
): void {
  try {
    window.localStorage.setItem(storageKey(sceneCardId), JSON.stringify(draft));
  } catch {
    // 存储不可用（隐私模式/配额）时静默降级，不阻塞编辑
  }
}

export function clearSceneCardDraft(sceneCardId: string): void {
  try {
    window.localStorage.removeItem(storageKey(sceneCardId));
  } catch {
    // 同 saveSceneCardDraft：静默降级
  }
}
