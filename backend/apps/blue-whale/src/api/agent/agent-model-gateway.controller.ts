import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import {
  All,
  Controller,
  Headers,
  Req,
  Res,
} from "@nestjs/common";
import type { BeforeApplicationShutdown } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  TRACE_ID_HEADER,
  generateTraceId,
  getCurrentTraceId,
} from "@lib/core/logging";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import {
  NEW_API_BASE_URL_ENV,
  newApiBaseUrl,
  newApiFetch,
} from "@lib/shared/upstream/new-api-egress.js";

function newApiConfigured(): boolean {
  try {
    newApiBaseUrl();
    return true;
  } catch {
    return false;
  }
}
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { ProjectService } from "@lib/shared/project/project.service.js";

const UPSTREAM_IDLE_TIMEOUT_MS = Number(process.env.AGENT_MODEL_IDLE_TIMEOUT_MS) || 90_000;
const DRAIN_TIMEOUT_MS = Number(process.env.AGENT_MODEL_DRAIN_TIMEOUT_MS) || 8_000;
const DRAIN_POLL_MS = 200;
const ROUTE_PREFIX = "/api/internal/agent-model";

const inFlightStreams = new Set<{
  res: import("express").Response;
  runId: string;
  traceId: string;
  abort: () => void;
}>();

const SHUTDOWN_SIGNAL = "gateway_shutting_down";

const PROJECT_HEADER = "x-blue-whale-project-id";
const RUN_HEADER = "x-blue-whale-run-id";
const SUBJECT_HEADER = "x-bw-subject-user-id";
const UPSTREAM_RUN_HEADER = "x-bw-agent-run-id";

const BILLING_TOKEN_PREFIX = "bwsvc_";

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

const OWNER_CACHE_TTL_MS = 60_000;
const OWNER_MISS_TTL_MS = 5_000;
const OWNER_CACHE_MAX_ENTRIES = 2_000;

type OwnerCacheEntry = { ownerId: string | null; expiresAt: number };

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


@Public()
@BypassTransform()
@Controller("internal/agent-model")
export class AgentModelGatewayController implements BeforeApplicationShutdown {
  private readonly ownerCache = new OwnerCache();

  async beforeApplicationShutdown(): Promise<void> {
    await drainAgentModelStreams();
  }

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
    if (!newApiConfigured()) {
      res
        .status(503)
        .json({ code: 503, msg: `模型网关未配置 ${NEW_API_BASE_URL_ENV}`, data: null });
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


    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      const lower = key.toLowerCase();
      if (
        lower === "x-agent-service-token" ||
        lower === "host" ||
        lower === "authorization" ||
        lower === SUBJECT_HEADER ||
        lower === UPSTREAM_RUN_HEADER ||
        // 请求体下面按 req.body 重新序列化，长度跟原请求不一定一样：照抄原长度，上游会按旧长度收不满而报错
        lower === "content-length" ||
        lower === "transfer-encoding"
      ) {
        continue;
      }
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    headers.authorization = `Bearer ${billingToken}`;
    headers[SUBJECT_HEADER] = subjectUserId;
    const runId = readHeader(req, RUN_HEADER);
    if (runId) headers[UPSTREAM_RUN_HEADER] = runId;
    headers[TRACE_ID_HEADER] =
      getCurrentTraceId() ?? headers[TRACE_ID_HEADER] ?? generateTraceId();

    const rawBody = Buffer.from(
      req.body === undefined || req.body === null ? "" : JSON.stringify(req.body),
    );

    const idle = createIdleTimer(UPSTREAM_IDLE_TIMEOUT_MS);

    const inFlight = {
      res,
      runId: runId ?? "",
      traceId: headers[TRACE_ID_HEADER] ?? "",
      aborted: false,
      abort(): void {
        this.aborted = true;
        if (res.headersSent) {
          if (!res.writableEnded) {
            res.write(
              `data: ${JSON.stringify({
                error: {
                  message: "模型网关正在停机，本次调用被中断",
                  type: SHUTDOWN_SIGNAL,
                  code: SHUTDOWN_SIGNAL,
                },
              })}\n\n`,
            );
            res.end();
          }
          return;
        }
        res.status(503).json({
          code: 503,
          msg: "模型网关正在停机，本次调用被中断",
          data: { reason: SHUTDOWN_SIGNAL },
          error: {
            message: "模型网关正在停机，本次调用被中断",
            type: SHUTDOWN_SIGNAL,
            code: SHUTDOWN_SIGNAL,
          },
        });
        idle.abort();
      },
    };
    inFlightStreams.add(inFlight);
    const unregister = (): void => {
      inFlightStreams.delete(inFlight);
    };

    let upstream: globalThis.Response;
    try {
      const init: RequestInit = { method: req.method, headers, signal: idle.signal };
      if (!["GET", "HEAD"].includes(req.method)) init.body = rawBody;
      upstream = await newApiFetch(upstreamPath, init);
    } catch (error) {
      idle.clear();
      unregister();
      if (inFlight.aborted) return;
      const message = idle.expired
        ? `NewAPI ${idleSeconds()} 秒没有任何响应`
        : "NewAPI 不可用";
      logger.error(
        `[internal/agent-model] upstream request failed: ${message} (${error instanceof Error ? error.message : String(error)})`,
      );
      res.status(502).json({ code: 502, msg: message, data: null });
      return;
    }
    if (inFlight.aborted) {
      idle.clear();
      unregister();
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
      stream.on("data", () => idle.touch());
      stream.on("end", () => {
        idle.clear();
        unregister();
      });
      stream.on("close", () => {
        idle.clear();
        unregister();
      });
      res.on("close", unregister);
      stream.on("error", (error) => {
        idle.clear();
        unregister();
        logger.error(
          `[internal/agent-model] upstream stream error: ${idle.expired ? `空闲超过 ${idleSeconds()} 秒` : error instanceof Error ? error.message : String(error)}`,
        );
        if (!res.writableEnded) res.destroy();
      });
      stream.pipe(res);
    } else {
      idle.clear();
      unregister();
      res.end();
    }
  }

