import { describe, expect, it, vi } from "vitest";
import { bundledAgentRuntimeManifest } from "../../../packages/agent-runtime/src/runtime-manifest.js";
import { createHash } from "node:crypto";
import {
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@blue-whale/contracts";

import { runAgentWorkerOnce } from "./worker-loop.js";

const runPinSource: Omit<AgentRunPin, "pin_digest"> = {
  schema_version: 1 as const,
  manifest_id: bundledAgentRuntimeManifest.manifest_id,
  manifest_version: bundledAgentRuntimeManifest.manifest_version,
  manifest_digest: bundledAgentRuntimeManifest.manifest_digest,
  resources: structuredClone(bundledAgentRuntimeManifest.resources),
  role_resource_id: bundledAgentRuntimeManifest.role_resource_id,
  rule_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.rule_resource_ids,
  ),
  runtime_skill_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.runtime_skill_resource_ids,
  ),
  model_profile: structuredClone(
    bundledAgentRuntimeManifest.model_profiles[0]!,
  ),
  runtime_budget_policy: bundledAgentRuntimeManifest.runtime_budget_policy,
  tool_grants: [],
  auto_creative_skill_candidates: [],
  activated_creative_skill_versions: [],
  creative_skill_resources: [],
};

function signRunPin(source: Omit<AgentRunPin, "pin_digest">): AgentRunPin {
  return {
    ...source,
    pin_digest: `sha256:${createHash("sha256")
      .update(canonicalAgentRunPinDigestInput(source))
      .digest("hex")}`,
  };
}

function patchRunPin(
  pin: AgentRunPin,
  patch: Partial<Omit<AgentRunPin, "pin_digest">>,
): AgentRunPin {
  const { pin_digest: _pinDigest, ...source } = pin;
  return signRunPin({ ...source, ...patch });
}

const runPin = signRunPin(runPinSource);

function work(prompt = "生成蓝鲸海报") {
  return {
    schema_version: 1 as const,
    agent_run_id: "9",
    advance_id: "30",
    fencing_token: "3",
    run_version: 4,
    input_high_watermark_sequence_no: 2,
    input_messages: [
      {
        message_id: "20",
        sequence_no: 2,
        role: "user" as const,
        content: prompt,
      },
    ],
    prompt,
    run_pin: runPin,
    auto_creative_skill_candidates: [],
    activated_creative_skill_versions: [],
    conversationId: "7",
    userId: "100",
    skillSummarize: false,
  };
}

