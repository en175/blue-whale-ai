/** Mention 可用性判定的唯一权威（T08，IK67H3）。
 *  snapshot-repo 读路径与 agent-run-repo 冻结/重查路径共用同一份四态决策树，
 *  避免两处各自维护导致的发散。类型直接复用契约定义，不本地复刻。 */
import type {
  MentionAvailability,
  MentionFailureReason,
} from "@lib/contracts";

export interface MentionClassification {
  availability: MentionAvailability;
  reason: MentionFailureReason | null;
}

export interface MentionClassificationInput {
  type: "asset" | "scene_card";
  targetVersion: number | null;
  acceptedUserId: bigint;
  /** 调用方按 target_id 查得的当前 asset 事实（缺失则视为删除）。 */
  asset?:
    | {
        user_id: bigint;
        project_id: bigint;
        status: string;
        is_delete: boolean;
      }
    | undefined;
  /** 调用方按 target_id 查得的当前 scene_card 事实（缺失则视为删除）。 */
  sceneCard?:
    | {
        project_id: bigint;
        version: number;
        is_delete: number;
      }
    | undefined;
  projectId: bigint;
  userId: bigint;
}

/**
 * 按 mention 类型与当前事实判定 availability + reason：
 * - asset：deleted（不存在/已删/非 normal）/ wrong_project / permission_lost；否则 available。
 * - scene_card：deleted / wrong_project / permission_lost / stale（版本不符）；stale 保留历史可用性。
 */
export function classifyMentionAvailability(
  input: MentionClassificationInput,
): MentionClassification {
  const { type, targetVersion, acceptedUserId, asset, sceneCard, projectId, userId } =
    input;
  if (type === "asset") {
    const reason: MentionFailureReason | null =
      !asset || asset.is_delete || asset.status !== "normal"
        ? "deleted"
        : asset.project_id !== projectId
          ? "wrong_project"
          : asset.user_id !== userId || acceptedUserId !== userId
            ? "permission_lost"
            : null;
    return { availability: reason ? "unavailable" : "available", reason };
  }
  const reason: MentionFailureReason | null =
    !sceneCard || sceneCard.is_delete !== 0
      ? "deleted"
      : sceneCard.project_id !== projectId
        ? "wrong_project"
        : acceptedUserId !== userId
          ? "permission_lost"
          : sceneCard.version !== targetVersion
            ? "stale"
            : null;
  return {
    availability:
      reason === "stale" ? "stale" : reason ? "unavailable" : "available",
    reason,
  };
}
