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
export async function register(manifest?: unknown): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bundledAgentRuntimeManifest, validateAgentRuntimeManifest } =
    await import("@blue-whale/agent-runtime");
  validateAgentRuntimeManifest(manifest ?? bundledAgentRuntimeManifest);
  const globalKey = "__blueWhaleImageRecoveryStarted";
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[globalKey]) return;
  g[globalKey] = true;

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
    void recoverDueImageJobs(deps).catch((error) =>
      console.error(
        "[image-recovery] scan failed:",
        error instanceof Error ? error.message : "unknown",
      ),
    );
  };

  // 启动后立即跑一次（接回重启前孤儿），再周期跑。
  tick();
  setInterval(tick, intervalMs);
}
