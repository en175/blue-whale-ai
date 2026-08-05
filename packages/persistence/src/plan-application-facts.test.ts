import { describe, expect, it } from "vitest";

import { capabilityDigest } from "./capability-digest.js";
import {
  loadPlanApplicationFacts,
  type LoadPlanApplicationFactsInput,
} from "./plan-application-facts.js";

const CAP_FIELDS = {
  supported_sizes: ["1024x1024"],
  supported_aspect_ratios: ["1:1"],
  supported_durations: null,
  supported_formats: ["png"],
  default_size: "1024x1024",
  default_format: "png",
  default_aspect_ratio: "1:1",
  default_duration: null,
};

const SNAPSHOT = {
  schema_version: 1,
  capability_type: "image",
  model_id: "doubao-seedream-5.0-lite",
  provider_id: "doubao",
  row_version: 3,
  digest: capabilityDigest(CAP_FIELDS),
} as LoadPlanApplicationFactsInput["capabilitySnapshot"];

/** 与 SNAPSHOT 完全匹配的当前能力行（drift 基线）。 */
function capRow(overrides: Record<string, unknown> = {}) {
  return { version: 3, enabled: true, is_delete: false, ...CAP_FIELDS, ...overrides };
}

function assetFact(overrides: Record<string, unknown> = {}) {
  return { user_id: 100n, project_id: 42n, status: "normal", is_delete: false, ...overrides };
}

function buildInput(
  overrides: Partial<LoadPlanApplicationFactsInput>,
): LoadPlanApplicationFactsInput {
  return {
    derivedReferences: [],
    mentionFacts: new Map(),
    assetById: new Map(),
    missingMention: "ignore",
    projectId: 42n,
    userId: 100n,
    capabilitySnapshot: SNAPSHOT,
    currentCapability: capRow(),
    ...overrides,
  };
}

describe("loadPlanApplicationFacts — mention 维度", () => {
  it("无引用 + 能力匹配 → 两侧皆 false（available 基线）", () => {
    const facts = loadPlanApplicationFacts(buildInput({}));
    expect(facts).toEqual({ mentionUnavailable: false, capabilityDrifted: false });
  });

  it("missingMention=unavailable：mention 行缺失 → mentionUnavailable=true", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        missingMention: "unavailable",
        derivedReferences: [{ type: "asset", mention_id: "999" }],
        mentionFacts: new Map(),
      }),
    );
    expect(facts.mentionUnavailable).toBe(true);
  });

  it("missingMention=ignore：mention 行缺失 → 静默跳过，mentionUnavailable=false（写路径原义）", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        missingMention: "ignore",
        derivedReferences: [{ type: "asset", mention_id: "999" }],
        mentionFacts: new Map(),
      }),
    );
    expect(facts.mentionUnavailable).toBe(false);
  });

  it("asset 存在但已删（status != normal）→ mentionUnavailable=true", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        derivedReferences: [{ type: "asset", mention_id: "101" }],
        mentionFacts: new Map([
          ["101", { target_id: 1n, target_version: null, accepted_user_id: 100n }],
        ]),
        assetById: new Map([["1", assetFact({ status: "deleted" })]]),
      }),
    );
    expect(facts.mentionUnavailable).toBe(true);
  });

  it("asset 存在且 normal → mentionUnavailable=false", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        derivedReferences: [{ type: "asset", mention_id: "101" }],
        mentionFacts: new Map([
          ["101", { target_id: 1n, target_version: null, accepted_user_id: 100n }],
        ]),
        assetById: new Map([["1", assetFact()]]),
      }),
    );
    expect(facts.mentionUnavailable).toBe(false);
  });

  it("scene_card 引用恒跳过（即便 missingMention=unavailable 且 mention 缺失）", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        missingMention: "unavailable",
        derivedReferences: [{ type: "scene_card", mention_id: "555" }],
        mentionFacts: new Map(),
      }),
    );
    expect(facts.mentionUnavailable).toBe(false);
  });

  it("任一 asset 失效即整体失效（break 短路）", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        derivedReferences: [
          { type: "asset", mention_id: "101" },
          { type: "asset", mention_id: "102" },
        ],
        mentionFacts: new Map([
          ["101", { target_id: 1n, target_version: null, accepted_user_id: 100n }],
          ["102", { target_id: 2n, target_version: null, accepted_user_id: 100n }],
        ]),
        assetById: new Map([
          ["1", assetFact()],
          ["2", assetFact({ is_delete: true })],
        ]),
      }),
    );
    expect(facts.mentionUnavailable).toBe(true);
  });
});

describe("loadPlanApplicationFacts — capability 维度", () => {
  it("能力行缺失 → capabilityDrifted=true", () => {
    const facts = loadPlanApplicationFacts(buildInput({ currentCapability: undefined }));
    expect(facts.capabilityDrifted).toBe(true);
  });

  it("能力行 is_delete=true → capabilityDrifted=true", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({ currentCapability: capRow({ is_delete: true }) }),
    );
    expect(facts.capabilityDrifted).toBe(true);
  });

  it("能力行 enabled=false → capabilityDrifted=true", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({ currentCapability: capRow({ enabled: false }) }),
    );
    expect(facts.capabilityDrifted).toBe(true);
  });

  it("row_version 变化 → capabilityDrifted=true", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({ currentCapability: capRow({ version: 99 }) }),
    );
    expect(facts.capabilityDrifted).toBe(true);
  });

  it("digest 变化（supported_sizes 不同）→ capabilityDrifted=true", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        currentCapability: capRow({ supported_sizes: ["2048x2048"] }),
      }),
    );
    expect(facts.capabilityDrifted).toBe(true);
  });

  it("version + digest 全匹配 → capabilityDrifted=false", () => {
    const facts = loadPlanApplicationFacts(buildInput({ currentCapability: capRow() }));
    expect(facts.capabilityDrifted).toBe(false);
  });
});

describe("loadPlanApplicationFacts — 混合场景", () => {
  it("mention 失效 + 能力漂移同时存在 → 两布尔皆 true", () => {
    const facts = loadPlanApplicationFacts(
      buildInput({
        derivedReferences: [{ type: "asset", mention_id: "101" }],
        mentionFacts: new Map([
          ["101", { target_id: 1n, target_version: null, accepted_user_id: 100n }],
        ]),
        assetById: new Map(), // target 缺失 → deleted → unavailable
        currentCapability: undefined, // 能力行缺失 → drifted
      }),
    );
    expect(facts).toEqual({ mentionUnavailable: true, capabilityDrifted: true });
  });
});
