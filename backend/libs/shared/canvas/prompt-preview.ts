import { BadRequestException, BadGatewayException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PROMPT_TEXT_LIMITS as limits, previewSourceSchema, type PromptPreviewSource } from "@blue-whale/contracts";
import { agentServiceBaseUrl, agentServiceToken, agentTenantId } from "../../../apps/blue-whale/src/api/agent/agent-service-env.js";

export function sourceKey(source: unknown): string | null {
  const parsed = previewSourceSchema.safeParse(source);
  return parsed.success ? JSON.stringify([parsed.data.sessionId, parsed.data.revisionId, parsed.data.shotNo]) : null;
}

/** Read only committed Agent output, using the same trusted context as the existing BFF. */
export async function readPromptPreview(ownerId: string, projectId: string, source: PromptPreviewSource) {
  let response: Response;
  try {
    response = await fetch(`${agentServiceBaseUrl()}/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(source.sessionId)}/snapshot`, {
      headers: {
        authorization: `Bearer ${agentServiceToken()}`,
        "x-blue-whale-tenant-id": agentTenantId(),
        "x-blue-whale-user-id": ownerId,
        "x-blue-whale-project-id": projectId,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) throw new NotFoundException("预览来源已不存在，请在对话中重新生成");
    if (!response.ok) throw new BadGatewayException("暂时无法读取预览，请重试");
    const snapshot = await response.json() as { prompt_cards?: Array<{
      session_id?: string;
      active_revision?: { revision_id?: string; payload?: { shots?: Array<{ shot_no: number; title: string; prompt_text: string }> } };
    }> };
    const record = snapshot.prompt_cards?.find(card => card.session_id === source.sessionId && card.active_revision?.revision_id === source.revisionId);
    const shot = record?.active_revision?.payload?.shots?.find(item => item.shot_no === source.shotNo);
    if (!shot) throw new NotFoundException("该历史预览已不可读取，请在对话中重新生成");
    const content = z.object({ title: z.string().min(1).max(limits.title), prompt_text: z.string().min(1).max(limits.text) }).safeParse(shot);
    if (!content.success) throw new BadRequestException(`预览正文缺失或超限（标题 ${limits.title}，正文 ${limits.text} 字），原文未改动`);
    return { title: content.data.title, text: content.data.prompt_text };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof BadGatewayException) throw error;
    throw new BadGatewayException("暂时无法读取预览，请重试");
  }
}
