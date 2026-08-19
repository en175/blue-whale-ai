import { Readable } from "node:stream";
import {
  All,
  Controller,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** 上游 agent 服务地址（独立 blue-whale-agent 服务）。缺省 localhost:4111。 */
const AGENT_SERVICE_BASE_URL = process.env.AGENT_SERVICE_BASE_URL?.trim() || "http://localhost:4111";
/** agent 服务凭证（agent trustedContext 校验 `Bearer ${AGENT_SERVICE_TOKEN}`），与 agent 侧 .env 保持一致。 */
const AGENT_SERVICE_TOKEN = process.env.AGENT_SERVICE_TOKEN?.trim() || "";
/** 蓝鲸为单租户产品：tenant 是固定标签；agent 侧按 (tenant, principal) 隔离。 */
const AGENT_TENANT_ID = process.env.AGENT_TENANT_ID?.trim() || "default";
const AGENT_UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * /api/agent/v1/projects/:projectId/* —— 到独立 blue-whale-agent 服务的 BFF 透传代理（IK9DZO / S4）。
 * 前端调用路径带项目层（平台 projects/:id 约定），agent 服务路由为 /v1/projects/:projectId/...。
 * 本层负责三件事：
 *  - 鉴权：走全局 AuthGuard（用户必须已登录），并校验项目归属（只允许访问自己拥有的项目）；
 *  - 头注入：丢弃浏览器用户凭证，改为 agent 服务凭证 + 可信上下文头（tenant/user/project）；
 *  - 路径翻译：剥掉本 BFF 的 /api/agent 命名空间，把 /v1/projects/:projectId/... 原样转发。
 * - 方法/路径/query/body/headers 全透传
 * - 服务未启动/连不上/超时 → 502，附上游地址或超时提示便于定位
 * - SSE（/events）流式 pipe，不截断
 */
@Controller("agent/v1")
export class AgentV1ProxyController {
  constructor(private readonly project: ProjectService) {}

  @All("*path")
  async proxy(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const route = req.originalUrl.match(/^\/api\/agent\/v1\/projects\/([^/]+)(\/.*)?$/);
    if (!route) {
      res.status(404).json({ code: 404, msg: "Agent route not found", data: null });
      return;
    }
    const projectId = decodeURIComponent(route[1]!);

    const owned = await this.project.findOwnedById(projectId, user.userId);
    if (!owned) {
      res.status(403).json({ code: 403, msg: "Project not accessible", data: null });
      return;
    }

    const base = AGENT_SERVICE_BASE_URL;
    // 剥掉 /api/agent 命名空间：/api/agent/v1/projects/1/... → /v1/projects/1/...，与 agent 路由对齐
    const upstreamUrl = `${base}${req.originalUrl.replace(/^\/api\/agent/, "")}`;

    // req.headers 已含 authorization（Node 请求头 key 统一小写），透传循环即可，无需单独取出再设置一次
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value || key === "authorization") continue; // 丢弃浏览器用户凭证，避免泄漏给 agent
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    headers.authorization = `Bearer ${AGENT_SERVICE_TOKEN}`;
    headers["x-blue-whale-tenant-id"] = AGENT_TENANT_ID;
    headers["x-blue-whale-user-id"] = user.userId;
    headers["x-blue-whale-project-id"] = projectId;

    // 全局 json body-parser（main.ts 的 useBodyParser("json")）已消费请求体流，此刻在已结束的
    // 流上等 data/end 会永久挂起；直接复用解析后的 req.body（agent 端全部为 JSON 契约）。
    const rawBody =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Buffer.from(req.body === undefined || req.body === null ? "" : JSON.stringify(req.body));

    let upstream: globalThis.Response;
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: AbortSignal.timeout(AGENT_UPSTREAM_TIMEOUT_MS),
      };
      if (!["GET", "HEAD"].includes(req.method) && rawBody !== undefined) {
        init.body = rawBody;
      }
      upstream = await fetch(upstreamUrl, init);
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "上游 agent 服务响应超时"
          : `上游 agent 服务不可用（${base}）`;
      res.status(502).json({
        code: 502,
        msg: message,
        data: null,
      });
      return;
    }

    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      // 透传 content-type；其余头（含 content-length）交给 res 透传
      if (key.toLowerCase() !== "content-length") {
        res.set(key, value);
      }
    }
    if (upstream.body) {
      const stream = Readable.fromWeb(
        upstream.body as import("node:stream/web").ReadableStream,
      );
      stream.on("error", (error) => {
        console.error(
          "[agent/v1] upstream stream error:",
          error instanceof Error ? error.message : error,
        );
        if (!res.writableEnded) res.destroy();
      });
      stream.pipe(res);
    } else {
      res.end();
    }
  }
}
