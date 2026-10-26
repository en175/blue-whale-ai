
export type MentionAvailability = "available" | "stale" | "unavailable";

export type MentionFailureReason =
  | "deleted"
  | "stale"
  | "permission_lost"
  | "wrong_project";
