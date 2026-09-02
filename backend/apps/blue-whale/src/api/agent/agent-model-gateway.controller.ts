import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import {
  All,
  Controller,
  Headers,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { ProjectService } from "@lib/shared/project/project.service.js";

/** NewAPI 上游（OpenAI 兼容 /v1）。空值时本控制器对每个请求返回 503。 */
const NEW_API_BASE_URL = process.env.NEW_API_BASE_URL?.trim() || "";
/** 非流式请求超时；流式（body.stream === true）不设超时，交给上游自然结束或客户端断开。 */
const UPSTREAM_TIMEOUT_MS = 60_000;
/** 本控制器挂载的路由前缀（含全局 /api）。NewAPI 只认裸 `/v1/...`，转发前必须去掉这段。 */
const ROUTE_PREFIX = "/api/internal/agent-model";

/** Agent 声明「这次调用属于哪个项目」。计费主体由本层查库解出，不接受 Agent 自报。 */
const PROJECT_HEADER = "x-blue-whale-project-id";
/** Agent 声明「这次调用属于哪次 run」。纯账本标签，不参与鉴权，原样透给 NewAPI 落账单行。 */
const RUN_HEADER = "x-blue-whale-run-id";
/** 本层注入给 NewAPI 的计费主体（NewAPI 用户号）。任何来自 Agent 的同名头一律丢弃。 */
const SUBJECT_HEADER = "x-bw-subject-user-id";
/** 转给 NewAPI 的 run 标签，落进账单行 other.agent_run_id，供按 run 查花费。 */
const UPSTREAM_RUN_HEADER = "x-bw-agent-run-id";

/**
 * 打 NewAPI 用的服务凭证前缀。NewAPI 的 relay 入口**按前缀分流**：带前缀的走网关代打分支，
 * 不带的落回 `TokenAuth` 去查 token 表。所以前缀不是装饰，配错了整条路静默失效。
 */
const BILLING_TOKEN_PREFIX = "bwsvc_";

/**
 * 启动时校验网关凭证，不留到第一个请求。
 *
 * 两种配错都表现为「Agent 不回话」，而且都不会在任何地方变红：
 *
 * - **没配**：每次调用 503，日志里只有一行请求级错误，混在正常流量里没人看。
 * - **配了但没有 `bwsvc_` 前缀**：更阴，因为看起来配好了。NewAPI 按前缀分流，不带前缀的
 *   凭证根本走不到网关分支，会掉进 `TokenAuth` 查不到 token 行，以一个普通 401 死掉。
 *
 * 前缀错直接拒绝启动：操作者明明打算启用它，静默不生效是最坏的结果。没配只记一行——
 * 不跑 Agent 的部署仍要能起来。这与 NewAPI 侧 `ValidateAgentBillingConfig` 是同一套判断，
 * 两端必须一起改。
 */
export function assertAgentModelGatewayConfig(): void {
  const token = process.env.NEW_API_AGENT_BILLING_TOKEN?.trim() ?? "";
  if (!token) {
    logger.warn(
      "[internal/agent-model] NEW_API_AGENT_BILLING_TOKEN 未配置：模型网关会对每个请求返回 503，Agent 无法调用模型",
    );
    return;
  }
  if (!token.startsWith(BILLING_TOKEN_PREFIX)) {
    throw new Error(
      `NEW_API_AGENT_BILLING_TOKEN 必须以 ${BILLING_TOKEN_PREFIX} 开头：NewAPI relay 按前缀分流，` +
        "不带前缀的凭证走不到网关分支，会以普通 401 静默失败",
    );
  }
  logger.info("[internal/agent-model] 模型网关计费凭证已配置");
}

/** 项目→主人 的解析结果缓存时长。项目归属几乎不变，短缓存足以挡住逐 token 的重复查库。 */
const OWNER_CACHE_TTL_MS = 60_000;
/** 查不到时也缓存，但只缓存很短一会儿：挡住坏 Agent 的重试风暴，又不至于让新建项目长时间不可用。 */
const OWNER_MISS_TTL_MS = 5_000;
/** 缓存条目上限，超出按插入序淘汰最旧的——网关是长驻进程，无界 Map 会一直长。 */
const OWNER_CACHE_MAX_ENTRIES = 2_000;

type OwnerCacheEntry = { ownerId: string | null; expiresAt: number };

/**
 * 项目 → 计费主体的短缓存。
 *
 * 挂在控制器实例上，不是模块级变量：模块级的那一版要导出一个「测试用」的 clear 函数，
 * 测试还得靠 `vi.resetModules()` 才拿得到干净的一份——一个只为测试存在的导出，本身就是
 * 状态放错了地方的信号。NestJS 控制器是单例，实例字段的生命周期与进程一致，语义不变。
 */
class OwnerCache {
  private readonly entries = new Map<string, OwnerCacheEntry>();

  get(projectId: string): OwnerCacheEntry | undefined {
    const hit = this.entries.get(projectId);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(projectId);
      return undefined;
    }
    return hit;
  }

  set(projectId: string, ownerId: string | null): void {
    // 先 delete 再 set：`Map.set` 对已存在的键**不刷新插入序**，而淘汰是按插入序取最旧的。
    // 不删就重设的话，一个每 60 秒被续期一次的热点项目会永远停在它第一次写入的位置上，
    // 到 2000 条时反倒是它被踢掉——缓存把最该留的那条淘汰了。
    this.entries.delete(projectId);
    if (this.entries.size >= OWNER_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(projectId, {
      ownerId,
      expiresAt: Date.now() + (ownerId === null ? OWNER_MISS_TTL_MS : OWNER_CACHE_TTL_MS),
    });
  }
}

function constantTimeEquals(expected: string | undefined, supplied: string | undefined): boolean {
  const want = expected?.trim();
  const got = supplied?.trim();
  if (!want || !got) return false;
  const wantBytes = Buffer.from(want);
  const gotBytes = Buffer.from(got);
  return wantBytes.length === gotBytes.length && timingSafeEqual(wantBytes, gotBytes);
}

function authorizedAgentService(header: string | undefined): boolean {
  return constantTimeEquals(process.env.AGENT_SERVICE_TOKEN, header);
}

function isStreamingRequest(rawBody: Buffer): boolean {
  if (rawBody.length === 0) return false;
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Record<string, unknown>).stream === true
    );
  } catch {
    return false;
  }
}

