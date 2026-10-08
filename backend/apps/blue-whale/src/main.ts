import "reflect-metadata";
import express from "express";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { NewApiError } from "@lib/core";
import { closeDefaultTlsLogWriter } from "@lib/core/logging";
import { missingBillingConfig } from "@lib/shared/billing/billing-client.js";
import { traceMiddleware } from "@lib/infra/middleware/trace.middleware.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AppModule } from "./app.module.js";
import {
  assertAgentModelGatewayConfig,
  drainAgentModelStreams,
} from "./api/agent/agent-model-gateway.controller.js";

const port = Number.parseInt(process.env.PORT ?? "3100", 10);

/**
 * 等 `app.close()` 多久就不等了（IKHCJ2 复审）。
 *
 * 必须比容器停止超时小一截，否则闸没合上进程已经被 SIGKILL 了。测试站与生产的停止超时分别是
 * 30 秒和 120 秒，而这条路径前面还有排空（默认 8 秒）、后面还有 TLS 冲刷（5 秒）：
 * 8 + 10 + 5 = 23 秒，落在 30 秒里还有余量。
 */
const APP_CLOSE_TIMEOUT_MS = Number(process.env.SHUTDOWN_APP_CLOSE_TIMEOUT_MS) || 10_000;

async function bootstrap(): Promise<void> {
  // 模型网关凭证在这里查，不留到第一个请求才发现（IKCGDX review）。前缀配错会让整条
  // 网关路径静默失效，所以那一种直接拒绝启动。
  assertAgentModelGatewayConfig();

  // `bodyParser: false` 是下面那两个解析器能按注册顺序生效的前提。
  //
  // NestJS 自带的 body parser 不是"后注册就后跑"——它在 `init()` 时装到用户中间件**之前**，
  // 于是 `app.useBodyParser("json", { limit })` 无论写在哪一行，都会先把请求流读掉。此前
  // 这里靠"先注册先命中"给 agent-model 单独放开 64MB，那行实际从未生效：实测本地打
  // 1.9MB 进 /api/internal/agent-model 仍然 `PayloadTooLargeError`，抛错的是全局 1MB 的
  // jsonParser。关掉自带的，改为下面手工注册，顺序才真的说了算。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // 入站 trace 上下文（IK9RSS）：在所有路由处理前注入 x-trace-id → ALS，
  // 使下游 getCurrentTraceId() 可用，出站 X-Trace-Id 透传、结构化日志 trace_id 有值。
  app.use(traceMiddleware);

  // 解析会话 cookie（HttpOnly 登录态，ADR-0062 #19 凭证分层）。
  app.use(cookieParser());

  // 前端 apiFetch 走 /api/... 前缀（对齐 blue_whale_web/app/api 路由）。
  app.setGlobalPrefix("api");

  // Agent 多模态透传（IKAL46）：读图/读视频时 Mastra 会把素材下载后以 base64 内联进
  // chat/completions 请求体，一张 8MB 的图编码后就有 ~11MB。这条内部代理必须放到与
  // Agent 侧媒体策略 `requestBodyMaxBytes`（64MB）一致的上限，否则请求在 body-parser
  // 就被 PayloadTooLargeError 挡下，表现为模型网关 500、Agent 侧「读不到图」。
  //
  // 只对这一条内部路由放开，而不是抬高全局上限——其余端点没有理由接收几十 MB 的体。
  // 注册在全局解析器之前：先命中的解析器填好 req.body，后面那个看到流已被消费就跳过。
  // 这个顺序只有在 `bodyParser: false` 之下才成立，见上面 NestFactory.create 的说明。
  app.use("/api/internal/agent-model", express.json({ limit: "64mb" }));

  // 对齐原 BFF：文生文透传上限 1MB（TEXT_MAX_BODY_BYTES）；框架默认 100kb 会先于
  // 控制器内的 OpenAI 形 413 拦截，导致 100kb–1MB 体返回错误响应形态。
  // Canvas JSON is itself a string in the envelope; allow escaping overhead for the 4 MiB document contract.
  app.use("/api/canvases", express.json({ limit: "16mb" }));
  app.use(express.json({ limit: "1mb" }));
  // urlencoded 随之一并手工注册：关掉自带 parser 之后它也没了，而表单端点还在用。
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => {
        const first = errors[0];
        const message = first
          ? Object.values(first.constraints ?? {})[0]
          : undefined;
        return new NewApiError(message ?? "参数校验失败", 400, "validation_error");
      },
    }),
  );

  // 这里曾有 `app.enableShutdownHooks()`。它只做一件事：替我们监听 SIGTERM/SIGINT 然后调
  // `app.close()`。而下面本来就有一对自己的处理器做同样的事——两份监听器在同一个信号上并发
  // 跑，Nest 那份会立刻开始 `callDestroyHook()` 关掉 Redis，把我们刚开始的排空连同进程一起
  // 掀翻（IKHCJ2，见下面 shutdown 的说明）。生命周期钩子由 `app.close()` 照常触发，不受影响。

  // ⚠️ **计费依赖齐备性：不齐就别起来。**
  //
  // 缺 BILLING_GRPC_URL 的后果不是「某个功能不好用」，而是**静默地不扣钱**：
  // 提交生成拿不到计费服务，冻结不了预扣。new-api 从「替我们扣费」变成「上游供应商」
  // 之后，我们**不再有第二个扣费方**，于是任何一条「配置缺失就跳过」的路径都等于一条
  // 免费通道。放在 listen 之前拦，是因为一个扣不了钱的进程不该开始接受请求——等到第一个
  // 用户提交才发现，那段时间里已经在白跑了。
  //
  // ⚠️ **上游 key 不再守在这道门里**（它曾经是「缺了登录签发不出会话」）。原因有两条，
  //    都不是「不那么重要了」：
  //       1. 它已经**不是环境变量**——配在 `system_settings`，管理端维护，改完即生效。
  //          拿它去查 `process.env` 只会永远查不到，门禁就变成一句恒真的废话。
  //       2. 「**数据还没填**」与「**部署配错**」是两回事，前者不该拒启。配置要在管理端填，
  //          管理端要先登得进来——在这里拒启，新部署永远起不来，没人能进去把它配上。
  const missingBilling = missingBillingConfig();
  if (missingBilling.length > 0) {
    logger.error(
      `启动中止：计费依赖未配置（缺 ${missingBilling.join(" / ")}）。` +
        `new-api 已切断，缺它会让生成不扣费。`,
    );
    process.exit(1);
  }

  await app.listen(port);
  logger.info(`backend listening on :${port}`);

  // 优雅停机（IK9RSS）：app.close() 触发 OnModuleDestroy 链，之后冲刷 TLS 缓冲。
  // closeDefaultTlsLogWriter 自带 5s 超时，TLS 不可达不反噬进程退出。
  //
  // **排空必须排在 app.close() 之前**（IKHCJ2）。Nest 的停机顺序是 onModuleDestroy →
  // beforeApplicationShutdown → 关 HTTP server，第一步就把 Redis 关了；在途请求挂着的 Redis
  // 命令被 ioredis 的 flushQueue 以一个未处理的拒绝掀翻，整个进程当场死。2026-09-20 实测：
  // 排空日志打出了「在途 1 条，最多等 90000ms」，0.2 秒后进程就没了，ioredis 的堆栈留在
  // stdout 上。所以在途模型流不能靠 Nest 的生命周期排空，只能在它开始拆之前排干净。
  const shutdown = async (): Promise<void> => {
    await drainAgentModelStreams();

    // `app.close()` **可以永远不返回**，所以给它一个闸（IKHCJ2 复审，2026-09-21 测试站实测）。
    //
    // Node 的 `server.close()` 只是停止接受新连接，它**不会**主动断开已经建立的 keep-alive
    // 连接——而 Agent 的连接池一直挂着几条。于是 `app.close()` 一直等，等到容器的停止超时被
    // SIGKILL，后面两行一次都执行不到。
    //
    // 实测（测试站，三轮都一样）：排空 8 秒正常收尾，之后 **21 秒一行日志都没有**，然后进程
    // 被杀。代价很具体：**TLS 日志冲刷没跑**，`shutdown_abort`（这次部署打断了几条）只进了
    // 容器 stdout，而容器一删就没了——那正是我们想留的那笔账。
    //
    // 这不是本次引入的，换成 `app.enableShutdownHooks()` 一样挂；以前没人发现，是因为流水线
    // 用 `docker rm -f` 直接 SIGKILL，这段代码从来没机会跑。但一条不保证结束的优雅停机等于
    // 没有优雅停机，所以在这里封顶——与 agent 仓 `drainForShutdown` 超时后
    // `closeAllConnections()` 的做法一致。
    const closed = await Promise.race([
      app.close().then(() => true as const),
      new Promise<false>(resolve => setTimeout(() => resolve(false), APP_CLOSE_TIMEOUT_MS)),
    ]);
    if (!closed) {
      logger.warn(
        `[shutdown] app.close() ${APP_CLOSE_TIMEOUT_MS}ms 未返回，强断残留连接后继续退出`,
        { event: "shutdown.app_close_timeout", app_close_timeout_ms: APP_CLOSE_TIMEOUT_MS },
      );
      // 挂着的多半就是这些没人再用的 keep-alive 连接，强断它们让还在跑的 close 能收尾。
      // 拿不到这个方法（Node < 18.2 或 adapter 换了）也不该反噬退出，所以整段吞掉。
      try {
        (app.getHttpServer() as { closeAllConnections?: () => void }).closeAllConnections?.();
      } catch {
        /* 强断失败也要接着退出——这一步是尽力而为，不是退出的前置条件。 */
      }
    }

    // 排在强断之后：这一行要把上面那几条停机日志真正送出去，而它自带 5s 超时，
    // TLS 不可达也不反噬进程退出。
    await closeDefaultTlsLogWriter(5_000);
    // 显式退出：没有 Nest 的信号处理器之后，没人再把信号重新抛一次，而残留的句柄
    // （连接池、计时器）足以让进程挂到容器的停止超时被 SIGKILL。
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void bootstrap();
