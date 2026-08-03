import { createHash } from "node:crypto";

export interface ConversationCommandStoreInput {
  userId: string;
  projectId: string;
  idempotencyKey: string;
  requestHash: string;
  clientMessageId: string;
  content: string;
  conversationId: string | null;
  replyToInputRequestId: string | null;
}

export type ConversationCommandStoreResult =
  | {
      kind: "accepted" | "replayed";
      project_id: string;
      conversation_id: string;
      message_id: string;
      agent_run_id: string;
      cursor: string;
      sequence_no: number;
    }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" }
  | { kind: "input_request_conflict" };

export interface ConversationCommandStore {
  acceptMessage(
    input: ConversationCommandStoreInput,
  ): Promise<ConversationCommandStoreResult>;
}

export type AcceptConversationMessageResult =
  | ConversationCommandStoreResult
  | { kind: "invalid"; message: string }
  | { kind: "creative_skill_unavailable" };

/** forced Creative Skill 域/owner 守卫（资产契约 §4）：返回 true 放行，false 按不可用拒绝。 */
export type ForcedCreativeSkillGuard = (
  userId: string,
  forcedCreativeSkillId: string,
) => Promise<boolean>;

/** 成功激活埋点记录（资产契约 §11.3）。 */
export interface SkillActivationRecord {
  creativeSkillId: string;
  userId: string;
  agentRunId: string;
  skillVersion: number;
  activationSource: "forced" | "auto";
}

/** 激活埋点写入器（资产契约 §11.3）：仅在接受纳的激活路径调用，best-effort。 */
export type SkillActivationRecorder = (
  rec: SkillActivationRecord,
) => Promise<void>;

export interface PreparedConversationMessage {
  idempotencyKey: string;
  requestHash: string;
  clientMessageId: string;
  content: string;
  conversationId: string | null;
  replyToInputRequestId: string | null;
}

function positiveId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
    ? value
    : null;
}

function canonicalRequest(body: Record<string, unknown>, content: string) {
  return JSON.stringify({
    client_message_id: body.client_message_id,
    content,
    conversation_id: positiveId(body.conversation_id),
    reply_to_input_request_id: positiveId(body.reply_to_input_request_id),
    referenced_asset_ids: Array.isArray(body.referenced_asset_ids)
      ? body.referenced_asset_ids
      : [],
    forced_creative_skill_id:
      typeof body.forced_creative_skill_id === "string"
        ? body.forced_creative_skill_id
        : null,
  });
}

/**
 * forced Creative Skill 共享缝（激活契约 §2/§4.1，资产契约 §4/§11.3）：
 * 守卫校验 → 接纳 → forced 单次激活埋点。conversation 与 generation-inbox
 * 两条接纳路径共用，保证 fail-closed 与埋点语义一致。
 */
export async function acceptWithForcedCreativeSkill<
  TResult extends ConversationCommandStoreResult,
>(input: {
  userId: string;
  body: Record<string, unknown>;
  guard?: ForcedCreativeSkillGuard | undefined;
  recorder?: SkillActivationRecorder | undefined;
  accept: () => Promise<TResult>;
}): Promise<TResult | { kind: "creative_skill_unavailable" }> {
  const forced = forcedCreativeSkillIdOf(input.body);
  if (forced !== null) {
    // fail-closed（资产契约 §8）：守卫未注入等同拒绝，避免新调用方漏注入而静默绕过域/owner 边界。
    const allowed =
      input.guard !== undefined && (await input.guard(input.userId, forced));
    if (!allowed) return { kind: "creative_skill_unavailable" };
  }
  const result = await input.accept();
  if (forced !== null && result.kind === "accepted" && input.recorder) {
    // 激活埋点（资产契约 §11.3）：只覆盖 live 缝实际可确定的路径——forced 激活。
    // Node 运行时 pin 版本解析尚未接通（parity 工单范围），skill_version 记默认 1；
    // live 缝当前没有 auto 命中概念，auto 来源待运行时接通后补充。
    // 埋点 best-effort：写失败不改变已接纳结果与既有错误语义。
    try {
      await input.recorder({
        creativeSkillId: forced,
        userId: input.userId,
        agentRunId: result.agent_run_id,
        skillVersion: 1,
        activationSource: "forced",
      });
    } catch {
      // 吞掉：埋点失败不影响既有校验与错误语义。
    }
  }
  return result;
}

export async function acceptConversationMessage(
  input: {
    userId: string;
    projectId: string;
    idempotencyKey: string | null;
    body: Record<string, unknown>;
  },
  store: ConversationCommandStore,
  forcedSkillGuard?: ForcedCreativeSkillGuard,
  activationRecorder?: SkillActivationRecorder,
): Promise<AcceptConversationMessageResult> {
  const prepared = prepareConversationMessage(input.body, input.idempotencyKey);
  if ("kind" in prepared) return prepared;
  return acceptWithForcedCreativeSkill({
    userId: input.userId,
    body: input.body,
    guard: forcedSkillGuard,
    recorder: activationRecorder,
    accept: () =>
      store.acceptMessage({
        userId: input.userId,
        projectId: input.projectId,
        ...prepared,
      }),
  });
}

function forcedCreativeSkillIdOf(body: Record<string, unknown>): string | null {
  const value = body.forced_creative_skill_id;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function prepareConversationMessage(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): PreparedConversationMessage | { kind: "invalid"; message: string } {
  if (!idempotencyKey?.trim()) {
    return { kind: "invalid", message: "缺少 Idempotency-Key" };
  }
  const rawContent = typeof body.content === "string" ? body.content : "";
  const content = rawContent.trim();
  if (!content || content.length > 4000) {
    return { kind: "invalid", message: "消息内容无效" };
  }
  const clientMessageId =
    typeof body.client_message_id === "string"
      ? body.client_message_id.trim()
      : "";
  if (!clientMessageId || clientMessageId.length > 64) {
    return { kind: "invalid", message: "client_message_id 无效" };
  }

  const requestHash = createHash("sha256")
    .update(canonicalRequest(body, content))
    .digest("hex");
  return {
    idempotencyKey,
    requestHash,
    clientMessageId,
    content,
    conversationId: positiveId(body.conversation_id),
    replyToInputRequestId: positiveId(body.reply_to_input_request_id),
  };
}
