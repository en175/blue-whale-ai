import type {
  MentionAvailability,
  MentionFailureReason,
} from "@lib/contracts";

export interface MentionClassification {
  availability: MentionAvailability;
  reason: MentionFailureReason | null;
}

export interface MentionClassificationInput {
  type: "asset";
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
  projectId: bigint;
  userId: bigint;
}

export function classifyMentionAvailability(
  input: MentionClassificationInput,
): MentionClassification {
  const { acceptedUserId, asset, projectId, userId } = input;
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
