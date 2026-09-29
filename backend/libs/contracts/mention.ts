/** Mention 可用性判定的两个枚举（T08，IK67H3）。
 *
 *  ⚠️ 这两个类型与 `libs/core/conversation/accept-conversation-message.ts` 里的
 *  `MentionFailureReason` **并行存在**，是有意的：契约层与 core 各留一份，避免
 *  `libs/contracts → libs/core` 之外再引入反向依赖（contracts 已经因 `readiness.ts`
 *  依赖 core 的 `readiness`，反向再引会成环）。两侧取值必须保持一致。
 *
 *  注意：这里原先是从 `agent-runtime.ts` 的 `mentionInputEntrySchema` /
 *  `mentionFailureReasonSchema` 派生出来的——那两个 schema 的实际解析方
 *  （MentionInputSnapshot 冻结路径）已随内嵌 Agent 运行时退役删除，只剩类型还有人用，
 *  所以把类型独立出来，不再挂在一个没人解析的 schema 上。
 */

/** mention 在冻结/判定时点的可用性三态。 */
export type MentionAvailability = "available" | "stale" | "unavailable";

/** mention 不可用的原因四态（对齐 core 的同名联合）。 */
export type MentionFailureReason =
  | "deleted"
  | "stale"
  | "permission_lost"
  | "wrong_project";
