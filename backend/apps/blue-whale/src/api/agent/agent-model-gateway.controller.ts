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

/** 上游地址配了没有（不抛，供 503 分支判断）。 */
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

/**
 * NewAPI 上游（OpenAI 兼容 /v1）**不在模块顶层读**。
 *
 * <p>原来这里是一句 `const NEW_API_BASE_URL = process.env.NEW_API_BASE_URL?.trim() || ""`，
 * 两个问题：模块加载时读一次（此后改环境变量不生效、测试也没法注入），
 * 以及在 new-api 的六处出站里又添了一份自己的地址解析。
 * 现在统一走 `@lib/shared/upstream/new-api-egress`，每个请求现取。
 */
/**
 * 上游**空闲**超时：多久没有新字节才算死，不是总共跑了多久（IKD7AS）。
 *
 * 此前这里是二选一的：非流式 `AbortSignal.timeout(60_000)` 按**总时长**砍，流式传 `null`
 * 完全不砍。两头都错。
 *
 * 总时长会误杀正常但慢的调用：Agent 产卡前的需求抽取实测跑到 155 秒 / 18,296 token，每次都
 * 在精确 60.018s 被砍成 `Bad Gateway`，算力全烧了什么都没拿到（IKD7A9）。而流式那一路一旦
 * 上游卡住就可以永远挂着——把抽取改成流式之后，那正是唯一还没有闸的地方。
 *
 * 按空闲计两头都对：流式下 token 持续到达（实测首字节 1.3–1.4 秒），再慢的正常调用也不会
 * 静默这么久；真挂住了照样断得掉。
 *
 * 90 秒的来历：观测到的最长合理静默是首字节，上游过载时可达几十秒；90 远在其上，又仍然
 * 有界。**不要沿用 60**——那是上一版按总时长设的数，含义完全不同。
 */
const UPSTREAM_IDLE_TIMEOUT_MS = Number(process.env.AGENT_MODEL_IDLE_TIMEOUT_MS) || 90_000;
/**
 * 停机时等在途模型流自己跑完的预算（IKHCJ2）。
 *
 * **默认值压在 Docker 的停止超时之下，这不是保守，是安全边界。** 容器 `docker stop` 默认只给
 * 10 秒，超时就 SIGKILL。等 90 秒却在第 10 秒被强杀，结果比不等更糟：排空还卡在等待里，
 * 连那句 `gateway_shutting_down` 都没发出去，Agent 又退回「大概是我这一段断的」的推断，
 * 而我们连日志都没留下。
 *
 * 要真正排空（一次产卡调用可以跑到 100 秒），**必须两处一起改**：把这个值抬到
 * `AGENT_MODEL_IDLE_TIMEOUT_MS` 那个量级，同时把容器的停止超时调到它之上（compose 的
 * `stop_grace_period`、K8s 的 `terminationGracePeriodSeconds`），留出余量。
 * 只改一处都是白改——只抬这个值会被强杀，只抬停止超时则这里 8 秒就把流掐了。
 */
const DRAIN_TIMEOUT_MS = Number(process.env.AGENT_MODEL_DRAIN_TIMEOUT_MS) || 8_000;
/** 排空轮询的间隔。短到不拖慢停机，长到不空转。 */
const DRAIN_POLL_MS = 200;
/** 本控制器挂载的路由前缀（含全局 /api）。NewAPI 只认裸 `/v1/...`，转发前必须去掉这段。 */
const ROUTE_PREFIX = "/api/internal/agent-model";

/**
 * 在途模型流的登记簿（IKHCJ2）。
 *
 * 本进程一重启，这些流全部当场断掉，Agent 那一侧只看到一个没有任何错误码的
 * `terminated`——它只能推断"大概是我到网关这一段断的"，无从分辨是我们关门了、还是
 * New API 关门了。2026-09-20 就是这样：一次后端部署打断了一轮已经跑到写卡的对话，
 * 而库里记成 `model_error`「模型调用失败，请重试」，模型毫发无伤。
 *
 * 登记簿的唯一用途是：**关门前把话说清楚。** 见
 * `blue-whale-agent` 仓 `docs/blueprint/断点归属与传输中断错误码.md`。
 */
const inFlightStreams = new Set<{
  res: import("express").Response;
  runId: string;
  traceId: string;
  /**
   * 掐断这一条，用于排空超时之后（IKHCJ2）。
   *
   * 是个函数而不是一句固定的写法，因为一次调用有**两段**都算在途，收尾方式不同：等上游回
   * 第一个字的那一段（响应头还没发，只能整个回一个 503），和正在往下游倒字节的那一段
   * （响应头早发了，只能补一帧 SSE 错误再 `end()`）。
   *
   * 2026-09-20 第一版只登记了后一段，于是重启正好打在「等模型回话」时，排空看到的是一本
   * 空簿子——立刻退出，流照死。两段都要登记。
   */
  abort: () => void;
}>();

