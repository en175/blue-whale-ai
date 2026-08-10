import { describe, expect, it } from "vitest";

import {
  bundledAgentRuntimeManifest,
  isRegisteredAgentModelProfile,
  resolveAgentRuntimeManifest,
  validateAgentRuntimeManifest,
} from "./runtime-manifest.js";

function cloneManifest(): Record<string, unknown> {
  return structuredClone(bundledAgentRuntimeManifest) as Record<string, unknown>;
}

describe("AgentRuntimeManifest 启动校验", () => {
  it("接受并冻结随应用发布的完整 Manifest", () => {
    const manifest = validateAgentRuntimeManifest(bundledAgentRuntimeManifest);

    expect(manifest.manifest_id).toBe("blue_whale_default");
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.resources)).toBe(true);
  });

  it("资源内容摘要不匹配时拒绝启动", () => {
    const manifest = cloneManifest();
    const resources = manifest.resources as Array<Record<string, unknown>>;
    resources[0] = { ...resources[0], content: "tampered" };

    expect(() => validateAgentRuntimeManifest(manifest)).toThrow(
      "resource digest mismatch",
    );
  });

  it("资源、模型或工具引用无效时拒绝启动", () => {
    const missingRole = cloneManifest();
    missingRole.role_resource_id = "role.missing";
    expect(() => validateAgentRuntimeManifest(missingRole)).toThrow(
      "role resource reference",
    );

    const unknownModel = cloneManifest();
    unknownModel.selected_model_profile_id = "model.missing";
    expect(() => validateAgentRuntimeManifest(unknownModel)).toThrow(
      "model profile reference",
    );

    const unknownTool = cloneManifest();
    unknownTool.tool_grants = [
      { tool_id: "unknown.tool", registry_version: 1 },
    ];
    expect(() => validateAgentRuntimeManifest(unknownTool)).toThrow(
      "tool registry reference",
    );
  });

  it("Manifest 摘要不匹配时拒绝启动", () => {
    const manifest = cloneManifest();
    manifest.manifest_digest = `sha256:${"0".repeat(64)}`;

    expect(() => validateAgentRuntimeManifest(manifest)).toThrow(
      "manifest digest mismatch",
    );
  });
});

describe("真实模型 profile 与 env 选择（IK7EU4）", () => {
  it("bundled manifest 同时注册 fake 与 newapi 真实 profile，默认选中 fake", () => {
    expect(
      bundledAgentRuntimeManifest.model_profiles.map(
        (profile) => profile.model_profile_id,
      ),
    ).toEqual(["fake.default", "newapi.minimax_m3"]);
    expect(bundledAgentRuntimeManifest.selected_model_profile_id).toBe(
      "fake.default",
    );
  });

  it("isRegisteredAgentModelProfile 命中已注册 profile，拒绝未知三元组", () => {
    expect(
      isRegisteredAgentModelProfile({
        provider: "fake",
        model: "deterministic-v1",
        tokenizer: "fake-v1",
      }),
    ).toBe(true);
    expect(
      isRegisteredAgentModelProfile({
        provider: "newapi",
        model: "MiniMax-M3",
        tokenizer: "openai-compatible-v1",
      }),
    ).toBe(true);
    expect(
      isRegisteredAgentModelProfile({
        provider: "newapi",
        model: "no-such-model",
        tokenizer: "openai-compatible-v1",
      }),
    ).toBe(false);
  });

  it("默认（无 env 或 fake）返回 bundled manifest 本体", () => {
    expect(resolveAgentRuntimeManifest({})).toBe(bundledAgentRuntimeManifest);
    expect(resolveAgentRuntimeManifest({ AGENT_RUNTIME_MODE: "fake" })).toBe(
      bundledAgentRuntimeManifest,
    );
  });

  it("AGENT_RUNTIME_MODE=real 时选中真实 profile 且 manifest digest 重算自洽", () => {
    const manifest = resolveAgentRuntimeManifest({
      AGENT_RUNTIME_MODE: "real",
    });

    expect(manifest.selected_model_profile_id).toBe("newapi.minimax_m3");
    expect(manifest.manifest_digest).not.toBe(
      bundledAgentRuntimeManifest.manifest_digest,
    );
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(() => validateAgentRuntimeManifest(manifest)).not.toThrow();
  });

  it("real manifest 把模型输出协议冻结为 Rule 资源", () => {
    const manifest = resolveAgentRuntimeManifest({
      AGENT_RUNTIME_MODE: "real",
    });
    const protocol = manifest.resources.find(
      (resource) => resource.resource_id === "rule.real_agent_output_protocol",
    );

    expect(protocol?.kind).toBe("rule");
    expect(protocol?.content).toContain("scene_card_replace 必须独占");
    expect(manifest.rule_resource_ids).toContain(
      "rule.real_agent_output_protocol",
    );
    expect(
      bundledAgentRuntimeManifest.resources.some(
        (resource) =>
          resource.resource_id === "rule.real_agent_output_protocol",
      ),
    ).toBe(false);
  });

  it("未知 AGENT_RUNTIME_MODE 拒绝启动", () => {
    expect(() =>
      resolveAgentRuntimeManifest({ AGENT_RUNTIME_MODE: "staging" }),
    ).toThrow("AGENT_RUNTIME_MODE");
  });
});