describe("runAgentWorkerOnce", () => {
  it("invokes the runtime outside persistence and commits with the claimed fence", async () => {
    const claimNext = vi.fn().mockResolvedValue(work());
    const commitSuccess = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    const commitFailure = vi.fn().mockResolvedValue({ kind: "conflict" });
    const renewLease = vi.fn().mockResolvedValue(true);
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "已完成",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });
    await expect(
      runAgentWorkerOnce({
        repo: { claimNext, renewLease, commitSuccess, commitFailure },
        runtime: { name: "fake", ready: async () => true, invoke },
        workerId: "worker-1",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "生成蓝鲸海报", creativeSkill: null }),
    );
    expect(commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "3",
        runVersion: 4,
        requestDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        content: "已完成",
        reasoningSummary: "已完成回答。",
        autoCreativeSkillActivation: null,
      }),
    );
  });

  it("selects at most one frozen auto candidate by exact name and commits the safe reason", async () => {
    const body = "# Poster instructions";
    const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const candidate = {
      creative_skill_id: "official.poster",
      creative_skill_version_id: "version.poster.1",
      name: "海报专家",
      description: null,
      display_version: "1.0.0",
      resource_digest: digest,
    };
    const autoRunPin = patchRunPin(runPin, {
      auto_creative_skill_candidates: [candidate],
      creative_skill_resources: [
        {
          ...candidate,
          media_type: "text/markdown" as const,
          body,
          content_digest: digest,
        },
      ],
    });
    const autoWork = {
      ...work("海报专家"),
      run_pin: autoRunPin,
      auto_creative_skill_candidates: [candidate],
    };
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "已完成",
      reasoningSummary: "已使用「海报专家」完成回答。",
      action: { kind: "respond" },
    });
    const commitSuccess = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });

    await runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue(autoWork),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess,
        commitFailure: vi.fn(),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        creativeSkill: expect.objectContaining({
          creativeSkillVersionId: "version.poster.1",
          resourceDigest: digest,
          body,
        }),
      }),
    );
    expect(commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        autoCreativeSkillActivation: expect.objectContaining({
          creative_skill_id: "official.poster",
          source: "auto",
          reason: {
            type: "agent_match",
            detail: { matched_fields: ["conversation_messages"] },
          },
        }),
      }),
    );
  });

  it.each([
    [
      "完整性摘要不匹配",
      {
        ...runPin,
        resources: runPin.resources.map((resource, index) =>
          index === 0
            ? { ...resource, content: `${resource.content} tampered` }
            : resource,
        ),
      },
      "runtime_pin_digest_mismatch",
    ],
    [
      "规则引用无效",
      patchRunPin(runPin, { rule_resource_ids: [runPin.role_resource_id] }),
      "runtime_pin_rule_reference_invalid",
    ],
    [
      "模型未注册",
      patchRunPin(runPin, {
        model_profile: { ...runPin.model_profile, model: "unknown" },
      }),
      "runtime_pin_model_reference_invalid",
    ],
    [
      "工具未授权",
      patchRunPin(runPin, {
        tool_grants: [{ tool_id: "tool.unknown", registry_version: 1 }],
      }),
      "runtime_pin_tool_reference_invalid",
    ],
    [
      "调用预算无效",
      patchRunPin(runPin, {
        runtime_budget_policy: {
          ...runPin.runtime_budget_policy,
          max_provider_calls: 2,
        },
      }),
      "runtime_pin_budget_invalid",
    ],
  ])(
    "rejects a signed or tampered RunPin before invocation: %s",
    async (_label, invalidPin, message) => {
      const invoke = vi.fn();
      const commitFailure = vi.fn().mockResolvedValue({
        kind: "committed",
        cursor: "9",
        status: "failed",
      });

      await runAgentWorkerOnce({
        repo: {
          claimNext: vi
            .fn()
            .mockResolvedValue({ ...work(), run_pin: invalidPin }),
          renewLease: vi.fn().mockResolvedValue(true),
          commitSuccess: vi.fn(),
          commitFailure,
        },
        runtime: { name: "fake", ready: async () => true, invoke },
        workerId: "worker-1",
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(commitFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          failureMessage: expect.stringContaining(message),
        }),
      );
    },
  );

  it("uses frozen resource references instead of physical resource order", async () => {
    const reorderedPin = patchRunPin(runPin, {
      resources: [...runPin.resources].reverse(),
    });
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "已完成",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });

    await runAgentWorkerOnce({
      repo: {
        claimNext: vi
          .fn()
          .mockResolvedValue({ ...work(), run_pin: reorderedPin }),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess: vi.fn().mockResolvedValue({
          kind: "committed",
          cursor: "8",
          status: "completed",
        }),
        commitFailure: vi.fn(),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeInstructions: [
          bundledAgentRuntimeManifest.resources[0]!.content,
          bundledAgentRuntimeManifest.resources[1]!.content,
        ],
      }),
    );
  });

  it("rejects AgentWork candidate metadata that differs from its RunPin", async () => {
    const body = "# Poster instructions";
    const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const candidate = {
      creative_skill_id: "official.poster",
      creative_skill_version_id: "version.poster.1",
      name: "海报专家",
      description: null,
      display_version: "1.0.0",
      resource_digest: digest,
    };
    const frozenPin = patchRunPin(runPin, {
      auto_creative_skill_candidates: [candidate],
      creative_skill_resources: [
        {
          ...candidate,
          media_type: "text/markdown",
          body,
          content_digest: digest,
        },
      ],
    });
    const invoke = vi.fn();
    const commitFailure = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });

    await runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue({
          ...work("篡改后的触发名"),
          run_pin: frozenPin,
          auto_creative_skill_candidates: [
            { ...candidate, name: "篡改后的触发名" },
          ],
        }),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess: vi.fn(),
        commitFailure,
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(commitFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        failureMessage: "agent_work_run_pin_projection_mismatch",
      }),
    );
  });

  it("renews the database lease while the runtime call is still active", async () => {
    vi.useFakeTimers();
    let finishInvoke!: (value: { provider: string; content: string }) => void;
    const invoke = vi.fn(
      () =>
        new Promise<{ provider: string; content: string }>((resolve) => {
          finishInvoke = resolve;
        }),
    );
    const renewLease = vi.fn().mockResolvedValue(true);
    const commitSuccess = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    const task = runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue(work()),
        renewLease,
        commitSuccess,
        commitFailure: vi.fn().mockResolvedValue({ kind: "conflict" }),
      },
      runtime: { name: "slow", ready: async () => true, invoke },
      workerId: "worker-1",
      leaseMs: 30,
      heartbeatIntervalMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(renewLease).toHaveBeenCalledWith({
      workerId: "worker-1",
      agentRunId: "9",
      fence: "3",
      runVersion: 4,
      leaseMs: 30,
    });
    finishInvoke({
      provider: "fake",
      content: "已完成",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });
    await expect(task).resolves.toEqual({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    vi.useRealTimers();
  });

  it("commits a terminal failure when the runtime throws instead of re-claiming", async () => {
    const commitSuccess = vi.fn();
    const commitFailure = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    const invoke = vi
      .fn()
      .mockRejectedValue(new Error("fake agent explicit failure"));
    await expect(
      runAgentWorkerOnce({
        repo: {
          claimNext: vi.fn().mockResolvedValue(work("请失败 fake:failure")),
          renewLease: vi.fn().mockResolvedValue(true),
          commitSuccess,
          commitFailure,
        },
        runtime: { name: "fake", ready: async () => true, invoke },
        workerId: "worker-1",
      }),
    ).resolves.toEqual({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    expect(commitFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        fence: "3",
        runVersion: 4,
        requestDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        failureCode: "runtime_error",
        failureMessage: "fake agent explicit failure",
      }),
    );
    expect(commitSuccess).not.toHaveBeenCalled();
  });
});

