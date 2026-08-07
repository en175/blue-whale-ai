import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Next.js 启动边界", () => {
  it("启动恢复扫描前拒绝无效 Runtime Manifest", async () => {
    // 校验位于 NEXT_RUNTIME 门控之后（edge 包不能打 node:crypto，见 IK6B2T），
    // 测试需显式模拟 nodejs runtime 才能走到校验。
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const invalid = structuredClone(bundledAgentRuntimeManifest);
    invalid.selected_model_profile_id = "model.missing";

    await expect(register(invalid)).rejects.toThrow("model profile reference");
  });

  it("instrumentation 不得包含任何静态导入（edge 包污染回归）", () => {
    // IK6B2T：本文件同时被编译进 Edge Instrumentation 包，任何值级静态导入
    // 都会进 edge 包（node-only 依赖如 node:crypto 直接报错）。防线为行首
    // 语句级检测：单行/跨行/副作用导入全覆盖；import type 编译期擦除、
    // 动态 import() 后随括号，均不误伤。
    const source = readFileSync(
      fileURLToPath(new URL("./instrumentation.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/^import\s+(?!type\b)/gm);
  });
});
