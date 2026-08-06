import { describe, expect, it } from "vitest";

import {
  bundledAgentRuntimeManifest,
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