// 总结管道分流（IK60X1，契约 §15.2/§15.4）：带 skill_summarize 标记的 Run → 总结模式；
// 无标记但会话存在 pending 待确认 → 确认模式；确认判定无关 → pass_through 回退 runtime。
describe("runAgentWorkerOnce 总结分流", () => {
  function makeRepo(work: Record<string, unknown>) {
    return {
      claimNext: vi.fn().mockResolvedValue(work),
      renewLease: vi.fn().mockResolvedValue(true),
      commitSuccess: vi.fn().mockResolvedValue({
        kind: "committed",
        cursor: "8",
        status: "completed",
      }),
      commitFailure: vi.fn().mockResolvedValue({ kind: "conflict" }),
    };
  }
  const BASE_WORK = work("总结当前对话并保存为我的技能");

  it("skillSummarize=true → 走总结管道，不调 runtime", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: true });
    const invoke = vi.fn();
    const summarize = {
      hasPending: vi.fn(),
      run: vi.fn().mockResolvedValue({
        kind: "handled",
        content: "已总结当前对话并保存为个人技能「周报生成」",
      }),
    };

    const result = await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(result).toEqual({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    expect(summarize.run).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "7", userId: "100" }),
    );
    expect(summarize.hasPending).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(repo.commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "已总结当前对话并保存为个人技能「周报生成」",
      }),
    );
  });

  it("skillSummarize=false 但会话有 pending → 确认模式，不调 runtime", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: false });
    const invoke = vi.fn();
    const summarize = {
      hasPending: vi.fn().mockResolvedValue(true),
      run: vi.fn().mockResolvedValue({
        kind: "handled",
        content: "已保存为个人技能「周报小助手」",
      }),
    };

    await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(summarize.hasPending).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "7", userId: "100" }),
    );
    expect(summarize.run).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("确认模式判定无关 → pass_through 回退 runtime.invoke", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: false });
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "runtime 回复",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });
    const summarize = {
      hasPending: vi.fn().mockResolvedValue(true),
      run: vi.fn().mockResolvedValue({ kind: "pass_through" }),
    };

    await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: BASE_WORK.prompt }),
    );
    expect(repo.commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ content: "runtime 回复" }),
    );
  });

  it("无 pending 且无总结意图 → 正常 runtime（不调管道 run）", async () => {
    const repo = makeRepo({ ...BASE_WORK, skillSummarize: false });
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "runtime 回复",
      reasoningSummary: "已完成回答。",
      action: { kind: "respond" },
    });
    const summarize = {
      hasPending: vi.fn().mockResolvedValue(false),
      run: vi.fn(),
    };

    await runAgentWorkerOnce({
      repo,
      runtime: { name: "fake", ready: async () => true, invoke },
      summarize,
      workerId: "worker-1",
    });

    expect(summarize.run).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
  });
});
