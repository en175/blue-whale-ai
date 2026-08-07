// IK6XQI 基建修复：从 core 的 ./readiness 子路径导入（不进 core 主 barrel）——
// 主入口含 trace.ts（node:async_hooks，server-only），contracts 主入口再导出本文件
// 会把 server 模块拉进浏览器 bundle（Turbopack chunking 报错）。
import { serviceNames } from "@blue-whale/core/readiness";
import { z } from "zod";

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.enum(serviceNames),
  dependencies: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(["ready", "not_ready"]),
    }),
  ),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
