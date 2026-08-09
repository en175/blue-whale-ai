import {
  createFakeAgentAdapter,
  createNewApiAgentAdapter,
  resolveAgentRuntimeManifest,
  validateAgentRuntimeManifest,
  type AgentRuntimeEnv,
} from "@blue-whale/agent-runtime";
import type { AgentAdapter } from "@blue-whale/core";
import type { AgentRuntimeManifest } from "@blue-whale/contracts";

export function validateAgentWorkerStartup(
  manifest: unknown = resolveAgentRuntimeManifest(),
): AgentRuntimeManifest {
  return validateAgentRuntimeManifest(manifest);
}

/** 按 AGENT_RUNTIME_MODE 装配 Agent 适配器（IK7EU4）：
 *  - fake（默认）：确定性假适配器，验收套件基线不变；
 *  - real：经 new-api 网关的真实模型适配器，模型取自 manifest 选中 profile，
 *    要求 NEW_API_BASE_URL / NEW_API_ROOT_ACCESS_TOKEN（缺则拒绝启动）；
 *  - 其它取值：由 resolveAgentRuntimeManifest 拒绝。
 *  密钥只在进程内使用，不落产品库、不写日志。 */
export function createAgentAdapterFromEnv(
  env: AgentRuntimeEnv = process.env,
  manifest: AgentRuntimeManifest = resolveAgentRuntimeManifest(env),
): AgentAdapter {
  const profile = manifest.model_profiles.find(
    (entry) => entry.model_profile_id === manifest.selected_model_profile_id,
  );
  if (!profile) throw new Error("resolved manifest is missing its selected model");
  if (profile.provider === "fake") return createFakeAgentAdapter();
  // provider 白名单：注册表是开放集合，未知 provider 必须显式拒绝，
  // 不得静默落入 new-api 装配（env 名也写死 NEW_API_*）。
  if (profile.provider !== "newapi") {
    throw new Error(`unsupported agent model provider=${profile.provider}`);
  }

  const baseUrl = env.NEW_API_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("AGENT_RUNTIME_MODE=real requires NEW_API_BASE_URL");
  }
  const token = env.NEW_API_ROOT_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "AGENT_RUNTIME_MODE=real requires NEW_API_ROOT_ACCESS_TOKEN",
    );
  }
  return createNewApiAgentAdapter({
    baseUrl,
    token,
    model: profile.model,
    provider: profile.provider,
  });
}
