import { Readable } from "node:stream";
import {
  All,
  Controller,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  TRACE_ID_HEADER,
  generateTraceId,
  getCurrentTraceId,
} from "@blue-whale/core/logging";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { agentServiceBaseUrl, agentServiceToken, agentTenantId } from "./agent-service-env.js";

/**
 * 建连超时：只约束「拿到上游响应头」这一段。
 *
 * 一次性请求可以有总时长上限，长连接不能——SSE 事件流的存活时间等于会话时长，
 * 没有任何合理的总时长可设。IKA2V3 之前用 `AbortSignal.timeout` 给整个 fetch
 * （含响应体流）设了 60s，事件流因此每次活满 60s 就被 BFF 自己掐断，导致
 * Agent 回答必须刷新第二次才出现。两种超时是不同概念，必须分开。
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;
/** 一次性请求的响应体超时。事件流不适用。 */
const DEFAULT_BODY_TIMEOUT_MS = 60_000;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function connectTimeoutMs(): number {
  return positiveInt(process.env.AGENT_UPSTREAM_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS);
}
function bodyTimeoutMs(): number {
  return positiveInt(process.env.AGENT_UPSTREAM_BODY_TIMEOUT_MS, DEFAULT_BODY_TIMEOUT_MS);
}

function timeoutError(message: string): DOMException {
  return new DOMException(message, "TimeoutError");
}

/**
 * /api/agent/v1/projects/:projectId/* —— 到独立 blue-whale-agent 服务的 BFF 透传代理（IK9DZO / S4）。
 * 前端调用路径带项目层（平台 projects/:id 约定），agent 服务路由为 /v1/projects/:projectId/...。
 * 本层负责三件事：
 *  - 鉴权：走全局 AuthGuard（用户必须已登录），并校验项目归属（只允许访问自己拥有的项目）；
 *  - 头注入：丢弃浏览器用户凭证，改为 agent 服务凭证 + 可信上下文头（tenant/user/project）；
 *  - 路径翻译：剥掉本 BFF 的 /api/agent 命名空间，把 /v1/projects/:projectId/... 原样转发。
 * - 方法/路径/query/body/headers 全透传
 * - 服务未启动/连不上/建连超时 → 502，附上游地址或超时提示便于定位
 * - SSE（/events）流式 pipe：不设总时长上限、不缓冲、断流干净收尾（IKA2V3）
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

    const base = agentServiceBaseUrl();
    // 剥掉 /api/agent 命名空间：/api/agent/v1/projects/1/... → /v1/projects/1/...，与 agent 路由对齐
    const upstreamUrl = `${base}${req.originalUrl.replace(/^\/api\/agent/, "")}`;

    // req.headers 已含 authorization（Node 请求头 key 统一小写），透传循环即可，无需单独取出再设置一次
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value || key === "authorization") continue; // 丢弃浏览器用户凭证，避免泄漏给 agent
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    headers.authorization = `Bearer ${agentServiceToken()}`;
    headers["x-blue-whale-tenant-id"] = agentTenantId();
    headers["x-blue-whale-user-id"] = user.userId;
    headers["x-blue-whale-project-id"] = projectId;
    // 出站补 X-Trace-Id（IKB29O）。上面的透传循环搬的是**浏览器发来的**头，而浏览器不发这个头；
    // traceMiddleware 生成的那个 id 只活在 ALS 里，从没写回出站。于是 agent 收不到、自己另起一个，
    // 一次对话在两个服务的日志里是两个对不上的 trace_id。
    // 三级取值而不是直接覆盖：ALS 有就用（traceMiddleware 透传优先，正常情况下它和客户端发来的
    // 就是同一个值），没有就保留循环透传下来的那个，都没有才生成。无条件覆盖会在 traceMiddleware
    // 万一没挂到某条路由时把客户端带来的 id 丢掉——那正是本单要消除的那类断链。
    headers[TRACE_ID_HEADER] =
      getCurrentTraceId() ?? headers[TRACE_ID_HEADER] ?? generateTraceId();

    // 全局 json body-parser（main.ts 的 useBodyParser("json")）已消费请求体流，此刻在已结束的
    // 流上等 data/end 会永久挂起；直接复用解析后的 req.body（agent 端全部为 JSON 契约）。
    const rawBody =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Buffer.from(req.body === undefined || req.body === null ? "" : JSON.stringify(req.body));

    const abort = new AbortController();
    // 浏览器提前断开（关标签页、切会话）时释放上游连接，否则 agent 侧的事件订阅会一直挂着。
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    let deadline: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort.abort(timeoutError("upstream connect timeout")),
      connectTimeoutMs(),
    );

    let upstream: globalThis.Response;
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: abort.signal,
      };
      if (!["GET", "HEAD"].includes(req.method) && rawBody !== undefined) {
        init.body = rawBody;
      }
      upstream = await fetch(upstreamUrl, init);
    } catch (error) {
      clearTimeout(deadline);
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "上游 agent 服务响应超时"
          : `上游 agent 服务不可用（${base}）`;
      if (!res.headersSent) {
        res.status(502).json({ code: 502, msg: message, data: null });
      }
      return;
    }
    // 响应头已到，建连阶段结束。
    clearTimeout(deadline);
    deadline = undefined;

    const isEventStream = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    if (!isEventStream) {
      // 一次性请求仍需要响应体上限，避免上游半死不活时占着连接。
      deadline = setTimeout(() => abort.abort(timeoutError("upstream body timeout")), bodyTimeoutMs());
    }

    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      const name = key.toLowerCase();
      // content-length 交给 res 自己算；content-encoding 不能透传——undici 已经解压过响应体，
      // 再声明编码会让浏览器按压缩数据解析。
      if (name !== "content-length" && name !== "content-encoding") {
        res.set(key, value);
      }
    }

    if (isEventStream) {
      // 事件流必须逐事件抵达：禁用中间层缓冲（nginx 认 x-accel-buffering）、禁用 Nagle 合包，
      // 并立即把响应头刷出去，让浏览器尽早进入读取状态。
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("x-accel-buffering", "no");
      res.socket?.setNoDelay(true);
      res.flushHeaders();
    }

    if (!upstream.body) {
      clearTimeout(deadline);
      res.end();
      return;
    }

    const stream = Readable.fromWeb(
      upstream.body as import("node:stream/web").ReadableStream,
    );
    stream.on("error", (error) => {
      clearTimeout(deadline);
      logger.error(
        `[agent/v1] upstream stream error: ${error instanceof Error ? error.message : String(error)}`,
      );
      // 干净收尾而不是 destroy()：客户端要观察到 EOF 才会触发自身的带游标重连。
      // destroy() 会留下半开连接，浏览器侧 reader 既不 resolve 也不 reject，永久卡死。
      if (!res.writableEnded) res.end();
    });
    stream.on("end", () => clearTimeout(deadline));
    stream.pipe(res);
  }
}