/**
 * `/api/internal/agent-model/*` —— 独立 blue-whale-agent 服务到 NewAPI 的计费网关代理。
 * agent 侧 `BLUE_WHALE_MODEL_GATEWAY_BASE_URL` 指向这里；OpenAI 兼容客户端在其后追加 `/v1/...`。
 *
 * **计费主体由本层解出，不由 Agent 声明**（IKCGDX / 券退役 ADR）。旧链路里 Agent 把
 * `subject_user_id` 写在铸券请求体里，全链无人复核，等于「记谁的账」由被计费方自己说了算。
 * 现在 Agent 只能声明它在为哪个项目干活，本层拿项目号查 `project.owner_id` 得出计费主体：
 * 项目单主人（库中无成员表，且 `agent-v1-proxy` 入口用 `findOwnedById` 严格限主人访问），
 * 所以项目主人就是这个项目下所有会话、所有 run 的唯一付款人。
 *
 * - `x-agent-service-token` 证明调用方是受信的 Agent 服务
 * - `x-blue-whale-project-id` 是归属锚；解不出主人则拒，不回落到任何默认账户
 * - 上游凭证换成蓝鲸自己那把服务凭证（`NEW_API_AGENT_BILLING_TOKEN`），Agent 请求里
 *   带的 `Authorization` 一律丢弃：Agent 不再持有任何模型凭证
 * - `x-blue-whale-run-id` 原样转成 `x-bw-agent-run-id`，只作账本刻度，不参与鉴权
 * - 非流式请求 60s 超时；流式（`stream: true`）不设超时，避免截断长生成
 */
@Public()
@BypassTransform()
@Controller("internal/agent-model")
export class AgentModelGatewayController {
  private readonly ownerCache = new OwnerCache();

  constructor(private readonly project: ProjectService) {}

