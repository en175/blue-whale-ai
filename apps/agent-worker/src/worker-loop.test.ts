// IK74V8：从 worker-loop.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {describe, expect, it, vi} from "vitest";
import {createHash} from "node:crypto";
import {bundledAgentRuntimeManifest} from "../../../packages/agent-runtime/src/runtime-manifest.js";
import {runAgentWorkerOnce} from "./worker-loop.js";
import {patchRunPin, providerCallMocks, runPin, work} from "./worker-loop.testlib.js";

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
        repo: {
          claimNext,
          renewLease,
          commitSuccess,
          commitFailure,
          ...providerCallMocks(),
        },
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

  it("routes submit_plan to commitPlanMessages with contract-shaped cards (IK67H6)", async () => {
    const claimNext = vi.fn().mockResolvedValue(work());
    const commitPlanMessages = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "completed",
    });
    const invoke = vi.fn().mockResolvedValue({
      provider: "fake",
      content: "正式提交 1 张计划卡。",
      reasoningSummary: "需求已确认，提交计划卡。",
      action: {
        kind: "submit_plan",
        cards: [
          {
            applicationKind: "image_generate",
            title: "海报主视觉",
            contentMarkdown: "一只冲浪的蓝鲸",
          },
        ],
      },
    });
    await runAgentWorkerOnce({
      repo: {
        claimNext,
        renewLease: vi.fn().mockResolvedValue(true),
        commitPlanMessages,
        ...providerCallMocks(),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });
    expect(commitPlanMessages).toHaveBeenCalledTimes(1);
    expect(commitPlanMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-1",
        agentRunId: "9",
        advanceId: "30",
        capabilitySnapshotVersion: 1,
        reasoningSummary: "需求已确认，提交计划卡。",
        // core camelCase 候选经 Worker 边界转为 contracts 线缆形态。
        planCards: [
          expect.objectContaining({
            application_kind: "image_generate",
            title: "海报主视觉",
            content_markdown: "一只冲浪的蓝鲸",
          }),
        ],
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
        ...providerCallMocks(),
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
          ...providerCallMocks(),
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
        ...providerCallMocks(),
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
        ...providerCallMocks(),
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
        ...providerCallMocks(),
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
          ...providerCallMocks(),
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

  it("replays a persisted succeeded provider result without a second invocation（契约 §8.4）", async () => {
    const invoke = vi.fn();
    const commitSuccess = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "8",
      status: "completed",
    });
    const appendProvisionalChunks = vi.fn().mockResolvedValue({
      kind: "appended",
      deliveryId: "78",
      startIndex: 0,
    });
    await runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue(work()),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess,
        commitFailure: vi.fn(),
        ...providerCallMocks({
          loadProviderCall: vi.fn().mockResolvedValue({
            id: "500",
            agentRunId: "9",
            advanceId: "30",
            callSlot: 0,
            fencingToken: "3",
            status: "succeeded",
            requestDigest: `sha256:${"a".repeat(64)}`,
            resultPayload: {
              content: "接管前已完成",
              reasoning_summary: "已完成回答。",
              action: { kind: "respond" },
              auto_activation: null,
            },
            failureCode: null,
            failureMessage: null,
          }),
          appendProvisionalChunks,
        }),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(commitSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ content: "接管前已完成" }),
    );
    expect(appendProvisionalChunks).toHaveBeenCalledWith(
      expect.objectContaining({ chunks: ["接管前已完成"] }),
    );
  });

  it("treats an in-flight record after takeover as outcome_unknown and fails for manual retry（契约 §8.4）", async () => {
    const invoke = vi.fn();
    const markUnknown = vi.fn().mockResolvedValue(true);
    const commitFailure = vi.fn().mockResolvedValue({
      kind: "committed",
      cursor: "9",
      status: "failed",
    });
    await runAgentWorkerOnce({
      repo: {
        claimNext: vi.fn().mockResolvedValue(work()),
        renewLease: vi.fn().mockResolvedValue(true),
        commitSuccess: vi.fn(),
        commitFailure,
        ...providerCallMocks({
          loadProviderCall: vi.fn().mockResolvedValue({
            id: "500",
            agentRunId: "9",
            advanceId: "30",
            callSlot: 0,
            fencingToken: "2",
            status: "in_flight",
            requestDigest: `sha256:${"a".repeat(64)}`,
            resultPayload: null,
            failureCode: null,
            failureMessage: null,
          }),
          markProviderCallOutcomeUnknown: markUnknown,
        }),
      },
      runtime: { name: "fake", ready: async () => true, invoke },
      workerId: "worker-1",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(markUnknown).toHaveBeenCalledWith("30", 0);
    expect(commitFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "provider_outcome_unknown" }),
    );
  });

  it("aborts the commit when provisional chunks are rejected by a newer fence（契约 §8.1）", async () => {
    const commitSuccess = vi.fn();
    await expect(
      runAgentWorkerOnce({
        repo: {
          claimNext: vi.fn().mockResolvedValue(work()),
          renewLease: vi.fn().mockResolvedValue(true),
          commitSuccess,
          commitFailure: vi.fn().mockResolvedValue({ kind: "conflict" }),
          ...providerCallMocks({
            appendProvisionalChunks: vi
              .fn()
              .mockResolvedValue({ kind: "conflict" }),
          }),
        },
        runtime: {
          name: "fake",
          ready: async () => true,
          invoke: vi.fn().mockResolvedValue({
            provider: "fake",
            content: "已完成",
            reasoningSummary: "已完成回答。",
            action: { kind: "respond" },
          }),
        },
        workerId: "worker-1",
      }),
    ).resolves.toEqual({ kind: "conflict" });
    expect(commitSuccess).not.toHaveBeenCalled();
  });
});
