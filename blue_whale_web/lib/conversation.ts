import { apiRequest } from "./api-client";
import type {
  PlanApplyImageReceipt,
  ProviderPromptAsset,
  VideoReferenceMode,
} from "@blue-whale/contracts";
import type {
  AcceptedConversationMention,
  ConversationMentionInput,
} from "@blue-whale/core";
import type { WireInteger } from "./wire-integer";

export type AcceptedConversationMessage = {
  message_id: WireInteger;
  agent_run_id: WireInteger;
  cursor: WireInteger;
  mentions: Array<
    Omit<AcceptedConversationMention, "mention_id"> & {
      mention_id: WireInteger;
    }
  >;
};

export function acceptConversationMessage(
  projectId: WireInteger,
  content: string,
  clientMessageId: string,
  idempotencyKey: string,
  replyToInputRequestId?: number | string,
  mentions?: ConversationMentionInput[],
  forcedCreativeSkillId?: string,
  skillSummarize?: boolean,
): Promise<AcceptedConversationMessage> {
  return apiRequest<AcceptedConversationMessage>(
    `/api/projects/${projectId}/conversation/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        client_message_id: clientMessageId,
        content,
        ...(replyToInputRequestId == null
          ? {}
          : { reply_to_input_request_id: replyToInputRequestId }),
        ...(mentions?.length ? { mentions } : {}),
        ...(forcedCreativeSkillId
          ? { forced_creative_skill_id: forcedCreativeSkillId }
          : {}),
        // 对话总结意图（IK60X1，契约 §15.1）：省略或 false 即普通消息
        ...(skillSummarize ? { skill_summarize: true } : {}),
      }),
    },
  );
}

export type AgentRunCommandReceipt = {
  agent_run_id: WireInteger;
  status: string;
  cursor: WireInteger;
};

/** 用户停止（IK67GZ，契约 §8.2）：独立产品命令，不经 RunCommit。 */
export function stopAgentRun(
  projectId: WireInteger,
  agentRunId: WireInteger,
  idempotencyKey: string,
): Promise<AgentRunCommandReceipt> {
  return apiRequest<AgentRunCommandReceipt>(
    `/api/projects/${projectId}/conversation/agent-runs/${agentRunId}/stop`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
    },
  );
}

/** 手动重试（IK67GZ，契约 §8.3）：仅 failed 可重试，不重复接纳用户消息。 */
export function retryAgentRun(
  projectId: WireInteger,
  agentRunId: WireInteger,
  idempotencyKey: string,
): Promise<AgentRunCommandReceipt & { retry_count: number }> {
  return apiRequest<AgentRunCommandReceipt & { retry_count: number }>(
    `/api/projects/${projectId}/conversation/agent-runs/${agentRunId}/retry`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
    },
  );
}

export type PlanMessageApplyResult = {
  receipt: PlanApplyImageReceipt;
  first_generation_job_id: WireInteger | null;
};

/** 手动应用计划（IK6KQB，契约 §9）：冻结 PlanMessage → 应用出图。
 *  业务失败走 HTTP 200 + 业务码信封，apiRequest 抛 ApiError：
 *  100405=余额不足（retryable_blocked），100403/100202/100407=需新计划（requires_new_plan）。 */
export function applyPlanMessage(
  projectId: WireInteger,
  planMessageId: WireInteger,
  idempotencyKey: string,
): Promise<PlanMessageApplyResult> {
  return apiRequest<PlanMessageApplyResult>(
    `/api/projects/${projectId}/plan-messages/${planMessageId}/apply`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
    },
  );
}

/** SceneCard 生成预设只读视图（IK67HB/T13，编辑器打开时按需 GET）。 */
export type SceneCardGenerationPreset = {
  scene_card: {
    scene_card_id: WireInteger;
    version: number;
    title: string;
    content_markdown: string;
  };
  preset: {
    version: number;
    parameters: Record<string, unknown>;
    reference_mode: VideoReferenceMode;
    reference_assets: ProviderPromptAsset[];
    capability_snapshot_version: Record<string, unknown>;
  };
  projection: { prompt_text: string } | null;
};

export function getSceneCardGenerationPreset(
  projectId: WireInteger,
  sceneCardId: WireInteger,
): Promise<SceneCardGenerationPreset> {
  return apiRequest<SceneCardGenerationPreset>(
    `/api/projects/${projectId}/scene-cards/${sceneCardId}/generation-preset`,
  );
}

export type SceneCardRegenerationResult = {
  scene_card_id: WireInteger;
  generation_job_id: WireInteger;
  record_id?: WireInteger;
  preset_version?: number;
};

/** SceneCard 再生成（IK67HB/T13）：编辑器点"生成"提交新参数快照 → 原子更新 Preset + 新 Record + 新 Job。
 *  body 形态由编辑器按 sceneCardRegenerationRequestSchema 构造；版本冲突由后端 CAS 检测并抛 ApiError(100406)。 */
export function generateSceneCard(
  projectId: WireInteger,
  sceneCardId: WireInteger,
  idempotencyKey: string,
  body: Record<string, unknown>,
): Promise<SceneCardRegenerationResult> {
  return apiRequest<SceneCardRegenerationResult>(
    `/api/projects/${projectId}/scene-cards/${sceneCardId}/generate`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    },
  );
}

export type StoryboardPreviewResult = {
  preview_id: WireInteger;
  scene_card_id: WireInteger;
  generation_job_id: WireInteger;
};

export type StoryboardPreviewSummary = {
  preview_id: WireInteger;
  scene_card_id: WireInteger;
  first_generation_job_id: WireInteger;
  summary_status: string;
};

/** StoryboardPreview 创建（IK67HF/T15，CONTEXT L43-47）：从 SceneCard 显式触发分镜预览，
 *  建 type=image 的 GenerationJob，其 N 个 output_slot 即有序画格。
 *  body 形态由编辑器按 storyboardPreviewCreateRequestSchema 构造；Authorization 头携带 sk-token。 */
export function createStoryboardPreview(
  projectId: WireInteger,
  sceneCardId: WireInteger,
  idempotencyKey: string,
  body: Record<string, unknown>,
  providerToken?: string,
): Promise<StoryboardPreviewResult> {
  const headers: Record<string, string> = { "Idempotency-Key": idempotencyKey };
  if (providerToken) headers.authorization = `Bearer ${providerToken}`;
  return apiRequest<StoryboardPreviewResult>(
    `/api/projects/${projectId}/scene-cards/${sceneCardId}/storyboard-preview`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
}

/** 只读端点：返回某 SceneCard 下所有未删除分镜预览（画格经 first_generation_job_id 关联 job 取）。 */
export function getStoryboardPreviews(
  projectId: WireInteger,
  sceneCardId: WireInteger,
): Promise<{ previews: StoryboardPreviewSummary[] }> {
  return apiRequest<{ previews: StoryboardPreviewSummary[] }>(
    `/api/projects/${projectId}/scene-cards/${sceneCardId}/storyboard-preview`,
  );
}
