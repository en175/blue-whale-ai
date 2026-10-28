import { describe, expect, it } from "vitest";

import { extractSpecs } from "../billing/billing-specs.js";
import { sceneCardChargeInput } from "./scene-card-generation-repo.js";

const PARAMETERS = {
  capability_type: "video",
  model_id: "doubao-seedance-2-0-260128",
  provider_id: "volc",
  size: "480p",
  aspect_ratio: "16:9",
  format: null,
  duration: 4,
  count: 1,
} as never;

describe("sceneCardChargeInput（IKR60U）", () => {
  it("视频参数映射成计价规格：size→resolution、时长与输出数", () => {
    const input = sceneCardChargeInput({
      parameters: PARAMETERS,
      prompt: "人物走过街角",
      references: [],
    });

    expect(input).toEqual({
      model_id: "doubao-seedance-2-0-260128",
      resolution: "480p",
      aspect_ratio: "16:9",
      duration: 4,
      prompt: "人物走过街角",
      expected_output_count: 1,
    });
    expect(extractSpecs(input, "video")).toMatchObject({
      model_id: "doubao-seedance-2-0-260128",
      resolution: "480p",
      aspect_ratio: "16:9",
      duration: "4",
      reference_count: "0",
      video: "0",
    });
  });

  it("duration 为空时不写入时长（由计费侧拒绝而不是按默认值扣）", () => {
    const input = sceneCardChargeInput({
      parameters: { ...PARAMETERS, duration: null } as never,
      prompt: "x",
      references: [],
    });
    expect("duration" in input).toBe(false);
  });

  it("视频参考带时长 → 进入 video 档与 reference_seconds", () => {
    const input = sceneCardChargeInput({
      parameters: PARAMETERS,
      prompt: "x",
      references: [
        { role: "reference", type: "video", asset_id: "9001", duration: 4.4 },
      ],
    });

    const specs = extractSpecs(input, "video");
    expect(specs.reference_count).toBe("1");
    expect(specs.video).toBe("1");
    expect(specs.reference_seconds).toBe("4");
  });
});
