// IK7EU4：RunPin 模型 profile 校验从硬编码 fake 三元组改为注册表命中。
import { bundledAgentRuntimeManifest } from "@blue-whale/agent-runtime";
import { describe, expect, it } from "vitest";

import { patchRunPin, runPin } from "./worker-loop.testlib.js";
import { validateRunPin } from "./worker-run-pin.js";

describe("RunPin 模型 profile 校验（IK7EU4）", () => {
  it("fake profile pin 通过（基线不回归）", () => {
    const instructions = validateRunPin(runPin, "你好");
    expect(instructions.length).toBeGreaterThan(0);
  });

  it("newapi 真实 profile pin 放行", () => {
    const realProfile = bundledAgentRuntimeManifest.model_profiles.find(
      (profile) => profile.model_profile_id === "newapi.minimax_m3",
    );
    expect(realProfile).toBeDefined();
    const pin = patchRunPin(runPin, {
      model_profile: structuredClone(realProfile!),
    });

    expect(() => validateRunPin(pin, "你好")).not.toThrow();
  });

  it("未注册模型三元组仍拒绝", () => {
    const pin = patchRunPin(runPin, {
      model_profile: {
        model_profile_id: "newapi.unknown",
        provider: "newapi",
        model: "no-such-model",
        context_window_tokens: 8192,
        tokenizer: "openai-compatible-v1",
      },
    });

    expect(() => validateRunPin(pin, "你好")).toThrow(
      "runtime_pin_model_reference_invalid",
    );
  });

  it("pin 与 worker 选中 profile 不一致时拒绝（env 歪斜防线）", () => {
    const realProfile = bundledAgentRuntimeManifest.model_profiles.find(
      (profile) => profile.model_profile_id === "newapi.minimax_m3",
    )!;

    // fake pin + worker 选中 newapi → 拒绝
    expect(() => validateRunPin(runPin, "你好", realProfile)).toThrow(
      "runtime_pin_model_reference_invalid",
    );
    // fake pin + worker 选中 fake → 放行
    const fakeProfile = bundledAgentRuntimeManifest.model_profiles.find(
      (profile) => profile.model_profile_id === "fake.default",
    )!;
    expect(() => validateRunPin(runPin, "你好", fakeProfile)).not.toThrow();

    const realPin = patchRunPin(runPin, {
      model_profile: structuredClone(realProfile),
    });
    expect(() => validateRunPin(realPin, "你好", fakeProfile)).toThrow(
      "runtime_pin_model_reference_invalid",
    );
  });

  it("物理运行时相同则允许旧 RunPin 保留冻结的 profile 元数据", () => {
    const fakeProfile = bundledAgentRuntimeManifest.model_profiles.find(
      (profile) => profile.model_profile_id === "fake.default",
    )!;
    const currentRuntimeIdentity = {
      ...fakeProfile,
      model_profile_id: "fake.renamed",
      context_window_tokens: fakeProfile.context_window_tokens * 2,
    };

    expect(() =>
      validateRunPin(runPin, "你好", currentRuntimeIdentity),
    ).not.toThrow();
  });
});
