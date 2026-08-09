/**
 * Next.js instrumentation hook —— 服务端启动时拉起图片生成的进程内恢复扫描。
 *
 * 为什么需要：图片生成在 Next 进程内调度，进程重启会留孤儿 queued 任务，瞬时失败也需要重试。
 * 视频已有独立 BullMQ worker 兜底；这里给图片补上等价的低频恢复（≈ recoverDueVideoJobs）。
 *
 * 仅在 Node.js runtime 注册一次（globalThis 去重，防 dev 热重载多次挂载）。
 * 每 IMAGE_RECOVERY_INTERVAL_MS（默认 60s）跑一次；启动时立即跑一次接回重启前的孤儿。
 *
 * 注意：本文件同时被 Next 编译进 Edge Instrumentation 包。@blue-whale/agent-runtime
 * 依赖 node:crypto（edge 不支持），只能动态导入且必须位于 NEXT_RUNTIME 门控之后——
 * 门控外的静态/动态导入都会被打进 edge 包导致启动报错（IK6B2T）。
 */
// @blue-whale/core/logging 依赖 node:async_hooks（edge 不支持），
// 运行时导入必须位于 NEXT_RUNTIME 门控之后（与 agent-runtime 同款约束，IK6B2T）；
// 此处仅 type import（编译期擦除，不进 edge bundle）。
import type { Logger } from "@blue-whale/core/logging";

let getBffLogger: () => Logger;
let runWithTraceId: (traceId: string, fn: () => unknown) => unknown;
let generateTraceId: () => string;
let closeDefaultTlsLogWriter: (timeoutMs?: number) => Promise<void>;

export async function register(manifest?: unknown): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getBffLogger: getLogger }, logging] = await Promise.all([
    import("@/lib/logging"),
    import("@blue-whale/core/logging"),
  ]);
  getBffLogger = getLogger;
  runWithTraceId = logging.runWithTraceId;
  generateTraceId = logging.generateTraceId;
  closeDefaultTlsLogWriter = logging.closeDefaultTlsLogWriter;
  const { resolveAgentRuntimeManifest, validateAgentRuntimeManifest } =
    await import("@blue-whale/agent-runtime");
  // IK7EU4：默认 manifest 按 AGENT_RUNTIME_MODE 解析（与 agent-worker 同源）。
  validateAgentRuntimeManifest(manifest ?? resolveAgentRuntimeManifest());
  const globalKey = "__blueWhaleImageRecoveryStarted";
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[globalKey]) return;
  g[globalKey] = true;

  // web 进程优雅停机：冲刷 server bundle 的 TLS Producer 缓冲（IK73EV，对齐 worker 侧）。
  // 放在 globalKey 去重之后，防 dev 热重载堆积 listener。
  // proxy bundle 独立持有自己的 Producer 实例，在 proxy.ts 侧自行注册关闭钩子。
  const shutdown = (): void => {
    void closeDefaultTlsLogWriter().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  const [{ createGenerationWorkerDeps }, { recoverDueImageJobs }] =
    await Promise.all([
      import("@/lib/generation/deps"),
      import("@/lib/generation/image-recovery"),
    ]);

  const deps = createGenerationWorkerDeps();
  const intervalMs = Number.parseInt(
    process.env.IMAGE_RECOVERY_INTERVAL_MS ?? "60000",
    10,
  );

  const tick = (): void => {
    // 后台扫描在请求上下文之外：显式生成 trace_id 包裹，使错误日志可关联（IK73EV）。
    runWithTraceId(generateTraceId(), () => {
      void recoverDueImageJobs(deps).catch((error) => {
        getBffLogger().error(
          `[image-recovery] scan failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      });
    });
  };

  // 启动后立即跑一次（接回重启前孤儿），再周期跑。
  tick();
  setInterval(tick, intervalMs);
}
