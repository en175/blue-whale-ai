import { describe, expect, it } from "vitest";

import {
  agentRunCommitSchema,
  agentRunPinSchema,
  agentRunPublicProjectionSchema,
  agentRunWorkSchema,
  agentRuntimeManifestSchema,
  autoCreativeSkillCandidateSchema,
  creativeSkillActivationSchema,
} from "./agent-runtime.js";

const digest = `sha256:${"a".repeat(64)}`;

describe("Node Agent Runtime Contract v1", () => {
  it("接受完整 Manifest，并拒绝候选和公开投影携带 Skill 正文", () => {
    const manifest = agentRuntimeManifestSchema.parse({
      schema_version: 1,
      manifest_id: "blue_whale_default",
      manifest_version: "1.0.0",
      manifest_digest: digest,
      resources: [
        {
          resource_id: "role.default",
          resource_version: "1.0.0",
          kind: "role",
          load_mode: "always_on",
          media_type: "text/markdown",
          content: "You are Blue Whale.",
          content_digest: digest,
        },
      ],
      role_resource_id: "role.default",
      rule_resource_ids: [],
      runtime_skill_resource_ids: [],
      model_profiles: [
        {
          model_profile_id: "fake.default",
          provider: "fake",
          model: "deterministic-v1",
          context_window_tokens: 8192,
          tokenizer: "fake-v1",
        },
      ],
      selected_model_profile_id: "fake.default",
      runtime_budget_policy: {
        max_provider_calls: 1,
        max_input_characters: 16000,
        max_output_characters: 4000,
        protocol_repair_attempts: 0,
      },
      tool_grants: [],
    });

    expect(manifest.role_resource_id).toBe("role.default");
    expect(
      autoCreativeSkillCandidateSchema.parse({
        creative_skill_id: "poster_copy",
        creative_skill_version_id: "7d344f0e-9f52-4d46-87c0-337990f94b70",
        name: "海报文案",
        description: null,
        display_version: "1.0.0",
        resource_digest: digest,
      }).creative_skill_version_id,
    ).toBe("7d344f0e-9f52-4d46-87c0-337990f94b70");
    expect(() =>
      autoCreativeSkillCandidateSchema.parse({
        creative_skill_id: "poster_copy",
        creative_skill_version_id: "poster_copy_v1",
        name: "海报文案",
        description: "生成海报文案",
        display_version: "1.0.0",
        resource_digest: digest,
        body: "private",
      }),
    ).toThrow();
    expect(() =>
      agentRunPublicProjectionSchema.parse({
        agent_run_id: "1",
        status: "completed",
        stage: "completed",
        version: 2,
        activated_creative_skill_versions: [],
        reasoning_summary: "已完成回答。",
        run_pin: {},
      }),
    ).toThrow();
  });

  it("把 RunPin 的激活数量固定为零或一", () => {
    const activation = creativeSkillActivationSchema.parse({
      creative_skill_id: "poster_copy",
      creative_skill_version_id: "poster_copy_v1",
      name: "海报文案",
      display_version: "1.0.0",
      resource_digest: digest,
      source: "forced_use",
      reason: { type: "user_use" },
    });

    expect(() =>
      agentRunPinSchema.parse({
        schema_version: 1,
        manifest_id: "blue_whale_default",
        manifest_version: "1.0.0",
        manifest_digest: digest,
        pin_digest: digest,
        resources: [
          {
            resource_id: "role.default",
            resource_version: "1.0.0",
            kind: "role",
            load_mode: "always_on",
            media_type: "text/markdown",
            content: "You are Blue Whale.",
            content_digest: digest,
          },
        ],
        role_resource_id: "role.default",
        rule_resource_ids: [],
        runtime_skill_resource_ids: [],
        model_profile: {
          model_profile_id: "fake.default",
          provider: "fake",
          model: "deterministic-v1",
          context_window_tokens: 8192,
          tokenizer: "fake-v1",
        },
        runtime_budget_policy: {
          max_provider_calls: 1,
          max_input_characters: 16000,
          max_output_characters: 4000,
          protocol_repair_attempts: 0,
        },
        tool_grants: [],
        auto_creative_skill_candidates: [],
        activated_creative_skill_versions: [activation, activation],
        creative_skill_resources: [],
      }),
    ).toThrow();
  });

  it("冻结 AgentWork 输入，并把 RunCommit 限制为单一判别结果", () => {
    const pin = {
      schema_version: 1 as const,
      manifest_id: "blue_whale_default",
      manifest_version: "1.0.0",
      manifest_digest: digest,
      pin_digest: digest,
      resources: [
        {
          resource_id: "role.default",
          resource_version: "1.0.0",
          kind: "role",
          load_mode: "always_on",
          media_type: "text/markdown",
          content: "You are Blue Whale.",
          content_digest: digest,
        },
      ],
      role_resource_id: "role.default",
      rule_resource_ids: [],
      runtime_skill_resource_ids: [],
      model_profile: {
        model_profile_id: "fake.default",
        provider: "fake",
        model: "deterministic-v1",
        context_window_tokens: 8192,
        tokenizer: "fake-v1",
      },
      runtime_budget_policy: {
        max_provider_calls: 1,
        max_input_characters: 16000,
        max_output_characters: 4000,
        protocol_repair_attempts: 0,
      },
      tool_grants: [],
      auto_creative_skill_candidates: [],
      activated_creative_skill_versions: [],
      creative_skill_resources: [],
    };
    const work = agentRunWorkSchema.parse({
      schema_version: 1,
      agent_run_id: "7",
      advance_id: "11",
      fencing_token: "3",
      run_version: 2,
      input_high_watermark_sequence_no: 4,
      input_messages: [
        { message_id: "19", sequence_no: 4, role: "user", content: "hello" },
      ],
      prompt: "hello",
      run_pin: pin,
      auto_creative_skill_candidates: [],
      activated_creative_skill_versions: [],
      mention_input_snapshot: { capability_snapshot_version: 1, entries: [] },
    });

    expect(work.advance_id).toBe("11");
    expect(work.history_messages).toEqual([]);
    expect(
      agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: "11",
        fencing_token: "3",
        expected_run_version: 2,
        request_digest: digest,
        outcome: "completed",
        assistant_message: { content: "answer" },
        reasoning_summary: "已完成回答。",
        auto_creative_skill_activation: null,
      }).outcome,
    ).toBe("completed");
    expect(
      agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: "11",
        fencing_token: "3",
        expected_run_version: 2,
        request_digest: digest,
        outcome: "awaiting_input",
        assistant_message: { content: "请告诉我这次创作的主体是什么？" },
        reasoning_summary: "需求缺少主体，先澄清最关键的一项。",
        input_request: { question: "请告诉我这次创作的主体是什么？" },
        stage: "alignment",
      }).outcome,
    ).toBe("awaiting_input");
    expect(
      agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: "11",
        fencing_token: "3",
        expected_run_version: 2,
        request_digest: digest,
        outcome: "cancelled",
      }).outcome,
    ).toBe("cancelled");
    expect(() =>
      agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: "11",
        fencing_token: "3",
        expected_run_version: 2,
        request_digest: digest,
        outcome: "awaiting_input",
        assistant_message: { content: "确认需求吗？" },
        reasoning_summary: "等待最终确认。",
        input_request: { question: "确认需求吗？" },
        stage: "completed",
      }),
    ).toThrow();
    expect(() =>
      agentRunPublicProjectionSchema.parse({
        agent_run_id: "1",
        status: "running",
        stage: "responding",
        version: 1,
        activated_creative_skill_versions: [],
        reasoning_summary: null,
      }),
    ).toThrow();
    expect(() =>
      agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: "11",
        fencing_token: "3",
        expected_run_version: 2,
        request_digest: digest,
        outcome: "failed",
        failure: { code: "runtime_error", message: "failed" },
        assistant_message: { content: "must not coexist" },
      }),
    ).toThrow();
  });

  it("completed_with_plan 接纳计划卡候选，且不带 assistant_message", () => {
    const parsed = agentRunCommitSchema.parse({
      schema_version: 1,
      advance_id: "11",
      fencing_token: "3",
      expected_run_version: 2,
      request_digest: digest,
      outcome: "completed_with_plan",
      reasoning_summary: "已对齐需求，提交两张计划卡。",
      plan_cards: [
        {
          application_kind: "image_generate",
          title: "海报主视觉",
          content_markdown: "一只冲浪的蓝鲸 asset://101",
        },
        {
          application_kind: "scene_card_create",
          title: "开场分镜",
          content_markdown: "蓝鲸跃出水面 asset://102",
        },
      ],
      capability_snapshot_version: 1,
    });
    if (parsed.outcome !== "completed_with_plan") {
      throw new Error("expected completed_with_plan outcome");
    }
    expect(parsed.plan_cards).toHaveLength(2);
    expect(parsed.plan_cards[0].application_kind).toBe("image_generate");
    expect(parsed.plan_cards[1].application_kind).toBe("scene_card_create");
    // 正式消息即 plan_cards，不得携带 assistant_message。
    expect(() =>
      agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: "11",
        fencing_token: "3",
        expected_run_version: 2,
        request_digest: digest,
        outcome: "completed_with_plan",
        reasoning_summary: "误带正文。",
        plan_cards: [
          {
            application_kind: "image_generate",
            title: "海报主视觉",
            content_markdown: "一只冲浪的蓝鲸",
          },
        ],
        capability_snapshot_version: 1,
        assistant_message: { content: "must not coexist" },
      }),
    ).toThrow();
  });
});