  private async resolveSubject(projectId: string): Promise<string | null> {
    const hit = this.ownerCache.get(projectId);
    if (hit) return hit.ownerId;
    const ownerId = await this.project.findOwnerId(projectId);
    this.ownerCache.set(projectId, ownerId);
    return ownerId;
  }
}

export async function drainAgentModelStreams(): Promise<void> {
  if (inFlightStreams.size === 0) return;

  const startedAt = Date.now();
  const atStart = inFlightStreams.size;
  logger.warn(
    `[internal/agent-model] 停机排空开始：在途 ${atStart} 条，最多等 ${DRAIN_TIMEOUT_MS}ms`,
    {
      event: "model_gateway.shutdown_drain_start",
      in_flight_streams: atStart,
      drain_timeout_ms: DRAIN_TIMEOUT_MS,
    },
  );
  while (inFlightStreams.size > 0 && Date.now() - startedAt < DRAIN_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, DRAIN_POLL_MS));
  }
  const elapsedMs = Date.now() - startedAt;

  if (inFlightStreams.size === 0) {
    logger.warn(`[internal/agent-model] 停机排空完成：${atStart} 条全部跑完，用时 ${elapsedMs}ms`, {
      event: "model_gateway.shutdown_drained",
      drained_streams: atStart,
      drain_elapsed_ms: elapsedMs,
    });
    return;
  }

  const runIds: string[] = [];
  for (const entry of inFlightStreams) {
    runIds.push(entry.runId || "-");
    try {
      entry.abort();
    } catch {
    }
  }
  inFlightStreams.clear();
  logger.warn(
    `[internal/agent-model] 停机排空超时，中断在途模型流 ${runIds.length} 条（原 ${atStart} 条，等了 ${elapsedMs}ms）: ${runIds.join(",")}`,
    {
      event: "model_gateway.shutdown_abort",
      aborted_streams: runIds.length,
      drained_streams: atStart - runIds.length,
      drain_elapsed_ms: elapsedMs,
      drain_timeout_ms: DRAIN_TIMEOUT_MS,
      run_ids: runIds.join(","),
      break_segment: "agent_to_gateway",
      break_reporter: "gateway",
    },
  );
}

function idleSeconds(): string {
  return String(Number((UPSTREAM_IDLE_TIMEOUT_MS / 1000).toFixed(1)));
}

function createIdleTimer(ms: number) {
  const controller = new AbortController();
  const state = { expired: false };
  let handle: NodeJS.Timeout | undefined = undefined;
  const arm = () => {
    handle = setTimeout(() => {
      state.expired = true;
      controller.abort();
    }, ms);
    handle.unref?.();
  };
  arm();
  return {
    signal: controller.signal,
    get expired() {
      return state.expired;
    },
    touch() {
      if (state.expired) return;
      if (handle) clearTimeout(handle);
      arm();
    },
    clear() {
      if (handle) clearTimeout(handle);
      handle = undefined;
    },
    abort() {
      if (handle) clearTimeout(handle);
      handle = undefined;
      controller.abort();
    },
  };
}

function readHeader(req: Request, name: string): string {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.trim() : "";
}