  @All("*path")
  async proxy(
    @Req() req: Request,
    @Res() res: Response,
    @Headers("x-agent-service-token") agentServiceToken: string | undefined,
  ): Promise<void> {
    if (!authorizedAgentService(agentServiceToken)) {
      res.status(401).json({ code: 401, msg: "服务凭证无效", data: null });
      return;
    }
    if (!NEW_API_BASE_URL) {
      res.status(503).json({ code: 503, msg: "模型网关未配置 NEW_API_BASE_URL", data: null });
      return;
    }
    const billingToken = process.env.NEW_API_AGENT_BILLING_TOKEN?.trim();
    if (!billingToken) {
      res.status(503).json({
        code: 503,
        msg: "模型网关未配置 NEW_API_AGENT_BILLING_TOKEN",
        data: null,
      });
      return;
    }

    const projectId = readHeader(req, PROJECT_HEADER);
    if (!projectId) {
      res.status(400).json({
        code: 400,
        msg: "缺少计费归属上下文",
        data: { reason: "project_context_required" },
      });
      return;
    }

    let subjectUserId: string | null;
    try {
      subjectUserId = await this.resolveSubject(projectId);
    } catch (error) {
      logger.error(
        `[internal/agent-model] 归属解析失败 project=${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res.status(503).json({
        code: 503,
        msg: "归属服务暂不可用",
        data: { reason: "attribution_unavailable" },
      });
      return;
    }
    if (!subjectUserId) {
      // 不回落到任何默认账户：解不出付款人就没有人该为这次调用付钱。
      logger.warn(`[internal/agent-model] 项目无法解出计费主体 project=${projectId}`);
      res.status(403).json({
        code: 403,
        msg: "无法确定计费主体",
        data: { reason: "attribution_unresolved" },
      });
      return;
    }

    const upstreamPath = req.originalUrl.startsWith(ROUTE_PREFIX)
      ? req.originalUrl.slice(ROUTE_PREFIX.length)
      : req.originalUrl;
    const upstreamUrl = `${NEW_API_BASE_URL}${upstreamPath}`;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      const lower = key.toLowerCase();
      // authorization：Agent 不再持有模型凭证，它带什么都不转
      // SUBJECT_HEADER：计费主体只能由本层写，Agent 伪造的同名头必须在这里死掉
      if (
        lower === "x-agent-service-token" ||
        lower === "host" ||
        lower === "authorization" ||
        lower === SUBJECT_HEADER ||
        lower === UPSTREAM_RUN_HEADER
      ) {
        continue;
      }
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    headers.authorization = `Bearer ${billingToken}`;
    headers[SUBJECT_HEADER] = subjectUserId;
    const runId = readHeader(req, RUN_HEADER);
    if (runId) headers[UPSTREAM_RUN_HEADER] = runId;

    // 全局 json body-parser（main.ts 的 useBodyParser("json")）已消费请求体流，此刻在已结束的
    // 流上等 data/end 会永久挂起；直接复用解析后的 req.body 重建字节（与 BFF 代理同一修法）。
    const rawBody = Buffer.from(
      req.body === undefined || req.body === null ? "" : JSON.stringify(req.body),
    );

    const streaming = isStreamingRequest(rawBody);
    let upstream: globalThis.Response;
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: streaming ? null : AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      };
      if (!["GET", "HEAD"].includes(req.method)) init.body = rawBody;
      upstream = await fetch(upstreamUrl, init);
    } catch (error) {
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "NewAPI 响应超时"
          : "NewAPI 不可用";
      res.status(502).json({ code: 502, msg: message, data: null });
      return;
    }

    res.status(upstream.status);
    for (const [key, value] of upstream.headers) {
      if (key.toLowerCase() !== "content-length") res.set(key, value);
    }
    if (upstream.body) {
      const stream = Readable.fromWeb(
        upstream.body as import("node:stream/web").ReadableStream,
      );
      stream.on("error", (error) => {
        logger.error(
          `[internal/agent-model] upstream stream error: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!res.writableEnded) res.destroy();
      });
      stream.pipe(res);
    } else {
      res.end();
    }
  }

  /** 项目号 → 计费主体（NewAPI 用户号）。短缓存，未命中回库。 */
  private async resolveSubject(projectId: string): Promise<string | null> {
    const hit = this.ownerCache.get(projectId);
    if (hit) return hit.ownerId;
    const ownerId = await this.project.findOwnerId(projectId);
    this.ownerCache.set(projectId, ownerId);
    return ownerId;
  }
}

function readHeader(req: Request, name: string): string {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}