/**
 * 关门时写给在途流的那一帧，OpenAI 兼容的 SSE 错误形状。
 *
 * 用 `error.code` 而不是自定义字段：Agent 侧沿着 AI SDK 的错误链找 `code` / `type`，
 * 这是唯一一种各家 provider adapter 都会保留的位置。值域与 agent 仓的 `GATEWAY_SIGNALS`
 * 成对，一边加词而另一边不认，Agent 会当作"没说过"退回推断——两边必须同改。
 */
const SHUTDOWN_SIGNAL = "gateway_shutting_down";

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

// 这里曾有一个 `isStreamingRequest`：它读请求体里的 `stream === true`，用来决定挂不挂超时。
// 空闲超时对两种请求含义相同（IKD7AS），于是没有任何人再需要问这个问题。

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
export class AgentModelGatewayController implements BeforeApplicationShutdown {
  private readonly ownerCache = new OwnerCache();

  /**
   * 保险丝：`app.close()` 被直接调用（测试、非信号路径）时仍然排空一次（IKHCJ2）。
   *
   * **正常停机不走这里**，走的是 `main.ts` 的信号处理器直接调用
   * {@link drainAgentModelStreams}。原因是 Nest 的停机顺序把 `onModuleDestroy` 排在
   * `beforeApplicationShutdown` **前面**，而第一步就把 Redis 关了：在途请求挂着的 Redis
   * 命令被 `flushQueue` 以一个未处理的拒绝掀翻，整个进程当场死。2026-09-20 实测——排空日志
   * 打出了「在途 1 条，最多等 90000ms」，0.2 秒后进程就没了，ioredis 的堆栈留在 stdout 上。
   *
   * 排空必须发生在 Nest 拆东西**之前**，不是中间。排过之后簿子是空的，这里会立刻返回。
   */
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
    // X-Trace-Id 到 New API（IKB29O）。上面的循环已经透传 agent 发来的那个，这一行是兜底：
    // agent 没发时（Studio 直连、evals）用本进程 ALS 里的值，而不是让 New API 另起一个。
    // 取值顺序同 agent-v1-proxy：ALS → 已透传的 → 生成，任何一步都不丢已有的 id。
    headers[TRACE_ID_HEADER] =
      getCurrentTraceId() ?? headers[TRACE_ID_HEADER] ?? generateTraceId();

    // 全局 json body-parser（main.ts 的 useBodyParser("json")）已消费请求体流，此刻在已结束的
    // 流上等 data/end 会永久挂起；直接复用解析后的 req.body 重建字节（与 BFF 代理同一修法）。
    const rawBody = Buffer.from(
      req.body === undefined || req.body === null ? "" : JSON.stringify(req.body),
    );

    // 流式与否不再决定有没有闸，只决定闸打在哪儿：两者都用同一个空闲计时器。等首字节的这
    // 一段也归它管，所以计时器在 fetch 之前就起。
    const idle = createIdleTimer(UPSTREAM_IDLE_TIMEOUT_MS);

