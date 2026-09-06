import { BadRequestException, BadGatewayException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PROMPT_TEXT_LIMITS as limits, previewSourceSchema, type PromptPreviewSource } from "@blue-whale/contracts";
import { agentServiceBaseUrl, agentServiceToken, agentTenantId } from "../../../apps/blue-whale/src/api/agent/agent-service-env.js";

export function sourceKey(source: unknown): string | null {
  const parsed = previewSourceSchema.safeParse(source);
  return parsed.success ? JSON.stringify([parsed.data.sessionId, parsed.data.revisionId, parsed.data.shotNo]) : null;
}

/** Agent 按需历史修订读取路由（IKDLQL 契约）：修订不存在返回 null；网关故障与快照读取同口径抛 502。 */
async function fetchHistoricalShot(ownerId: string, projectId: string, source: PromptPreviewSource): Promise<{ shot_no: number; title: string; prompt_text: string } | null> {
  let response: Response;
  try {
    const url = `${agentServiceBaseUrl()}/v1/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(source.sessionId)}/prompt-card-revisions?revision_ids=${encodeURIComponent(source.revisionId)}`;
    response = await fetch(url, {
      headers: {
        authorization: `Bearer ${agentServiceToken()}`,
        "x-blue-whale-tenant-id": agentTenantId(),
        "x-blue-whale-user-id": ownerId,
        "x-blue-whale-project-id": projectId,
      },
      signal: AbortSignal.timeout(15_000),
    });
    // Agent 尚未发布该路由（404/405）＝修订不可读取，与「查不到的 id 省略」同为 null
    if (response.status === 404 || response.status === 405) return null;
    if (!response.ok) throw new BadGatewayException("暂时无法读取预览，请重试");
    const body = await response.json() as { revisions?: Array<{ revision_id?: string; payload?: { shots?: Array<{ shot_no: number; title: string; prompt_text: string }> } }> };
    const revision = body.revisions?.find(item => item.revision_id === source.revisionId);
    const shot = revision?.payload?.shots?.find(item => item.shot_no === source.shotNo);
    return shot ?? null;
  } catch (error) {
    if (error instanceof BadGatewayException) throw error;
    throw new BadGatewayException("暂时无法读取预览，请重试");
  }
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
    let shot: { shot_no: number; title: string; prompt_text: string } | undefined | null;
    if (record) {
      shot = record.active_revision?.payload?.shots?.find(item => item.shot_no === source.shotNo);
    } else {
      // 历史修订兼容映射（IKDLQL）：会话存在但 active 已不是该修订时按需读旧修订，正文仍只认 prompt_text
      shot = await fetchHistoricalShot(ownerId, projectId, source);
    }
    if (!shot) throw new NotFoundException("该历史预览已不可读取，请在对话中重新生成");
    const content = z.object({ title: z.string().min(1).max(limits.title), prompt_text: z.string().min(1).max(limits.text) }).safeParse(shot);
    if (!content.success) throw new BadRequestException(`预览正文缺失或超限（标题 ${limits.title}，正文 ${limits.text} 字），原文未改动`);
    return { title: content.data.title, text: content.data.prompt_text };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof BadGatewayException) throw error;
    throw new BadGatewayException("暂时无法读取预览，请重试");
  }
}
