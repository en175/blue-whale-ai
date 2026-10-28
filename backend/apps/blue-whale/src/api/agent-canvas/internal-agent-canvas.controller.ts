import { Body, Controller, Headers, Post } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import {
  authorizedAgentService,
  trustedAgentContext,
  type TrustedAgentContext,
} from "@lib/shared/agent/internal-auth.js";
import {
  AGENT_CANVAS_DETAIL_IDS_MAX,
  AgentCanvasRequestError,
  parseAgentCanvasCursor,
  parseAgentCanvasLimit,
  readAgentCanvasNodeDetails,
  searchAgentCanvasNodes,
  type AgentCanvasNodeFilters,
} from "@lib/shared/canvas/agent-canvas-nodes.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new NewApiError(`${field} 无效`, 400, "invalid_request");
  }
  return value;
}

function optionalTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new NewApiError("tags 无效", 400, "invalid_request");
  }
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 32) {
      throw new NewApiError("tags 无效", 400, "invalid_request");
    }
    if (!tags.includes(item)) tags.push(item);
  }
  return tags;
}

@Public()
@BypassTransform()
@Controller("internal/agent-canvas")
export class InternalAgentCanvasController {
  constructor(
    private readonly project: ProjectService,
    private readonly prisma: PrismaService,
  ) {}

  private async context(
    authorization: string | undefined,
    tenantId: string | undefined,
    userHeader: string | undefined,
    projectHeader: string | undefined,
    sessionHeader: string | undefined,
  ): Promise<TrustedAgentContext> {
    if (!authorizedAgentService(authorization)) {
      throw new NewApiError("服务凭证无效", 401, "unauthorized");
    }
    const context = trustedAgentContext({
      tenantId,
      userId: userHeader,
      projectId: projectHeader,
      sessionId: sessionHeader,
    });
    if (!context) throw new NewApiError("缺少可信 Agent 上下文", 400, "invalid_context");
    if (!await this.project.findOwnedById(context.projectId, context.userId)) {
      throw new NewApiError("项目不可访问", 403, "project_forbidden");
    }
    return context;
  }

  private async withFilters<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AgentCanvasRequestError) {
        throw new NewApiError(
          error.reason === "filter_required" ? "至少需要一个筛选条件" : "请求参数无效",
          400,
          error.reason,
        );
      }
      throw error;
    }
  }

  @Post("nodes/search")
  async search(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-blue-whale-tenant-id") tenantId: string | undefined,
    @Headers("x-blue-whale-user-id") userHeader: string | undefined,
    @Headers("x-blue-whale-project-id") projectHeader: string | undefined,
    @Headers("x-blue-whale-session-id") sessionHeader: string | undefined,
    @Body() body: unknown,
  ) {
    const context = await this.context(authorization, tenantId, userHeader, projectHeader, sessionHeader);
    const payload = body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
    const name = optionalString(payload.name, "name", 200);
    const tags = optionalTags(payload.tags);
    const type = optionalString(payload.type, "type", 32);
    const nodeId = optionalString(payload.node_id, "node_id", 128);
    const parentNodeId = optionalString(payload.parent_node_id, "parent_node_id", 128);
    const filters: AgentCanvasNodeFilters = {
      ...(name !== undefined ? { name } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(parentNodeId !== undefined ? { parentNodeId } : {}),
    };
    return this.withFilters(() =>
      searchAgentCanvasNodes(
        this.prisma.client,
        context.projectId,
        filters,
        parseAgentCanvasCursor(payload.cursor),
        parseAgentCanvasLimit(payload.limit),
      ),
    );
  }

  @Post("nodes/details")
  async details(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-blue-whale-tenant-id") tenantId: string | undefined,
    @Headers("x-blue-whale-user-id") userHeader: string | undefined,
    @Headers("x-blue-whale-project-id") projectHeader: string | undefined,
    @Headers("x-blue-whale-session-id") sessionHeader: string | undefined,
    @Body() body: unknown,
  ) {
    const context = await this.context(authorization, tenantId, userHeader, projectHeader, sessionHeader);
    const raw = body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).node_ids
      : undefined;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > AGENT_CANVAS_DETAIL_IDS_MAX) {
      throw new NewApiError("node_ids 无效", 400, "invalid_request");
    }
    const nodeIds: string[] = [];
    for (const id of raw) {
      if (typeof id !== "string" || id.length === 0 || id.length > 128) {
        throw new NewApiError("node_ids 无效", 400, "invalid_request");
      }
      if (!nodeIds.includes(id)) nodeIds.push(id);
    }
    return readAgentCanvasNodeDetails(this.prisma.client, context.projectId, nodeIds);
  }
}