    // 登记进在途簿（IKHCJ2）——**在 fetch 之前，不是拿到响应之后**。
    //
    // 一次调用有两段都算在途：等上游回第一个字的这一段，和之后倒字节的那一段。第一版只登记了
    // 后一段，2026-09-20 实测重启正好打在前一段（模型想了 9 秒还没开口），排空看到空簿子立刻
    // 退出，流照死——而日志里一行都没有，看上去像是功能根本没生效。
    //
    // `abort` 分两种收尾：响应头还没发就整个回一个 503（带同一个信号），已经发了就补一帧 SSE
    // 错误。`aborted` 让下面的正常路径知道该闭嘴——否则 fetch 一返回就会往已经发过的响应上
    // 再写一次头，Express 直接抛 `ERR_HTTP_HEADERS_SENT`。
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
        // 还没开口的那一段：503 里带同一个信号。Agent 对「上游明说要关门」的识别不看传输形状
        // ——SSE 帧和 HTTP 状态两条路落的是同一个码、同一个断点归属。
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
      // 走上游唯一出口（路径拼接 + X-Trace-Id 统一由它负责）
      upstream = await newApiFetch(upstreamPath, init);
    } catch (error) {
      idle.clear();
      unregister();
      // 停机掐的那一次：响应已经由 `abort` 发过了，这里再写就是 ERR_HTTP_HEADERS_SENT。
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
      // fetch 刚好在掐断之后返回：响应已经发完，上游那份 body 直接丢弃。
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
      // 登记在 fetch 之前就做了（见上），这里只接收尾：下面每一条结束路径都注销——登记簿
      // 漏一条，停机排空就会一直等一条已经结束的流，白白耗光预算。
      //
      // 每来一段字节就把闸往后推。`data` 与 `pipe` 同一个同步块内挂上，中间不可能漏掉一段
      // ——流的事件是异步发的。
      stream.on("data", () => idle.touch());
      stream.on("end", () => {
        idle.clear();
        unregister();
      });
      stream.on("close", () => {
        idle.clear();
        unregister();
      });
      // 客户端（Agent）自己走了也要注销：否则这条流会一直挂在簿上，直到停机时被当成
      // 「我们害死的」记一笔——那是冤枉自己，而错误的归属和没有归属一样坏。
      res.on("close", unregister);
      stream.on("error", (error) => {
        idle.clear();
        unregister();
        logger.error(
          `[internal/agent-model] upstream stream error: ${idle.expired ? `空闲超过 ${idleSeconds()} 秒` : error instanceof Error ? error.message : String(error)}`,
        );
        // 响应头早已发出，此刻只能断开连接——这就是「上游半途不说话了」的诚实表现。
        if (!res.writableEnded) res.destroy();
      });
      stream.pipe(res);
    } else {
      // 非流式响应（上游没给 body）：这一条同样登记过，同样要注销。
      idle.clear();
      unregister();
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

/**
 * 停机排空：先等在途模型流自己跑完，等不及的那几条再说一句话掐掉（IKHCJ2）。
 *
 * 两件事，顺序不能反：
 *
 * 1. **排空**：等到登记簿空了，或者花光 {@link DRAIN_TIMEOUT_MS}。跑完的那些是全须全尾收尾的，
 *    Agent 那边压根不知道我们重启过——这才是「部署不该杀掉对话」的正解。
 * 2. **掐断并交代**：排空超时后仍在途的，`abort()` 补一帧 `gateway_shutting_down`（还没开口时
 *    整个回一个 503）。这一帧把「这次中断是部署造成的」从 Agent 的推断变成本层的陈述：它收到
 *    之后落 `model_gateway_interrupted` / `break_reporter=gateway` / `break_segment_inferred=false`，
 *    而不是把账记在模型头上。
 *
 * 写失败一律吞掉：对端可能已经先走了，而**停机流程不能被一条写不出去的流拖住**。
 *
 * **排空期间 HTTP server 还开着**（`app.close()` 排在这之后），所以同一轮对话接下来的模型调用
 * 照样进得来、照样登记。这是刻意的，也正是它管用的原因：2026-09-20 实测一次 `docker stop` 打在
 * 对话中途，排空等了 36.4 秒跨过好几次模型调用，那一轮 run 完整跑完、`completed` 收尾。
 * 代价是繁忙的服务可能一直有新流进来、直到耗光预算——预算就是为这个封顶的。
 *
 * **是模块级函数而不是控制器方法**，因为它必须能在 Nest 生命周期之外被调用——见
 * `AgentModelGatewayController.beforeApplicationShutdown` 上那段关于 Redis 先被关掉的说明。
 *
 * ⚠️ 排空预算与容器停止超时必须配套，见 {@link DRAIN_TIMEOUT_MS}。
 */
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
    // 全部自然收尾——这次部署一轮对话都没杀。没有 `shutdown_abort`，因为确实没中断谁。
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
      // 对端先走了。这条流本来就没人收，没什么可补救的。
    }
  }
  inFlightStreams.clear();
  // 有了这一行，「这次部署打断了几轮对话」是可查的数字，而不是靠猜。此前后端对自己害死了
  // 几条在途流毫无记录——四方各知道一小块，没有一方拼得出全貌。
  //
  // 排空之后它记的是「等不及的那几条」，不再是「在途的全部」。`drained_streams` 与
  // `aborted_streams` 一起看，部署的真实代价就是可量的数字。
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

/** 闸的长度，写成人看的秒数。不用 `Math.round`：测试把窗口压到几百毫秒，round 会说成「0 秒」。 */
function idleSeconds(): string {
  return String(Number((UPSTREAM_IDLE_TIMEOUT_MS / 1000).toFixed(1)));
}

/**
 * 一个可以反复往后推的闸。`touch()` 重新计时，`clear()` 拆掉，`expired` 说明这次中止是它干的
 * ——`AbortError` 本身分不出「超时」和「客户端断开」，而这两件事对用户的意思完全不同。
 */
function createIdleTimer(ms: number) {
  const controller = new AbortController();
  const state = { expired: false };
  let handle: NodeJS.Timeout | undefined = undefined;
  const arm = () => {
    handle = setTimeout(() => {
      state.expired = true;
      controller.abort();
    }, ms);
    // 这个计时器不该把进程留在事件循环里等它。
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
    /**
     * 主动掐断上游请求，用于停机排空超时（IKHCJ2）。
     *
     * 与超时共用一个 `AbortController`，但不置 `expired`——这次中断的原因是我们要关门，
     * 不是「NewAPI 多少秒没响应」。两者落的日志和回给 Agent 的话都不一样，混成一个会让
     * 「我们重启了」看上去像「上游挂了」。
     */
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
