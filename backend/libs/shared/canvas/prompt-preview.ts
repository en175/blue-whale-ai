import { BadRequestException, BadGatewayException, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PROMPT_TEXT_LIMITS as limits, previewSourceSchema, validPromptMentions, type PromptPreviewSource, type PromptPreviewContent } from "@lib/contracts";
import { agentServiceBaseUrl, agentServiceToken, agentTenantId } from "../../../apps/blue-whale/src/api/agent/agent-service-env.js";

export function sourceKey(source: unknown): string | null {
  const parsed = previewSourceSchema.safeParse(source);
  return parsed.success ? JSON.stringify([parsed.data.sessionId, parsed.data.revisionId, parsed.data.shotNo]) : null;
}

/** Agent 按需历史修订读取路由（IKDLQL 契约）：修订不存在返回 null；网关故障与快照读取同口径抛 502。 */
async function fetchHistoricalRevision(ownerId: string, projectId: string, source: PromptPreviewSource): Promise<unknown> {
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
    return revision?.payload ?? null;
  } catch (error) {
    if (error instanceof BadGatewayException) throw error;
    throw new BadGatewayException("暂时无法读取预览，请重试");
  }
}

/** Read only committed Agent output, using the same trusted context as the existing BFF. */
export async function readPromptPreview(ownerId: string, projectId: string, source: PromptPreviewSource): Promise<PromptPreviewContent> {
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
    const payload = record ? record.active_revision?.payload : await fetchHistoricalRevision(ownerId, projectId, source);
    if (!payload) throw new NotFoundException("该历史预览已不可读取，请在对话中重新生成");
    const batch = z.object({
      target_media: z.enum(["image", "video"]).optional(),
      assets: z.array(z.object({ asset_ref_id: z.string(), asset_id: z.string().regex(/^[1-9][0-9]*$/), media_type: z.enum(["image", "video", "audio"]) })).default([]),
      shots: z.array(z.object({ shot_no: z.number() }).passthrough()),
    }).safeParse(payload);
    if (!batch.success) throw new BadRequestException("预览素材契约无效，请重新生成方案");
    const shot = batch.data.shots.find(item => item.shot_no === source.shotNo);
    if (!shot) throw new NotFoundException("该历史预览已不可读取，请在对话中重新生成");
    const time = z.string().regex(/^(?:\d{2}:)?[0-5]\d:[0-5]\d$/);
    const content = z.object({
      title: z.string().min(1).max(limits.title), prompt_text: z.string().min(1).max(limits.text),
      asset_bindings: z.array(z.object({ asset_ref_id: z.string() })).default([]),
      prompt_mentions: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(), index: z.number().int().positive(), asset_ref_id: z.string() })).default([]),
      time_range: z.object({ start: time, end: time }).optional(),
    }).safeParse(shot);
    if (!content.success) throw new BadRequestException(`预览正文缺失或超限（标题 ${limits.title}，正文 ${limits.text} 字），原文未改动`);
    const value = content.data;
    const materials = new Map<string, { assetId: string; mediaType: "image" | "video" | "audio" }>();
    for (const binding of value.asset_bindings) {
      const assets = batch.data.assets.filter(asset => asset.asset_ref_id === binding.asset_ref_id);
      if (assets.length !== 1) throw new BadRequestException(`素材索引 ${binding.asset_ref_id} 身份缺失或重复，请重新生成方案`);
      const asset = assets[0]!;
      materials.set(binding.asset_ref_id, { assetId: asset.asset_id, mediaType: asset.media_type });
      if (!value.prompt_mentions.some(mention => mention.asset_ref_id === binding.asset_ref_id)) {
        throw new BadRequestException(`素材索引 ${binding.asset_ref_id} 缺少正文标签绑定，请重新生成方案`);
      }
    }
    const mentions = value.prompt_mentions.map(mention => {
      const material = materials.get(mention.asset_ref_id);
      if (!material) throw new BadRequestException(`素材索引 #${mention.index} 未声明绑定`);
      return { start: mention.start, end: mention.end, index: mention.index, assetId: material.assetId };
    });
    if (!validPromptMentions(value.prompt_text, mentions)) throw new BadRequestException("正文素材索引区间无效，请重新生成方案");
    const target = batch.data.target_media;
    const range = value.time_range;
    const seconds = (input: string) => input.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
    if (range && seconds(range.end) <= seconds(range.start)) throw new BadRequestException("方案起止时间无效，请重新生成方案");
    return {
      title: target === "image" ? "IMAGE" : target === "video" ? `VIDEO #${source.shotNo}${range ? ` ${range.start}–${range.end}` : ""}` : value.title,
      text: value.prompt_text,
      ...(target || materials.size ? { promptOriginalTitle: value.title, promptMentions: mentions,
        promptMaterials: [...new Map([...materials.values()].map(material => [material.assetId, material])).values()] } : {}),
    };
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof BadGatewayException) throw error;
    throw new BadGatewayException("暂时无法读取预览，请重试");
  }
}
