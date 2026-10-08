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
  asset?:
    | {
        user_id: bigint;
        project_id: bigint;
        status: string;
        is_delete: boolean;
      }
    | undefined;
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
